const User = require('../models/user.model');
const Invoice = require('../models/invoice.model');
const Notification = require('../models/notification.model');
const TemuOrder = require('../models/temuOrder.model');
const EbayOrder = require('../models/ebayOrder.model');
const stripeService = require('../services/stripe.service');
const emailService = require('../services/email.service');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

exports.getMe = catchAsync(async (req, res, next) => {
  const mongoose = require('mongoose');
  let user = req.user;

  if (mongoose.connection.readyState === 1) {
    user = await User.findById(req.user.id) || req.user;
  }

  res.status(200).json({
    status: 'success',
    data: {
      user
    }
  });
});

exports.updateMe = catchAsync(async (req, res, next) => {
  const { email, username, fullName, companyName, streetName, houseNumber, postcode, cityName, contactEmail, telephone, settings } = req.body;

  const updateData = {};
  if (email) updateData.email = email;
  if (username) updateData.username = username;
  if (fullName) updateData.fullName = fullName;
  if (companyName !== undefined) updateData.companyName = companyName;
  if (streetName !== undefined) updateData.streetName = streetName;
  if (houseNumber !== undefined) updateData.houseNumber = houseNumber;
  if (postcode !== undefined) updateData.postcode = postcode;
  if (cityName !== undefined) updateData.cityName = cityName;
  if (contactEmail !== undefined) updateData.contactEmail = contactEmail;
  if (telephone !== undefined) updateData.telephone = telephone;
  if (settings !== undefined) updateData.settings = settings;

  const user = await User.findByIdAndUpdate(req.user.id, updateData, {
    new: true,
    runValidators: true
  });

  res.status(200).json({
    status: 'success',
    data: {
      user
    }
  });
});

exports.getAllUsers = catchAsync(async (req, res, next) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const users = await User.find().skip(skip).limit(limit);
  const total = await User.countDocuments();

  res.status(200).json({
    status: 'success',
    results: users.length,
    data: {
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});

exports.getUserById = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      user
    }
  });
});

exports.deleteUser = catchAsync(async (req, res, next) => {
  const user = await User.findByIdAndDelete(req.params.id);

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  res.status(204).json({
    status: 'success',
    data: null
  });
});

exports.chargeCredit = catchAsync(async (req, res, next) => {
  const { amount, paymentMethod, cardDetails } = req.body;

  if (!amount || isNaN(amount) || amount <= 0) {
    return next(new AppError('Please provide a valid charge amount', 400));
  }

  // Backend Card Validation Check
  if (cardDetails) {
    const cleanNum = (cardDetails.number || '').replace(/\D/g, '');
    if (cleanNum && cleanNum.length < 13) {
      return next(new AppError('Invalid card number. Must be at least 13-16 digits.', 400));
    }
  }

  const user = await User.findById(req.user.id);

  // Process payment with Stripe Sandbox
  const stripeResult = await stripeService.processStripePayment(
    amount,
    'Shipping Credit Top-Up',
    { userId: user._id.toString(), email: user.email }
  );

  user.balance = (user.balance || 0) + parseFloat(amount);
  await user.save();

  const invoiceNumber = `INV-2026-${Math.floor(1000 + Math.random() * 9000)}`;

  const invoice = await Invoice.create({
    number: invoiceNumber,
    user: user._id,
    amount: parseFloat(amount),
    description: 'Shipping Credit Top-Up (Stripe Card)',
    paymentMethod: paymentMethod || 'Stripe Card (Sandbox)',
    stripePaymentId: stripeResult.paymentIntentId,
    status: 'paid',
    date: new Date()
  });

  // Send Payment Receipt Email
  emailService.sendPaymentReceiptEmail(user, invoice).catch(err => {
    console.warn('⚠️ Payment receipt email sending warning:', err.message);
  });

  // Create notification
  await Notification.create({
    title: 'Stripe Card Payment Successful',
    message: `Charged €${parseFloat(amount).toFixed(2)} via Stripe Card (Ref: ${stripeResult.paymentIntentId.substring(0, 14)}...)`,
    type: 'success',
    user: user._id
  });

  res.status(200).json({
    status: 'success',
    message: 'Card top-up successful!',
    data: {
      user,
      invoice,
      stripe: stripeResult
    }
  });
});

exports.selectPlan = catchAsync(async (req, res, next) => {
  const { plan, paymentMethod, cardDetails } = req.body;
  const validPlans = ['free', 'starter', 'basic', 'premium'];

  if (!plan || !validPlans.includes(plan.toLowerCase())) {
    return next(new AppError('Please select a valid plan (Free, Starter, Basic, or Premium)', 400));
  }

  const normalizedPlan = plan.toLowerCase();

  // Backend Card Validation for Paid Plans
  if (['starter', 'basic', 'premium'].includes(normalizedPlan) && cardDetails) {
    const cleanNum = (cardDetails.number || '').replace(/\D/g, '');
    if (cleanNum && cleanNum.length < 13) {
      return next(new AppError('Invalid payment card number provided.', 400));
    }
  }

  const limits = {
    free: 20,
    starter: 100,
    basic: 400,
    premium: 1000
  };

  const prices = {
    free: 0,
    starter: 19,
    basic: 49,
    premium: 99
  };

  const user = await User.findById(req.user.id);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  user.subscription = user.subscription || {};
  user.subscription.plan = normalizedPlan;
  user.subscription.status = 'active';
  user.subscription.labelsLimit = limits[normalizedPlan] || 100;
  user.subscription.renewDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  user.accountType = normalizedPlan === 'premium' ? 'premium' : 'standard';

  await user.save();

  let invoice = null;
  let stripeResult = null;

  // Process Stripe payment & Create invoice if price > 0
  if (prices[normalizedPlan] > 0) {
    stripeResult = await stripeService.processStripePayment(
      prices[normalizedPlan],
      `${normalizedPlan.toUpperCase()} Plan Subscription`,
      { userId: user._id.toString(), plan: normalizedPlan }
    );

    const invoiceNumber = `SUB-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    invoice = await Invoice.create({
      number: invoiceNumber,
      user: user._id,
      amount: prices[normalizedPlan],
      description: `${normalizedPlan.toUpperCase()} Plan Subscription (Stripe Card)`,
      paymentMethod: paymentMethod || 'Stripe Card (Sandbox)',
      stripePaymentId: stripeResult.paymentIntentId,
      status: 'paid',
      date: new Date()
    });
  }

  // Send Subscription Confirmation Email
  emailService.sendSubscriptionUpdateEmail(user, normalizedPlan, invoice).catch(err => {
    console.warn('⚠️ Subscription email sending warning:', err.message);
  });

  // Create notification
  await Notification.create({
    title: 'Stripe Plan Upgrade Successful',
    message: `Subscribed to ${normalizedPlan.toUpperCase()} Plan (€${prices[normalizedPlan]}/mo).`,
    type: 'success',
    user: user._id
  });

  res.status(200).json({
    status: 'success',
    message: `Plan upgraded to ${normalizedPlan.toUpperCase()} successfully`,
    data: {
      user,
      invoice,
      stripe: stripeResult
    }
  });
});

/**
 * Get trashed countries and order settings for the current user
 */
exports.getTrashedCountries = catchAsync(async (req, res, next) => {
  const mongoose = require('mongoose');
  let user = req.user;
  if (mongoose.connection.readyState === 1) {
    user = (await User.findById(req.user.id)) || req.user;
  }

  res.status(200).json({
    status: 'success',
    data: {
      trashedCountries: user.trashedCountries || [],
      restoredOrderIds: user.restoredOrderIds || [],
      manualTrashedOrderIds: user.manualTrashedOrderIds || []
    }
  });
});

/**
 * Save trashed countries and order settings for the current user in MongoDB
 */
exports.updateTrashedCountries = catchAsync(async (req, res, next) => {
  const { trashedCountries, restoredOrderIds, manualTrashedOrderIds } = req.body;

  const mongoose = require('mongoose');
  let user = req.user;
  if (mongoose.connection.readyState === 1) {
    const updateData = {};
    if (Array.isArray(trashedCountries)) updateData.trashedCountries = trashedCountries;
    if (Array.isArray(restoredOrderIds)) updateData.restoredOrderIds = restoredOrderIds;
    if (Array.isArray(manualTrashedOrderIds)) updateData.manualTrashedOrderIds = manualTrashedOrderIds;

    user = await User.findByIdAndUpdate(req.user.id, updateData, { new: true });
  }

  res.status(200).json({
    status: 'success',
    message: 'Trashed countries settings saved successfully',
    data: {
      trashedCountries: user.trashedCountries || [],
      restoredOrderIds: user.restoredOrderIds || [],
      manualTrashedOrderIds: user.manualTrashedOrderIds || []
    }
  });
});



/**
 * Get country carrier routing rules for current user
 */
exports.getCountryCarrierRules = catchAsync(async (req, res, next) => {
  const mongoose = require("mongoose");
  let user = req.user;
  if (mongoose.connection.readyState === 1) {
    user = (await User.findById(req.user.id)) || req.user;
  }

  res.status(200).json({
    status: "success",
    data: {
      countryCarrierRules: user.countryCarrierRules || {}
    }
  });
});

/**
 * Save country carrier routing rules for current user
 */
exports.updateCountryCarrierRules = catchAsync(async (req, res, next) => {
  const { countryCarrierRules } = req.body;

  const mongoose = require("mongoose");
  let user = req.user;
  if (mongoose.connection.readyState === 1) {
    const updateData = {};
    if (countryCarrierRules && typeof countryCarrierRules === "object") {
      updateData.countryCarrierRules = countryCarrierRules;
    }

    user = await User.findByIdAndUpdate(req.user.id, updateData, { new: true });
  }

  res.status(200).json({
    status: "success",
    message: "Country carrier routing rules saved successfully in DB",
    data: {
      countryCarrierRules: user.countryCarrierRules || {}
    }
  });
});

/**
 * ============================================================================
 * AGENCY ADMIN CONTROLLER METHODS (Single Agency Admin for All Accounts)
 * ============================================================================
 */

/**
 * Get agency overview: aggregate balance across all accounts, user counts, companies summary
 */
exports.getAdminOverview = catchAsync(async (req, res, next) => {
  // Exclude agency master admin from managed users aggregate
  const users = await User.find(
    { role: { $ne: 'admin' }, email: { $ne: 'admin@ederapp.de' } },
    'email username fullName companyName balance role allowedPages isActive createdAt subscription'
  );

  let totalSystemBalance = 0;
  let activeUsersCount = 0;
  let inactiveUsersCount = 0;
  const companyMap = {};

  users.forEach(u => {
    const bal = Number(u.balance) || 0;
    totalSystemBalance += bal;
    if (u.isActive !== false) {
      activeUsersCount++;
    } else {
      inactiveUsersCount++;
    }

    const compName = (u.companyName && u.companyName.trim()) ? u.companyName.trim() : 'Unassigned / Independent';
    if (!companyMap[compName]) {
      companyMap[compName] = {
        name: compName,
        totalBalance: 0,
        userCount: 0,
        users: []
      };
    }
    companyMap[compName].totalBalance += bal;
    companyMap[compName].userCount += 1;
    companyMap[compName].users.push({
      id: u._id,
      email: u.email,
      fullName: u.fullName || u.username,
      balance: bal,
      role: u.role
    });
  });

  const companiesSummary = Object.values(companyMap).sort((a, b) => b.totalBalance - a.totalBalance);

  // System-wide order, label, unshipped, and activity metrics
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  const [
    temuOpen,
    temuLabels,
    temuActivity,
    temuTotal,
    ebayOpen,
    ebayLabels,
    ebayTotal,
    dhlCount,
    packetaCount
  ] = await Promise.all([
    TemuOrder.countDocuments({ status: 'open' }),
    TemuOrder.countDocuments({ status: { $in: ['created_label', 'printed'] } }),
    TemuOrder.countDocuments({
      status: 'created_label',
      $or: [
        { shippedAt: { $lte: twoDaysAgo } },
        { shippedAt: null, updatedAt: { $lte: twoDaysAgo } },
        { shippedAt: null, createdAt: { $lte: twoDaysAgo } }
      ]
    }),
    TemuOrder.countDocuments({}),
    EbayOrder.countDocuments({ status: 'open' }),
    EbayOrder.countDocuments({ status: { $in: ['created_label', 'printed'] } }),
    EbayOrder.countDocuments({}),
    TemuOrder.countDocuments({
      status: { $in: ['created_label', 'printed'] },
      $or: [
        { temuCourierName: { $regex: 'dhl', $options: 'i' } },
        { shippingMethod: { $regex: 'dhl', $options: 'i' } },
        { dhlShipmentId: { $exists: true, $ne: '' } }
      ]
    }),
    TemuOrder.countDocuments({
      status: { $in: ['created_label', 'printed'] },
      $or: [
        { temuCourierName: { $regex: 'packeta', $options: 'i' } },
        { shippingMethod: { $regex: 'packeta', $options: 'i' } },
        { tracking: { $regex: '^Z', $options: 'i' } },
        { packetaPacketId: { $exists: true, $ne: '' } }
      ]
    })
  ]);

  const totalOrders = temuTotal + ebayTotal;
  const totalUnshipped = temuOpen + ebayOpen;
  const totalLabelsCreated = temuLabels + ebayLabels;
  const totalActivity = temuActivity;

  res.status(200).json({
    status: 'success',
    data: {
      totalSystemBalance: Number(totalSystemBalance.toFixed(2)),
      totalUsers: users.length,
      activeUsersCount,
      inactiveUsersCount,
      totalCompanies: companiesSummary.length,
      companiesSummary,
      recentUsers: users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8),
      // System-wide order fulfillment metrics
      totalOrders,
      totalUnshipped,
      totalLabelsCreated,
      totalActivity,
      shippingStats: {
        temu: { open: temuOpen, labels: temuLabels, activity: temuActivity, total: temuTotal },
        ebay: { open: ebayOpen, labels: ebayLabels, total: ebayTotal },
        carriers: {
          dhl: dhlCount + ebayLabels,
          packeta: packetaCount
        }
      }
    }
  });
});

/**
 * Get all users with search, filtering by company, role, or active status
 */
exports.getAdminUsers = catchAsync(async (req, res, next) => {
  const { q, company, role, status } = req.query;

  // Never return the master admin in the client/operator user directory
  const query = {
    role: { $ne: 'admin' },
    email: { $ne: 'admin@ederapp.de' }
  };
  if (req.user && req.user.id) {
    query._id = { $ne: req.user.id };
  }

  if (q && q.trim()) {
    const regex = new RegExp(q.trim(), 'i');
    query.$or = [
      { email: regex },
      { username: regex },
      { fullName: regex },
      { companyName: regex }
    ];
  }

  if (company && company !== 'all') {
    if (company === '__unassigned__') {
      query.$or = [{ companyName: '' }, { companyName: { $exists: false } }, { companyName: null }];
    } else {
      query.companyName = company;
    }
  }

  if (role && role !== 'all') {
    query.role = role;
  }

  if (status === 'active') {
    query.isActive = true;
  } else if (status === 'inactive') {
    query.isActive = false;
  }

  const users = await User.find(query)
    .sort({ createdAt: -1 })
    .select('-password');

  res.status(200).json({
    status: 'success',
    results: users.length,
    data: {
      users
    }
  });
});

/**
 * Generate a new user under any account/company with specific permissions and balance
 */
exports.adminCreateUser = catchAsync(async (req, res, next) => {
  const {
    email,
    password,
    username,
    fullName,
    companyName,
    balance,
    role,
    allowedPages,
    accountType,
    streetName,
    houseNumber,
    postcode,
    cityName,
    telephone
  } = req.body;

  if (!email || !email.includes('@')) {
    return next(new AppError('Please provide a valid email address.', 400));
  }

  if (!password || password.length < 6) {
    return next(new AppError('Password must be at least 6 characters long.', 400));
  }

  const cleanEmail = email.trim().toLowerCase();

  const existing = await User.findOne({ email: cleanEmail });
  if (existing) {
    return next(new AppError('A user with this email address already exists.', 400));
  }

  let finalUsername = username ? username.trim() : cleanEmail.split('@')[0] + Math.floor(100 + Math.random() * 900);
  const existingUsername = await User.findOne({ username: finalUsername });
  if (existingUsername) {
    finalUsername = `${finalUsername}_${Math.floor(10 + Math.random() * 90)}`;
  }

  const defaultPages = [
    'stats', 'activity', 'open', 'labels', 'printed',
    'canceled', 'issues', 'trash', 'routing', 'inventory',
    'credit', 'invoices', 'settings'
  ];

  const newUser = await User.create({
    email: cleanEmail,
    password,
    username: finalUsername,
    fullName: fullName ? fullName.trim() : finalUsername,
    companyName: companyName ? companyName.trim() : 'EDER Partner',
    balance: balance !== undefined ? Math.max(0, Number(balance) || 0) : 0,
    role: role === 'admin' ? 'admin' : 'user',
    allowedPages: Array.isArray(allowedPages) && allowedPages.length > 0 ? allowedPages : defaultPages,
    accountType: accountType || 'standard',
    parentAccount: req.user?._id || null,
    isActive: true,
    streetName: streetName || '',
    houseNumber: houseNumber || '',
    postcode: postcode || '',
    cityName: cityName || '',
    telephone: telephone || ''
  });

  // If initial balance > 0, generate an invoice receipt
  if (newUser.balance > 0) {
    await Invoice.create({
      number: `INV-INIT-${Math.floor(1000 + Math.random() * 9000)}`,
      user: newUser._id,
      amount: newUser.balance,
      description: 'Initial Account Wallet Balance (Assigned by Agency Admin)',
      paymentMethod: 'Agency Admin Allocation',
      status: 'paid',
      date: new Date()
    }).catch(err => console.warn('Invoice creation warning on admin user create:', err.message));
  }

  res.status(201).json({
    status: 'success',
    message: 'User created successfully under account.',
    data: {
      user: {
        id: newUser._id,
        email: newUser.email,
        username: newUser.username,
        fullName: newUser.fullName,
        companyName: newUser.companyName,
        balance: newUser.balance,
        role: newUser.role,
        allowedPages: newUser.allowedPages,
        accountType: newUser.accountType,
        isActive: newUser.isActive,
        createdAt: newUser.createdAt
      }
    }
  });
});

/**
 * Adjust/balance money for any user (topup, deduct, or set balance)
 */
exports.adminAdjustBalance = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { action, amount, note } = req.body;

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount < 0) {
    return next(new AppError('Please provide a valid non-negative amount.', 400));
  }

  const user = await User.findById(id);
  if (!user) {
    return next(new AppError('User not found.', 404));
  }

  const prevBalance = Number(user.balance) || 0;
  let newBalance = prevBalance;

  if (action === 'topup' || action === 'credit') {
    newBalance = prevBalance + numAmount;
  } else if (action === 'deduct' || action === 'debit') {
    newBalance = Math.max(0, prevBalance - numAmount);
  } else if (action === 'set') {
    newBalance = numAmount;
  } else {
    return next(new AppError('Invalid balance action. Must be "topup", "deduct", or "set".', 400));
  }

  user.balance = Number(newBalance.toFixed(2));
  await user.save();

  const diff = Number((newBalance - prevBalance).toFixed(2));

  // Create an invoice record for audit trail
  const invoiceNumber = `ADJ-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  await Invoice.create({
    number: invoiceNumber,
    user: user._id,
    amount: Math.abs(diff),
    description: `Admin Balance Adjustment (${action.toUpperCase()}): ${note || 'Manual agency balance correction'} (Old: €${prevBalance.toFixed(2)} → New: €${newBalance.toFixed(2)})`,
    paymentMethod: 'Agency Admin Adjustment',
    status: 'paid',
    date: new Date()
  }).catch(err => console.warn('Invoice log warning on balance adjust:', err.message));

  // Send in-app notification to user
  await Notification.create({
    title: `Wallet Balance ${diff >= 0 ? 'Credited' : 'Adjusted'} by Admin`,
    message: `Your balance was changed by €${diff.toFixed(2)}. Current balance: €${newBalance.toFixed(2)}. Note: ${note || 'Agency Admin Adjustment'}`,
    type: diff >= 0 ? 'success' : 'info',
    user: user._id
  }).catch(err => console.warn('Notification warning on balance adjust:', err.message));

  res.status(200).json({
    status: 'success',
    message: `Balance updated successfully to €${newBalance.toFixed(2)}`,
    data: {
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        companyName: user.companyName,
        balance: user.balance
      },
      prevBalance,
      newBalance,
      diff
    }
  });
});

/**
 * Update user permissions (allowedPages, role, companyName, accountType)
 */
exports.adminUpdatePermissions = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { allowedPages, role, companyName, fullName, accountType } = req.body;

  const user = await User.findById(id);
  if (!user) {
    return next(new AppError('User not found.', 404));
  }

  if (Array.isArray(allowedPages)) {
    user.allowedPages = allowedPages;
  }

  if (role && ['user', 'admin'].includes(role)) {
    user.role = role;
  }

  if (companyName !== undefined) {
    user.companyName = companyName.trim();
  }

  if (fullName !== undefined) {
    user.fullName = fullName.trim();
  }

  if (accountType && ['standard', 'premium', 'trial'].includes(accountType)) {
    user.accountType = accountType;
  }

  await user.save();

  res.status(200).json({
    status: 'success',
    message: 'User permissions and profile updated successfully.',
    data: {
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
        companyName: user.companyName,
        balance: user.balance,
        role: user.role,
        allowedPages: user.allowedPages,
        accountType: user.accountType,
        isActive: user.isActive
      }
    }
  });
});

/**
 * Toggle user active/deactivated status
 */
exports.adminToggleStatus = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const user = await User.findById(id);
  if (!user) {
    return next(new AppError('User not found.', 404));
  }

  if (String(user._id) === String(req.user._id)) {
    return next(new AppError('You cannot deactivate your own admin account.', 400));
  }

  if (req.body.isActive !== undefined) {
    user.isActive = Boolean(req.body.isActive);
  } else {
    user.isActive = !user.isActive;
  }

  await user.save();

  res.status(200).json({
    status: 'success',
    message: `User account has been ${user.isActive ? 'activated' : 'deactivated'}.`,
    data: {
      id: user._id,
      email: user.email,
      isActive: user.isActive
    }
  });
});

/**
 * Admin directly resets user password
 */
exports.adminResetPassword = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return next(new AppError('New password must be at least 6 characters.', 400));
  }

  const user = await User.findById(id);
  if (!user) {
    return next(new AppError('User not found.', 404));
  }

  user.password = newPassword;
  await user.save();

  res.status(200).json({
    status: 'success',
    message: `Password successfully updated for ${user.email}.`
  });
});

/**
 * Admin deletes a user
 */
exports.adminDeleteUser = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  if (String(id) === String(req.user._id)) {
    return next(new AppError('You cannot delete your own admin account.', 400));
  }

  const user = await User.findByIdAndDelete(id);
  if (!user) {
    return next(new AppError('User not found.', 404));
  }

  res.status(200).json({
    status: 'success',
    message: `User ${user.email} was deleted successfully.`
  });
});

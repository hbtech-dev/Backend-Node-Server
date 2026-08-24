const User = require('../models/user.model');
const Invoice = require('../models/invoice.model');
const Notification = require('../models/notification.model');
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


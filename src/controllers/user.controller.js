const User = require('../models/user.model');
const Invoice = require('../models/invoice.model');
const Notification = require('../models/notification.model');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

exports.getMe = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  res.status(200).json({
    status: 'success',
    data: {
      user
    }
  });
});

exports.updateMe = catchAsync(async (req, res, next) => {
  const { email, username, fullName, companyName, streetName, houseNumber, postcode, cityName, contactEmail, telephone } = req.body;

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
  const { amount } = req.body;

  if (!amount || isNaN(amount) || amount <= 0) {
    return next(new AppError('Please provide a valid charge amount', 400));
  }

  const user = await User.findById(req.user.id);
  user.balance = (user.balance || 0) + parseFloat(amount);
  await user.save();

  // Create invoice
  const invoiceNumber = `INV-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  const invoice = await Invoice.create({
    number: invoiceNumber,
    user: user._id,
    amount: parseFloat(amount),
    status: 'paid',
    date: new Date()
  });

  // Create notification
  await Notification.create({
    title: 'Balance Top-Up Successful',
    message: `Charged €${parseFloat(amount).toFixed(2)} successfully!`,
    type: 'success',
    user: user._id
  });

  res.status(200).json({
    status: 'success',
    data: {
      user,
      invoice
    }
  });
});

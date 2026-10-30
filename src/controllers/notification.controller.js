const mongoose = require('mongoose');
const Notification = require('../models/notification.model');
const catchAsync = require('../utils/catchAsync');

exports.getMyNotifications = catchAsync(async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(200).json({
      status: 'success',
      results: 0,
      data: { notifications: [] }
    });
  }

  // Cap at 20 most recent notifications so badge number stays clean
  const notifications = await Notification.find({ user: req.user.id })
    .sort({ createdAt: -1 })
    .limit(20);

  res.status(200).json({
    status: 'success',
    results: notifications.length,
    data: {
      notifications
    }
  });
});

exports.markAllRead = catchAsync(async (req, res, next) => {
  if (mongoose.connection.readyState === 1) {
    await Notification.updateMany({ user: req.user.id, read: false }, { read: true });
  }

  res.status(200).json({
    status: 'success',
    message: 'All notifications marked as read'
  });
});

exports.clearAllNotifications = catchAsync(async (req, res, next) => {
  if (mongoose.connection.readyState === 1) {
    await Notification.deleteMany({ user: req.user.id });
  }

  res.status(200).json({
    status: 'success',
    message: 'All notifications cleared successfully'
  });
});

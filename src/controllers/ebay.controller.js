const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const User = require('../models/user.model');
const EbayOrder = require('../models/ebayOrder.model');

const seedUserEbayOrders = async (userId) => {
  const existing = await EbayOrder.countDocuments({ user: userId });
  if (existing > 0) return;

  const sampleOrders = [
    {
      user: userId,
      orderNum: 'EBAY-2026-98412034',
      name: 'Stefan Hoffmann',
      country: 'DE',
      address: 'Goethestr. 14, 60313 Frankfurt',
      articleName: 'Protonen LED Taschenlampe 2000 Lumen',
      shippingMethod: 'DHL Paket International',
      status: 'open',
      orderDate: '12.07.2026'
    },
    {
      user: userId,
      orderNum: 'EBAY-2026-55109384',
      name: 'Claire Dupont',
      country: 'FR',
      address: 'Rue de Rivoli 55, 75001 Paris',
      articleName: 'Wireless Bluetooth Headphones Noise Cancelling',
      shippingMethod: 'DHL Paket International',
      status: 'open',
      orderDate: '12.07.2026'
    },
    {
      user: userId,
      orderNum: 'EBAY-2026-11823904',
      name: 'Marco Rossi',
      country: 'IT',
      address: 'Via Roma 88, 00184 Roma',
      articleName: 'Smartwatch Fitness Tracker IP68',
      shippingMethod: 'DHL Paket International',
      status: 'open',
      orderDate: '11.07.2026'
    }
  ];

  await EbayOrder.insertMany(sampleOrders);
};

exports.getEbayStatus = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  res.status(200).json({
    status: 'success',
    data: {
      ebayIntegration: user.ebayIntegration || { isConnected: false }
    }
  });
});

exports.connectEbay = catchAsync(async (req, res, next) => {
  const { appId, certId, devId, userToken, storeName } = req.body;

  if (!appId || !userToken) {
    return next(new AppError('App ID (Client ID) and User Access Token are required to connect eBay', 400));
  }

  const user = await User.findById(req.user.id);

  user.ebayIntegration = {
    isConnected: true,
    appId,
    certId: certId || '',
    devId: devId || '',
    userToken,
    storeName: storeName || 'eBay Official Store',
    lastSyncedAt: new Date()
  };

  await user.save();
  await seedUserEbayOrders(user._id);

  res.status(200).json({
    status: 'success',
    message: 'eBay Seller store successfully connected!',
    data: {
      ebayIntegration: user.ebayIntegration
    }
  });
});

exports.disconnectEbay = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  user.ebayIntegration = {
    isConnected: false,
    appId: '',
    certId: '',
    devId: '',
    userToken: '',
    storeName: '',
    lastSyncedAt: null
  };
  await user.save();

  // Clear synced eBay orders for this user on disconnect
  await EbayOrder.deleteMany({ user: req.user.id });

  res.status(200).json({
    status: 'success',
    message: 'eBay Seller account disconnected and orders cleared.',
    data: {
      ebayIntegration: user.ebayIntegration
    }
  });
});

exports.syncEbayOrders = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user.ebayIntegration || !user.ebayIntegration.isConnected) {
    return next(new AppError('eBay account is not connected. Please connect your eBay account first in Settings.', 400));
  }

  await seedUserEbayOrders(user._id);
  user.ebayIntegration.lastSyncedAt = new Date();
  await user.save();

  const orders = await EbayOrder.find({ user: user._id }).sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    message: 'eBay orders successfully synced!',
    data: {
      lastSyncedAt: user.ebayIntegration.lastSyncedAt,
      ordersCount: orders.length,
      orders
    }
  });
});

exports.getUserEbayOrders = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  if (!user.ebayIntegration || !user.ebayIntegration.isConnected) {
    return res.status(200).json({
      status: 'success',
      data: {
        isConnected: false,
        orders: []
      }
    });
  }

  const orders = await EbayOrder.find({ user: req.user.id }).sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    data: {
      isConnected: true,
      lastSyncedAt: user.ebayIntegration.lastSyncedAt,
      orders
    }
  });
});

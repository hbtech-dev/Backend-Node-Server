const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const User = require('../models/user.model');
const TemuOrder = require('../models/temuOrder.model');

const buildFallbackProducts = (keyword) => {
  const normalized = keyword ? keyword.trim() : 'featured';

  return [
    {
      id: 'temu-demo-1',
      title: `${normalized} starter bundle`,
      price: 19.99,
      currency: 'USD',
      rating: 4.6,
      reviews: 128,
      source: 'demo'
    },
    {
      id: 'temu-demo-2',
      title: `${normalized} premium option`,
      price: 29.5,
      currency: 'USD',
      rating: 4.8,
      reviews: 96,
      source: 'demo'
    },
    {
      id: 'temu-demo-3',
      title: `${normalized} value pack`,
      price: 12.0,
      currency: 'USD',
      rating: 4.4,
      reviews: 83,
      source: 'demo'
    }
  ];
};

const seedUserTemuOrders = async (userId) => {
  const existing = await TemuOrder.countDocuments({ user: userId });
  if (existing > 0) return;

  const sampleOrders = [
    {
      user: userId,
      orderNum: 'PO-076-00175683098233977',
      temuOrderId: 'TEMU-849204921',
      name: 'Uebelhör Michael',
      country: 'DE',
      streetName: 'Hauptstraße',
      houseNumber: '45',
      postcode: '10115',
      cityName: 'Berlin',
      address: 'Hauptstraße 45, 10115 Berlin',
      email: 'uebelhoer.m@gmail.com',
      phone: '+49 151 84920194',
      articleName: 'Shilajit Harz 100% Natürlich – 50g Premium',
      sku: 'TM-SHI-001',
      quantity: 2,
      price: 24.99,
      weight: '0.45 kg',
      shippingMethod: 'DHL EDER International',
      tracking: 'LF620131973DE',
      qrCodeData: 'https://shipstation.fokkqtb.mongodb.net/track/LF620131973DE',
      barcodeData: '4012345678901',
      status: 'open',
      orderDate: '11.07.2026'
    },
    {
      user: userId,
      orderNum: 'PO-192-00224989092473747',
      temuOrderId: 'TEMU-551093849',
      name: 'Michel Scheidegger',
      country: 'CH',
      streetName: 'Bahnhofstrasse',
      houseNumber: '12',
      postcode: '8001',
      cityName: 'Zürich',
      address: 'Bahnhofstrasse 12, 8001 Zürich',
      email: 'm.scheidegger@bluewin.ch',
      phone: '+41 44 211 4000',
      articleName: 'Omega-3 Fischöl Kapseln – 180 Stück',
      sku: 'TM-OMG-002',
      quantity: 1,
      price: 18.50,
      weight: '0.35 kg',
      shippingMethod: 'DHL EDER International',
      tracking: 'LF620131960DE',
      qrCodeData: 'https://shipstation.fokkqtb.mongodb.net/track/LF620131960DE',
      barcodeData: '4012345678918',
      status: 'open',
      orderDate: '11.07.2026'
    },
    {
      user: userId,
      orderNum: 'PO-192-00516465055351944',
      temuOrderId: 'TEMU-118239048',
      name: 'Manuela Keller',
      country: 'CH',
      streetName: 'Dorfstrasse',
      houseNumber: '8',
      postcode: '3000',
      cityName: 'Bern',
      address: 'Dorfstrasse 8, 3000 Bern',
      email: 'manuela.keller@swiss.ch',
      phone: '+41 31 322 1111',
      articleName: 'Bio Kurkuma Kapseln – High Potency',
      sku: 'TM-KUR-003',
      quantity: 3,
      price: 14.99,
      weight: '0.60 kg',
      shippingMethod: 'DHL EDER International',
      tracking: 'LF620131956DE',
      qrCodeData: 'https://shipstation.fokkqtb.mongodb.net/track/LF620131956DE',
      barcodeData: '4012345678925',
      status: 'open',
      orderDate: '11.07.2026'
    },
    {
      user: userId,
      orderNum: 'PO-192-00135067269752235',
      temuOrderId: 'TEMU-772910482',
      name: 'Elisabeth Mossu',
      country: 'CH',
      streetName: 'Rue du Rhône',
      houseNumber: '24',
      postcode: '1204',
      cityName: 'Genève',
      address: 'Rue du Rhône 24, 1204 Genève',
      email: 'e.mossu@geneve.ch',
      phone: '+41 22 819 0000',
      articleName: 'Vitamin D3 + K2 Tropfen 50ml',
      sku: 'TM-VIT-004',
      quantity: 1,
      price: 16.90,
      weight: '0.20 kg',
      shippingMethod: 'DHL EDER International',
      tracking: 'LF620131942DE',
      qrCodeData: 'https://shipstation.fokkqtb.mongodb.net/track/LF620131942DE',
      barcodeData: '4012345678932',
      status: 'open',
      orderDate: '11.07.2026'
    },
    {
      user: userId,
      orderNum: 'PO-163-00423409285750581',
      temuOrderId: 'TEMU-339104827',
      name: 'Benilde Machado',
      country: 'PT',
      streetName: 'Rua Augusta',
      houseNumber: '100',
      postcode: '1100-053',
      cityName: 'Lisboa',
      address: 'Rua Augusta 100, 1100-053 Lisboa',
      email: 'benilde.machado@sapo.pt',
      phone: '+351 21 392 0000',
      articleName: 'Ashwagandha Kapseln Bio KSM-66',
      sku: 'TM-ASH-005',
      quantity: 2,
      price: 21.00,
      weight: '0.40 kg',
      shippingMethod: 'DHL EDER International',
      tracking: 'LF620131868DE',
      qrCodeData: 'https://shipstation.fokkqtb.mongodb.net/track/LF620131868DE',
      barcodeData: '4012345678949',
      status: 'open',
      orderDate: '11.07.2026'
    }
  ];

  await TemuOrder.insertMany(sampleOrders);
};

exports.getHealth = catchAsync(async (req, res, next) => {
  res.status(200).json({
    status: 'success',
    data: {
      service: 'temu',
      status: 'ready',
      configured: Boolean(process.env.TEMU_API_BASE_URL && process.env.TEMU_API_KEY)
    }
  });
});

exports.searchProducts = catchAsync(async (req, res, next) => {
  const keyword = req.query.keyword || req.query.q || 'featured products';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 6;

  const baseUrl = process.env.TEMU_API_BASE_URL;
  const apiKey = process.env.TEMU_API_KEY;

  if (baseUrl && apiKey) {
    try {
      const response = await fetch(`${baseUrl}/api/products/search?keyword=${encodeURIComponent(keyword)}&page=${page}&limit=${limit}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const payload = await response.json();
        const products = payload.products || payload.items || payload.results || [];

        return res.status(200).json({
          status: 'success',
          data: {
            keyword,
            page,
            limit,
            products
          }
        });
      }
    } catch (error) {
      // Fall back to seeded demo data below.
    }
  }

  res.status(200).json({
    status: 'success',
    data: {
      keyword,
      page,
      limit,
      products: buildFallbackProducts(keyword).slice(0, limit)
    }
  });
});

exports.getProductById = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const mocked = buildFallbackProducts(req.query.keyword || 'product').find((item) => item.id === id);

  if (!mocked) {
    return next(new AppError('Temu product not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      product: {
        ...mocked,
        id,
        description: 'Temu-style product detail placeholder generated by the backend.'
      }
    }
  });
});

exports.getCategories = catchAsync(async (req, res, next) => {
  res.status(200).json({
    status: 'success',
    data: {
      categories: [
        { id: 'electronics', name: 'Electronics' },
        { id: 'fashion', name: 'Fashion' },
        { id: 'home', name: 'Home' },
        { id: 'beauty', name: 'Beauty' }
      ]
    }
  });
});

// Temu Seller Account & Order Integration Controllers
exports.getTemuStatus = catchAsync(async (req, res, next) => {
  const mongoose = require('mongoose');
  const user = (mongoose.connection.readyState === 1 ? await User.findById(req.user.id) : null) || req.user;
  res.status(200).json({
    status: 'success',
    data: {
      temuIntegration: user.temuIntegration || { isConnected: true, shopName: 'Temu Official Store' }
    }
  });
});

exports.connectTemu = catchAsync(async (req, res, next) => {
  const { appKey, appSecret, sellerId, shopName } = req.body;

  if (!appKey || !appSecret) {
    return next(new AppError('App Key and App Secret are required to connect to Temu', 400));
  }

  const mongoose = require('mongoose');
  const user = (mongoose.connection.readyState === 1 ? await User.findById(req.user.id) : null) || req.user;

  user.temuIntegration = {
    isConnected: true,
    appKey,
    appSecret,
    sellerId: sellerId || `TEMU-SELLER-${Math.floor(100000 + Math.random() * 900000)}`,
    shopName: shopName || 'Temu Official Store',
    lastSyncedAt: new Date()
  };

  if (mongoose.connection.readyState === 1 && typeof user.save === 'function') {
    await user.save();
    await seedUserTemuOrders(user._id);
  }

  res.status(200).json({
    status: 'success',
    message: 'Temu Seller account successfully connected!',
    data: {
      temuIntegration: user.temuIntegration
    }
  });
});

exports.disconnectTemu = catchAsync(async (req, res, next) => {
  const mongoose = require('mongoose');
  const user = (mongoose.connection.readyState === 1 ? await User.findById(req.user.id) : null) || req.user;

  user.temuIntegration = {
    isConnected: false,
    appKey: '',
    appSecret: '',
    sellerId: '',
    shopName: '',
    lastSyncedAt: null
  };

  if (mongoose.connection.readyState === 1 && typeof user.save === 'function') {
    await user.save();
    await TemuOrder.deleteMany({ user: req.user.id });
  }

  res.status(200).json({
    status: 'success',
    message: 'Temu Seller account disconnected and orders cleared.',
    data: {
      temuIntegration: user.temuIntegration
    }
  });
});

exports.syncTemuOrders = catchAsync(async (req, res, next) => {
  const mongoose = require('mongoose');
  const user = (mongoose.connection.readyState === 1 ? await User.findById(req.user.id) : null) || req.user;

  if (!user.temuIntegration || !user.temuIntegration.isConnected) {
    return next(new AppError('Temu account is not connected. Please connect your Temu account first in Settings.', 400));
  }

  if (mongoose.connection.readyState === 1) {
    await seedUserTemuOrders(user._id);
    const temuSyncService = require('../services/temuSync.service');
    await temuSyncService.syncUserTemuOrders(user);
    user.temuIntegration.lastSyncedAt = new Date();
    if (typeof user.save === 'function') await user.save();
  }

  const filter = { user: user._id };
  if (req.query.status) {
    filter.status = req.query.status;
  }

  const orders = await TemuOrder.find(filter).sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    message: 'Temu orders successfully synced!',
    data: {
      lastSyncedAt: user.temuIntegration.lastSyncedAt,
      ordersCount: orders.length,
      orders
    }
  });
});

exports.getUserTemuOrders = catchAsync(async (req, res, next) => {
  const mongoose = require('mongoose');
  let user = req.user;

  if (mongoose.connection.readyState === 1) {
    user = await User.findById(req.user.id) || req.user;
  }
  
  if (!user.temuIntegration || !user.temuIntegration.isConnected) {
    return res.status(200).json({
      status: 'success',
      data: {
        isConnected: false,
        orders: []
      }
    });
  }

  let orders = [];
  if (mongoose.connection.readyState === 1) {
    const filter = { user: req.user.id };
    if (req.query.status) {
      filter.status = req.query.status;
    }
    orders = await TemuOrder.find(filter).sort({ createdAt: -1 });
  } else {
    // Offline fallback open unshipped orders
    orders = [
      {
        _id: 'temu-demo-1',
        orderNum: 'PO-076-00175683098233977',
        temuOrderId: 'TEMU-849204921',
        name: 'Uebelhör Michael',
        country: 'DE',
        streetName: 'Hauptstraße',
        houseNumber: '45',
        postcode: '10115',
        cityName: 'Berlin',
        address: 'Hauptstraße 45, 10115 Berlin',
        email: 'uebelhoer.m@gmail.com',
        phone: '+49 151 84920194',
        articleName: 'Shilajit Harz 100% Natürlich – 50g Premium',
        sku: 'TM-SHI-001',
        quantity: 2,
        price: 24.99,
        weight: '0.45 kg',
        shippingMethod: 'DHL EDER International',
        status: 'open',
        orderDate: '11.07.2026'
      },
      {
        _id: 'temu-demo-2',
        orderNum: 'PO-192-00224989092473747',
        temuOrderId: 'TEMU-551093849',
        name: 'Michel Scheidegger',
        country: 'CH',
        streetName: 'Bahnhofstrasse',
        houseNumber: '12',
        postcode: '8001',
        cityName: 'Zürich',
        address: 'Bahnhofstrasse 12, 8001 Zürich',
        email: 'm.scheidegger@bluewin.ch',
        phone: '+41 44 211 4000',
        articleName: 'Omega-3 Fischöl Kapseln – 180 Stück',
        sku: 'TM-OMG-002',
        quantity: 1,
        price: 18.50,
        weight: '0.35 kg',
        shippingMethod: 'DHL EDER International',
        status: 'open',
        orderDate: '11.07.2026'
      }
    ];
  }

  res.status(200).json({
    status: 'success',
    data: {
      isConnected: true,
      lastSyncedAt: user.temuIntegration?.lastSyncedAt || new Date(),
      orders
    }
  });
});

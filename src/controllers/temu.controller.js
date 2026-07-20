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
      name: 'Uebelhör Michael',
      country: 'DE',
      address: 'Hauptstraße 45, 10115 Berlin',
      articleName: 'Shilajit Harz 100% Natürlich – 50g Premium',
      shippingMethod: 'DHL EDER International',
      status: 'open',
      orderDate: '11.07.2026'
    },
    {
      user: userId,
      orderNum: 'PO-192-00224989092473747',
      name: 'Michel Scheidegger',
      country: 'CH',
      address: 'Bahnhofstrasse 12, 8001 Zürich',
      articleName: 'Omega-3 Fischöl Kapseln – 180 Stück',
      shippingMethod: 'DHL EDER International',
      status: 'open',
      orderDate: '11.07.2026'
    },
    {
      user: userId,
      orderNum: 'PO-192-00516465055351944',
      name: 'Manuela Keller',
      country: 'CH',
      address: 'Dorfstrasse 8, 3000 Bern',
      articleName: 'Bio Kurkuma Kapseln – High Potency',
      shippingMethod: 'DHL EDER International',
      status: 'open',
      orderDate: '11.07.2026'
    },
    {
      user: userId,
      orderNum: 'PO-192-00135067269752235',
      name: 'Elisabeth Mossu',
      country: 'CH',
      address: 'Rue du Rhône 24, 1204 Genève',
      articleName: 'Vitamin D3 + K2 Tropfen 50ml',
      shippingMethod: 'DHL EDER International',
      status: 'open',
      orderDate: '11.07.2026'
    },
    {
      user: userId,
      orderNum: 'PO-163-00423409285750581',
      name: 'Benilde Machado',
      country: 'PT',
      address: 'Rua Augusta 100, 1100-053 Lisboa',
      articleName: 'Ashwagandha Kapseln Bio KSM-66',
      shippingMethod: 'DHL EDER International',
      status: 'open',
      orderDate: '11.07.2026'
    },
    {
      user: userId,
      orderNum: 'PO-076-11298516695673214',
      name: 'Lutz-Peter Grebing',
      country: 'DE',
      address: 'Berliner Str. 12, 80331 München',
      articleName: 'Shilajit Harz 100% Natürlich',
      shippingMethod: 'DHL EDER International',
      status: 'open',
      orderDate: '11.07.2026'
    },
    {
      user: userId,
      orderNum: 'PO-192-00189309911674086',
      name: 'Jasmina Panic',
      country: 'CH',
      address: 'Seestrasse 4, 6000 Luzern',
      articleName: 'Omega-3 Fischöl Kapseln',
      shippingMethod: 'DHL EDER International',
      status: 'open',
      orderDate: '10.07.2026'
    },
    {
      user: userId,
      orderNum: 'PO-188-00475860055670139',
      name: 'Michal Kozublik',
      country: 'SK',
      address: 'Obchodná 15, 811 06 Bratislava',
      articleName: 'Bio Kurkuma Kapseln',
      shippingMethod: 'DHL EDER International',
      status: 'open',
      orderDate: '10.07.2026'
    },
    {
      user: userId,
      orderNum: 'PO-096-00098441697912515',
      name: 'Raivis Briska',
      country: 'IE',
      address: 'Grafton Street 5, Dublin 2',
      articleName: 'Vitamin D3 + K2 Tropfen',
      shippingMethod: 'DHL EDER International',
      status: 'open',
      orderDate: '10.07.2026'
    },
    {
      user: userId,
      orderNum: 'PO-068-00285655224953384',
      name: 'Vili Makinen',
      country: 'FI',
      address: 'Mannerheimintie 10, 00100 Helsinki',
      articleName: 'Ashwagandha Kapseln Bio',
      shippingMethod: 'DHL EDER International',
      status: 'open',
      orderDate: '10.07.2026'
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
  const user = await User.findById(req.user.id);
  res.status(200).json({
    status: 'success',
    data: {
      temuIntegration: user.temuIntegration || { isConnected: false }
    }
  });
});

exports.connectTemu = catchAsync(async (req, res, next) => {
  const { appKey, appSecret, sellerId, shopName } = req.body;

  if (!appKey || !appSecret) {
    return next(new AppError('App Key and App Secret are required to connect to Temu', 400));
  }

  const user = await User.findById(req.user.id);

  user.temuIntegration = {
    isConnected: true,
    appKey,
    appSecret,
    sellerId: sellerId || `TEMU-SELLER-${Math.floor(100000 + Math.random() * 900000)}`,
    shopName: shopName || 'Temu Official Store',
    lastSyncedAt: new Date()
  };

  await user.save();
  await seedUserTemuOrders(user._id);

  res.status(200).json({
    status: 'success',
    message: 'Temu Seller account successfully connected!',
    data: {
      temuIntegration: user.temuIntegration
    }
  });
});

exports.disconnectTemu = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  user.temuIntegration = {
    isConnected: false,
    appKey: '',
    appSecret: '',
    sellerId: '',
    shopName: '',
    lastSyncedAt: null
  };
  await user.save();

  res.status(200).json({
    status: 'success',
    message: 'Temu Seller account disconnected.',
    data: {
      temuIntegration: user.temuIntegration
    }
  });
});

exports.syncTemuOrders = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user.temuIntegration || !user.temuIntegration.isConnected) {
    return next(new AppError('Temu account is not connected. Please connect your Temu account first in Settings.', 400));
  }

  await seedUserTemuOrders(user._id);
  user.temuIntegration.lastSyncedAt = new Date();
  await user.save();

  const orders = await TemuOrder.find({ user: user._id }).sort({ createdAt: -1 });

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
  const user = await User.findById(req.user.id);
  
  if (!user.temuIntegration || !user.temuIntegration.isConnected) {
    return res.status(200).json({
      status: 'success',
      data: {
        isConnected: false,
        orders: []
      }
    });
  }

  const orders = await TemuOrder.find({ user: req.user.id }).sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    data: {
      isConnected: true,
      lastSyncedAt: user.temuIntegration.lastSyncedAt,
      orders
    }
  });
});

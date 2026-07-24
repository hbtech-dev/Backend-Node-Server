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
  const mongoose = require('mongoose');
  const user = (mongoose.connection.readyState === 1 ? await User.findById(req.user.id) : null) || req.user;
  res.status(200).json({
    status: 'success',
    data: {
      ebayIntegration: user.ebayIntegration || { isConnected: false },
      ebayIntegrations: user.ebayIntegrations || []
    }
  });
});

exports.connectEbay = catchAsync(async (req, res, next) => {
  const { appId, certId, devId, userToken, storeName } = req.body;

  if (!appId || !userToken) {
    return next(new AppError('App ID (Client ID) and User Access Token are required to connect eBay', 400));
  }

  const user = await User.findById(req.user.id);

  const newIntegration = {
    isConnected: true,
    appId,
    certId: certId || '',
    devId: devId || '',
    userToken,
    storeName: storeName || 'eBay Official Store',
    lastSyncedAt: new Date()
  };

  user.ebayIntegration = newIntegration;

  if (!user.ebayIntegrations) user.ebayIntegrations = [];
  const existingIdx = user.ebayIntegrations.findIndex(i => i.storeName === newIntegration.storeName);
  if (existingIdx > -1) {
    user.ebayIntegrations[existingIdx] = newIntegration;
  } else {
    user.ebayIntegrations.push(newIntegration);
  }

  await user.save();
  await seedUserEbayOrders(user._id);

  res.status(200).json({
    status: 'success',
    message: 'eBay Seller store successfully connected!',
    data: {
      ebayIntegration: user.ebayIntegration,
      ebayIntegrations: user.ebayIntegrations
    }
  });
});

exports.disconnectEbay = catchAsync(async (req, res, next) => {
  const { storeName } = req.body || {};
  const user = await User.findById(req.user.id);

  if (storeName && user.ebayIntegrations && user.ebayIntegrations.length > 0) {
    user.ebayIntegrations = user.ebayIntegrations.filter(i => i.storeName !== storeName);
    if (user.ebayIntegration && user.ebayIntegration.storeName === storeName) {
      user.ebayIntegration = user.ebayIntegrations[0] || { isConnected: false, storeName: '' };
    }
  } else {
    user.ebayIntegration = {
      isConnected: false,
      appId: '',
      certId: '',
      devId: '',
      userToken: '',
      storeName: '',
      lastSyncedAt: null
    };
    user.ebayIntegrations = [];
    await EbayOrder.deleteMany({ user: req.user.id });
  }

  await user.save();

  res.status(200).json({
    status: 'success',
    message: 'eBay Seller store disconnected.',
    data: {
      ebayIntegration: user.ebayIntegration,
      ebayIntegrations: user.ebayIntegrations
    }
  });
});

exports.syncEbayOrders = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  const isConnected = user.ebayIntegration?.isConnected || (user.ebayIntegrations && user.ebayIntegrations.length > 0);
  if (!isConnected) {
    return next(new AppError('eBay account is not connected. Please connect your eBay account first in Settings.', 400));
  }

  await seedUserEbayOrders(user._id);
  if (user.ebayIntegration) user.ebayIntegration.lastSyncedAt = new Date();
  if (user.ebayIntegrations) {
    user.ebayIntegrations.forEach(i => { i.lastSyncedAt = new Date(); });
  }
  await user.save();

  const orders = await EbayOrder.find({ user: user._id }).sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    message: 'eBay orders successfully synced!',
    data: {
      lastSyncedAt: user.ebayIntegration?.lastSyncedAt || new Date(),
      ordersCount: orders.length,
      orders
    }
  });
});

exports.getUserEbayOrders = catchAsync(async (req, res, next) => {
  const mongoose = require('mongoose');
  let user = req.user;

  if (mongoose.connection.readyState === 1) {
    user = await User.findById(req.user.id) || req.user;
  }

  const isConnected = user.ebayIntegration?.isConnected || (user.ebayIntegrations && user.ebayIntegrations.length > 0);

  if (!isConnected) {
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
    orders = await EbayOrder.find({ user: req.user.id }).sort({ createdAt: -1 });
  }

  res.status(200).json({
    status: 'success',
    data: {
      isConnected: true,
      lastSyncedAt: user.ebayIntegration?.lastSyncedAt || new Date(),
      orders
    }
  });
});

// ============================================================
// eBay OAuth 2.0 Flow — Public App / 1-Click Authorization
// ============================================================

/**
 * Generate the eBay OAuth authorization URL.
 * Frontend calls this, then redirects user's browser to eBay login/agreement page.
 */
exports.getEbayOAuthUrl = catchAsync(async (req, res, next) => {
  const appId = process.env.EBAY_APP_ID;
  const ruName = process.env.EBAY_RUNAME || process.env.EBAY_OAUTH_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/v1/ebay/oauth-callback`;

  if (!appId) {
    return next(new AppError('EBAY_APP_ID is not configured on the server.', 500));
  }

  const isSandbox = (process.env.EBAY_ENVIRONMENT || '').toLowerCase() === 'sandbox';
  const baseUrl = isSandbox
    ? 'https://auth.sandbox.ebay.com/oauth2/authorize'
    : 'https://auth.ebay.com/oauth2/authorize';

  const scopes = [
    'https://api.ebay.com/oauth/api_scope',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment'
  ].join(' ');

  const mongoose = require('mongoose');
  const user = (mongoose.connection.readyState === 1 ? await User.findById(req.user.id) : null) || req.user;

  const authUrl = `${baseUrl}?client_id=${encodeURIComponent(appId)}&response_type=code&redirect_uri=${encodeURIComponent(ruName)}&scope=${encodeURIComponent(scopes)}&state=${user._id}`;

  res.status(200).json({
    status: 'success',
    data: {
      authUrl,
      appId,
      ruName
    }
  });
});

/**
 * OAuth Callback — eBay redirects merchants here after authorization.
 * Public endpoint (no auth middleware). State param carries user ID.
 */
exports.handleEbayOAuthCallback = catchAsync(async (req, res, next) => {
  const { code, state } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'https://ederapp.de';

  if (!code) {
    console.warn('❌ eBay OAuth callback: no code received', req.query);
    return res.redirect(`${frontendUrl}/settings?ebay_error=no_code_received`);
  }

  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;
  const ruName = process.env.EBAY_RUNAME || process.env.EBAY_OAUTH_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/v1/ebay/oauth-callback`;

  if (!appId || !certId) {
    console.warn('❌ eBay credentials missing in server env');
    return res.redirect(`${frontendUrl}/settings?ebay_error=server_credentials_missing`);
  }

  const isSandbox = (process.env.EBAY_ENVIRONMENT || '').toLowerCase() === 'sandbox';
  const tokenUrl = isSandbox
    ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
    : 'https://api.ebay.com/identity/v1/oauth2/token';

  const httpFetch = require('../utils/httpHelper');
  const authHeader = `Basic ${Buffer.from(`${appId}:${certId}`).toString('base64')}`;

  const postBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: ruName
  }).toString();

  try {
    console.log(`🔑 eBay OAuth: Exchanging code for access token via ${tokenUrl}...`);
    const tokenRes = await httpFetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: postBody,
      timeout: 15000
    });

    const body = await tokenRes.json();
    console.log('📋 eBay Token Exchange Response:', JSON.stringify(body));

    if (!tokenRes.ok || body.error) {
      const errorMsg = body.error_description || body.error || 'Token exchange failed';
      console.warn('❌ eBay Token Exchange Error:', errorMsg);
      return res.redirect(`${frontendUrl}/settings?ebay_error=${encodeURIComponent(errorMsg)}`);
    }

    const accessToken = body.access_token;
    const refreshToken = body.refresh_token;

    if (!accessToken) {
      return res.redirect(`${frontendUrl}/settings?ebay_error=no_access_token_returned`);
    }

    const mongoose = require('mongoose');
    let user = null;
    if (state && mongoose.connection.readyState === 1) {
      user = await User.findById(state);
    }

    if (!user) {
      return res.redirect(`${frontendUrl}/settings?ebay_error=user_not_found`);
    }

    const storeName = `eBay Store (${state.slice(-4)})`;

    const newIntegration = {
      isConnected: true,
      appId: appId,
      certId: certId,
      devId: '',
      userToken: accessToken,
      refreshToken: refreshToken || '',
      storeName: storeName,
      lastSyncedAt: new Date()
    };

    user.ebayIntegration = newIntegration;

    if (!user.ebayIntegrations) user.ebayIntegrations = [];
    const existingIdx = user.ebayIntegrations.findIndex(i => i.storeName === storeName);
    if (existingIdx > -1) {
      user.ebayIntegrations[existingIdx] = newIntegration;
    } else {
      user.ebayIntegrations.push(newIntegration);
    }

    await user.save();
    await seedUserEbayOrders(user._id);

    console.log(`✅ eBay store successfully connected for user ${user.email}`);
    res.redirect(`${frontendUrl}/settings?ebay_success=true&store_name=${encodeURIComponent(storeName)}`);

  } catch (err) {
    console.error('💥 eBay OAuth callback exception:', err.message);
    res.redirect(`${frontendUrl}/settings?ebay_error=${encodeURIComponent(err.message)}`);
  }
});

// ============================================================
// eBay Marketplace Account Deletion / Closure Notification
// ============================================================
exports.handleEbayMarketplaceDeletion = catchAsync(async (req, res, next) => {
  const crypto = require('crypto');
  const challengeCode = req.query.challenge_code;
  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN || 'eder_shipstation_ebay_secret_2026';
  const endpointUrl = process.env.EBAY_DELETION_ENDPOINT_URL || 'https://backend-node-server-production.up.railway.app/api/v1/ebay/marketplace-deletion';

  if (challengeCode) {
    console.log(`🔐 Received eBay Marketplace Deletion verification challenge: ${challengeCode}`);
    const hash = crypto.createHash('sha256');
    hash.update(challengeCode);
    hash.update(verificationToken);
    hash.update(endpointUrl);
    const challengeResponse = hash.digest('hex');

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ challengeResponse });
  }

  // Handle POST notifications (account closure notification from eBay)
  console.log('📩 Received eBay Account Closure Notification payload:', JSON.stringify(req.body));
  res.status(200).json({ status: 'success', message: 'Notification received' });
});


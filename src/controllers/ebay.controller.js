const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const User = require('../models/user.model');
const EbayOrder = require('../models/ebayOrder.model');
const httpFetch = require('../utils/httpHelper');

// ============================================================
// Helpers: Token Refresh & API Base URL
// ============================================================

const getEbayApiBase = () => {
  const isSandbox = (process.env.EBAY_ENVIRONMENT || '').toLowerCase() === 'sandbox';
  return isSandbox ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
};

const getEbayAuthBase = () => {
  const isSandbox = (process.env.EBAY_ENVIRONMENT || '').toLowerCase() === 'sandbox';
  return isSandbox ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
};

/**
 * Refresh eBay access token using the stored refresh token.
 * Updates user record in DB with the new access token.
 */
const refreshEbayAccessToken = async (user) => {
  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;
  const refreshToken = user.ebayIntegration?.refreshToken;

  if (!refreshToken || !appId || !certId) {
    throw new Error('Missing eBay credentials or refresh token for token refresh');
  }

  const tokenUrl = `${getEbayAuthBase()}/identity/v1/oauth2/token`;
  const authHeader = `Basic ${Buffer.from(`${appId}:${certId}`).toString('base64')}`;

  const scopes = [
    'https://api.ebay.com/oauth/api_scope',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    'https://api.ebay.com/oauth/api_scope/sell.account',
    'https://api.ebay.com/oauth/api_scope/sell.account.readonly'
  ].join(' ');

  const postBody = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: scopes
  }).toString();

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

  if (!tokenRes.ok || body.error) {
    console.error('❌ eBay token refresh failed:', body.error_description || body.error);
    throw new Error(body.error_description || body.error || 'Token refresh failed');
  }

  // Update stored access token
  user.ebayIntegration.userToken = body.access_token;
  if (body.refresh_token) {
    user.ebayIntegration.refreshToken = body.refresh_token;
  }

  // Also update in ebayIntegrations array
  if (user.ebayIntegrations && user.ebayIntegrations.length > 0) {
    user.ebayIntegrations.forEach(integration => {
      if (integration.isConnected) {
        integration.userToken = body.access_token;
        if (body.refresh_token) {
          integration.refreshToken = body.refresh_token;
        }
      }
    });
  }

  await user.save();
  console.log('🔄 eBay access token refreshed successfully');
  return body.access_token;
};

/**
 * Make an authenticated eBay API call. Auto-refreshes token on 401.
 */
const ebayApiCall = async (user, method, path, body = null) => {
  let accessToken = user.ebayIntegration?.userToken;
  if (!accessToken) {
    throw new Error('No eBay access token available. Please reconnect your eBay account.');
  }

  const url = `${getEbayApiBase()}${path}`;
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  let res = await httpFetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, timeout: 20000 });

  // If 401, try refreshing the token and retry once
  if (res.status === 401) {
    console.log('🔄 eBay API returned 401, attempting token refresh...');
    try {
      accessToken = await refreshEbayAccessToken(user);
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await httpFetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, timeout: 20000 });
    } catch (refreshErr) {
      console.error('❌ Token refresh failed:', refreshErr.message);
      throw new Error('eBay session expired. Please reconnect your eBay account in Settings.');
    }
  }

  return res;
};

// ============================================================
// Fetch Real eBay Orders via Fulfillment API
// ============================================================

/**
 * Fetch unshipped orders from eBay Fulfillment API and upsert into EbayOrder collection.
 * Uses: GET /sell/fulfillment/v1/order?filter=orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}
 */
const fetchEbayOrdersFromAPI = async (user) => {
  const isConnected = user.ebayIntegration?.isConnected;
  if (!isConnected) return [];

  try {
    // Fetch unshipped orders (NOT_STARTED = awaiting shipment, IN_PROGRESS = partially shipped)
    const filterStr = encodeURIComponent('orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}');
    const path = `/sell/fulfillment/v1/order?filter=${filterStr}&limit=50`;

    const res = await ebayApiCall(user, 'GET', path);
    const data = await res.json();

    if (!res.ok) {
      console.error('❌ eBay Fulfillment API error:', JSON.stringify(data));
      // If there are existing orders in DB, return them instead of failing
      const existingOrders = await EbayOrder.find({ user: user._id, status: 'open' });
      if (existingOrders.length > 0) {
        console.log(`📦 Returning ${existingOrders.length} cached eBay orders from DB`);
        return existingOrders;
      }
      return [];
    }

    const ebayOrders = data.orders || [];
    console.log(`📦 eBay API returned ${ebayOrders.length} unshipped orders`);

    const upsertedOrders = [];

    for (const ebayOrder of ebayOrders) {
      const orderId = ebayOrder.orderId;
      const buyerName = ebayOrder.buyer?.username || 'eBay Buyer';
      const shippingAddr = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo || {};
      const contactAddr = shippingAddr.contactAddress || {};
      const fullName = shippingAddr.fullName || contactAddr.fullName || buyerName;

      // Parse address
      const addressLine1 = contactAddr.addressLine1 || '';
      const addressLine2 = contactAddr.addressLine2 || '';
      const city = contactAddr.city || '';
      const stateOrProvince = contactAddr.stateOrProvince || '';
      const postalCode = contactAddr.postalCode || '';
      const countryCode = contactAddr.countryCode || 'DE';
      const fullAddress = [addressLine1, addressLine2, postalCode, city, stateOrProvince].filter(Boolean).join(', ');

      const phone = shippingAddr.primaryPhone?.phoneNumber || '';
      const email = shippingAddr.email || ebayOrder.buyer?.buyerRegistrationAddress?.email || '';

      // Parse line items
      const lineItems = ebayOrder.lineItems || [];
      const firstItem = lineItems[0] || {};
      const articleName = firstItem.title || 'eBay Item';
      const sku = firstItem.sku || firstItem.legacyItemId || '';
      const quantity = lineItems.reduce((sum, li) => sum + (li.quantity || 1), 0);
      const totalPrice = parseFloat(ebayOrder.pricingSummary?.total?.value || '0');
      const lineItemId = firstItem.lineItemId || '';
      const productImage = firstItem.image?.imageUrl || '';

      // Create order number in our format
      const orderNum = `EBAY-${orderId}`;

      // Parse order date
      const orderDate = ebayOrder.creationDate
        ? new Date(ebayOrder.creationDate).toLocaleDateString('de-DE')
        : new Date().toLocaleDateString('de-DE');

      // Upsert: update if exists, create if not
      const orderData = {
        user: user._id,
        ebayOrderId: orderId,
        lineItemId: lineItemId,
        orderNum: orderNum,
        orderDate: orderDate,
        name: fullName,
        country: countryCode,
        address: fullAddress,
        streetName: addressLine1,
        houseNumber: addressLine2,
        postcode: postalCode,
        cityName: city,
        email: email,
        phone: phone,
        articleName: articleName,
        productImage: productImage,
        sku: sku,
        quantity: quantity,
        price: totalPrice,
        status: 'open',
        source: 'eBay'
      };

      const upserted = await EbayOrder.findOneAndUpdate(
        { user: user._id, ebayOrderId: orderId },
        { $set: orderData },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      upsertedOrders.push(upserted);
    }

    console.log(`✅ Upserted ${upsertedOrders.length} eBay orders into DB`);
    return upsertedOrders;

  } catch (err) {
    console.error('❌ fetchEbayOrdersFromAPI error:', err.message);
    // Fallback: return existing orders from DB
    const existingOrders = await EbayOrder.find({ user: user._id, status: 'open' });
    if (existingOrders.length > 0) {
      console.log(`📦 Returning ${existingOrders.length} cached eBay orders from DB`);
      return existingOrders;
    }
    return [];
  }
};

// ============================================================
// Upload Tracking to eBay (after DHL/FedEx label creation)
// ============================================================

/**
 * Upload shipping fulfillment (tracking) to eBay for a specific order.
 * Uses: POST /sell/fulfillment/v1/order/{orderId}/shipping_fulfillment
 */
const uploadTrackingToEbay = async (user, ebayOrder) => {
  if (!ebayOrder.ebayOrderId || !ebayOrder.tracking) {
    console.log('⏭️  Skipping eBay tracking upload: missing ebayOrderId or tracking number');
    return null;
  }

  try {
    // Map carrier name to eBay carrier enum
    const carrierMap = {
      'DHL': 'DHL',
      'DHL Paket': 'DHL',
      'DHL Paket International': 'DHL',
      'DHL Express': 'DHL_EXPRESS',
      'FedEx': 'FEDEX',
      'FedEx International Priority': 'FEDEX',
      'FedEx Express': 'FEDEX'
    };

    const shippingCarrier = carrierMap[ebayOrder.shippingMethod] || 'DHL';

    // Build line item references
    const lineItems = [];
    if (ebayOrder.lineItemId) {
      lineItems.push({
        lineItemId: ebayOrder.lineItemId,
        quantity: ebayOrder.quantity || 1
      });
    }

    const fulfillmentPayload = {
      trackingNumber: ebayOrder.tracking,
      shippingCarrierCode: shippingCarrier,
      shippedDate: new Date().toISOString()
    };

    // Only include lineItems if we have them
    if (lineItems.length > 0) {
      fulfillmentPayload.lineItems = lineItems;
    }

    const path = `/sell/fulfillment/v1/order/${ebayOrder.ebayOrderId}/shipping_fulfillment`;
    const res = await ebayApiCall(user, 'POST', path, fulfillmentPayload);

    if (res.ok || res.status === 201) {
      console.log(`✅ Tracking ${ebayOrder.tracking} uploaded to eBay for order ${ebayOrder.ebayOrderId}`);
      return { success: true };
    } else {
      const errorBody = await res.json();
      console.warn('⚠️ eBay tracking upload response:', JSON.stringify(errorBody));
      // Don't throw — tracking upload failure shouldn't block the shipping flow
      return { success: false, error: errorBody };
    }
  } catch (err) {
    console.error('❌ eBay tracking upload error:', err.message);
    return { success: false, error: err.message };
  }
};

// ============================================================
// Route Handlers
// ============================================================

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

  // Fetch real orders after manual connect
  await fetchEbayOrdersFromAPI(user);

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
      refreshToken: '',
      storeName: '',
      lastSyncedAt: null
    };
    user.ebayIntegrations = [];
  }

  // Remove all eBay orders for this user when fully disconnecting
  await EbayOrder.deleteMany({ user: req.user.id });

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

  // Fetch real orders from eBay Fulfillment API
  await fetchEbayOrdersFromAPI(user);

  // Update last synced timestamp
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
// Upload Tracking Number to eBay (exposed as route handler)
// ============================================================

exports.uploadTracking = catchAsync(async (req, res, next) => {
  const { orderId } = req.body;

  if (!orderId) {
    return next(new AppError('Order ID is required', 400));
  }

  const user = await User.findById(req.user.id);
  const ebayOrder = await EbayOrder.findOne({ _id: orderId, user: user._id });

  if (!ebayOrder) {
    return next(new AppError('eBay order not found', 404));
  }

  if (!ebayOrder.tracking) {
    return next(new AppError('No tracking number on this order. Ship the order first.', 400));
  }

  const result = await uploadTrackingToEbay(user, ebayOrder);

  res.status(200).json({
    status: 'success',
    message: result?.success ? 'Tracking uploaded to eBay!' : 'Tracking upload attempted (check logs)',
    data: result
  });
});

// Export the tracking upload helper for use from DHL controller
exports.uploadTrackingToEbay = uploadTrackingToEbay;

// ============================================================
// Token Refresh (exposed as route handler)
// ============================================================

exports.refreshToken = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  if (!user.ebayIntegration?.isConnected) {
    return next(new AppError('No eBay account connected', 400));
  }

  const newToken = await refreshEbayAccessToken(user);

  res.status(200).json({
    status: 'success',
    message: 'eBay token refreshed successfully',
    data: { tokenRefreshed: true }
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
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    'https://api.ebay.com/oauth/api_scope/sell.account',
    'https://api.ebay.com/oauth/api_scope/sell.account.readonly'
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

  const tokenUrl = `${getEbayAuthBase()}/identity/v1/oauth2/token`;
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
    console.log('📋 eBay Token Exchange Response status:', tokenRes.status);

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
      devId: process.env.EBAY_DEV_ID || '',
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

    // Auto-fetch real orders from eBay after successful OAuth
    console.log('📦 Auto-fetching eBay orders after OAuth connect...');
    await fetchEbayOrdersFromAPI(user);

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

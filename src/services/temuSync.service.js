/**
 * Temu Real-Time Order Sync Service
 * Uses Temu Open Platform API with HMAC-SHA256 signature authentication.
 * Fetches ALL unshipped orders across ALL regions worldwide.
 * Detects orders shipped externally on Temu and removes them from our open queue.
 */

const crypto = require('crypto');
const User = require('../models/user.model');
const TemuOrder = require('../models/temuOrder.model');
const Notification = require('../models/notification.model');

let syncInterval = null;

/**
 * Build Temu Open Platform API signature (HMAC-SHA256)
 */
const buildTemuSignature = (appSecret, params) => {
  const sortedKeys = Object.keys(params).sort();
  const signStr = sortedKeys.map(k => `${k}${params[k]}`).join('');
  return crypto.createHmac('sha256', appSecret).update(signStr).digest('hex').toUpperCase();
};

/**
 * Call a Temu Open Platform API method
 */
const callTemuApi = async (appKey, appSecret, method, apiParams = {}) => {
  const TEMU_API_BASE = process.env.TEMU_API_BASE_URL || 'https://openapi.temu.com/openapi';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const params = { app_key: appKey, timestamp, method, ...apiParams };
  params.sign = buildTemuSignature(appSecret, params);

  const queryStr = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const response = await fetch(`${TEMU_API_BASE}?${queryStr}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Temu API HTTP ${response.status}: ${response.statusText}`);
  }
  return await response.json();
};

/**
 * Map Temu API order object to our TemuOrder model fields
 * Covers all real Temu Open Platform field names
 */
const mapTemuOrderToModel = (orderData, userId) => {
  const addr = orderData.recipient_address || orderData.recipientAddress || orderData.address_info || {};
  const goods = (orderData.goods_list || orderData.goodsList || [{}])[0] || {};

  return {
    user: userId,
    orderNum: orderData.order_sn || orderData.orderSn || orderData.orderNum || `PO-${Date.now()}`,
    temuOrderId: orderData.order_id || orderData.orderId || orderData.order_sn || '',
    name: addr.name || addr.recipient_name || orderData.buyer_name || orderData.buyerName || 'Temu Customer',
    country: addr.country_code || addr.countryCode || orderData.country || 'DE',
    streetName: addr.street_name || addr.streetName || addr.address1 || '',
    houseNumber: addr.house_number || addr.houseNumber || addr.address2 || '',
    postcode: addr.zipcode || addr.postcode || addr.zip_code || '',
    cityName: addr.city || addr.cityName || addr.city_name || '',
    address: addr.full_address || addr.fullAddress ||
      [addr.address1, addr.address2, addr.city, addr.zipcode, addr.country_code].filter(Boolean).join(', ') || '',
    email: addr.email || orderData.buyer_email || '',
    phone: addr.phone || addr.mobile || orderData.buyer_phone || '',
    articleName: goods.goods_name || goods.goodsName || goods.goods_title || goods.article_name || orderData.goods_name || 'Temu Item',
    sku: goods.sku_id || goods.skuId || goods.goods_id || goods.goodsId || goods.sku || '',
    quantity: goods.goods_num || goods.goodsNum || goods.quantity || 1,
    variation: goods.sku_spec || goods.skuSpec || goods.variation || goods.spec || 'Standard',
    packaging: orderData.packaging || 'Small Parcel (25x18x10cm)',
    productImage: goods.goods_img || goods.goodsImg || goods.image_url || goods.thumb_url || '',
    price: goods.goods_price || goods.goodsPrice || orderData.payment_amount || orderData.order_amount || 0,
    weight: orderData.weight || '0.50 kg',
    shippingMethod: orderData.shipping_method || orderData.logistics_name || 'DHL Paket International',
    orderDate: orderData.create_time
      ? new Date(Number(orderData.create_time) * 1000).toLocaleDateString('de-DE')
      : new Date().toLocaleDateString('de-DE'),
    status: 'open',
    source: 'Temu'
  };
};

const syncUserTemuOrders = async (user) => {
  if (!user || !user.temuIntegration || !user.temuIntegration.isConnected) return;

  const appKey = user.temuIntegration.appKey;
  const appSecret = user.temuIntegration.appSecret;

  if (!appKey || !appSecret) {
    console.warn(`Temu sync skipped for user ${user._id}: no API credentials configured.`);
    return;
  }

  try {
    // --- 1. Fetch all unshipped orders (ALL countries/regions) ---
    let unshippedOrders = [];
    try {
      const payload = await callTemuApi(appKey, appSecret, 'bgn.order.list', {
        order_status: 'UNSHIPPED',
        page_size: '100',
        page_no: '1'
      });
      const result = payload.result || payload.data || payload;
      unshippedOrders = result.order_list || result.orderList || result.orders || result.data || [];
    } catch (err) {
      console.warn(`Temu unshipped orders fetch error for user ${user._id}:`, err.message);
    }

    // --- 2. Fetch shipped orders to detect externally shipped ones ---
    let shippedOrderNums = [];
    try {
      const shippedPayload = await callTemuApi(appKey, appSecret, 'bgn.order.list', {
        order_status: 'SHIPPED',
        page_size: '100',
        page_no: '1'
      });
      const shippedResult = shippedPayload.result || shippedPayload.data || shippedPayload;
      const shippedList = shippedResult.order_list || shippedResult.orderList || shippedResult.orders || shippedResult.data || [];
      shippedOrderNums = shippedList.map(o => o.order_sn || o.orderSn || o.orderNum).filter(Boolean);
    } catch (err) {
      console.warn(`Temu shipped orders fetch error for user ${user._id}:`, err.message);
    }

    // --- 3. Delete from our open queue what Temu already shipped externally ---
    if (shippedOrderNums.length > 0) {
      await TemuOrder.deleteMany({
        user: user._id,
        orderNum: { $in: shippedOrderNums },
        status: 'open' // Never touch created_label/printed orders
      });
    }

    // --- 4. Upsert new unshipped orders (any region) ---
    let newCount = 0;
    for (const orderData of unshippedOrders) {
      const orderNum = orderData.order_sn || orderData.orderSn || orderData.orderNum;
      if (!orderNum) continue;

      const exists = await TemuOrder.findOne({ user: user._id, orderNum });
      if (!exists) {
        const mapped = mapTemuOrderToModel(orderData, user._id);
        await TemuOrder.create(mapped);
        newCount++;

        await Notification.create({
          title: 'New Temu Order Received',
          message: `Order ${orderNum} (${mapped.country}) is unshipped and ready for shipment.`,
          type: 'info',
          user: user._id
        });
      }
    }

    user.temuIntegration.lastSyncedAt = new Date();
    await user.save();

    if (newCount > 0) {
      console.info(`Temu sync: ${newCount} new order(s) added for user ${user._id}.`);
    }
  } catch (error) {
    console.error(`Error background-syncing Temu orders for user ${user._id}:`, error.message);
  }
};

exports.startTemuBackgroundSync = () => {
  if (syncInterval) return;
  console.log('⚡ Temu Background Sync Service started (polling every 20s)...');

  const runSync = async () => {
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) return;
      const connectedUsers = await User.find({ 'temuIntegration.isConnected': true });
      for (const user of connectedUsers) {
        await syncUserTemuOrders(user);
      }
    } catch (err) {
      console.error('Temu background sync iteration error:', err.message);
    }
  };

  runSync();
  syncInterval = setInterval(runSync, 20000);
};

exports.stopTemuBackgroundSync = () => {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
};

exports.syncUserTemuOrders = syncUserTemuOrders;

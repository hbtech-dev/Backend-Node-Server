/**
 * Temu Real-Time Order Sync Service
 * Uses Temu Open Platform API Router with MD5 signature authentication.
 * Fetches ALL unshipped orders across ALL regions worldwide (EU, Global, US).
 * Detects orders shipped externally on Temu and removes them from open queue.
 */

const crypto = require('crypto');
const User = require('../models/user.model');
const TemuOrder = require('../models/temuOrder.model');
const Notification = require('../models/notification.model');

let syncInterval = null;

/**
 * Call Temu Open Platform Router API across ALL regional endpoints (EU, Global, US)
 * and combine orders from all regions so no country's orders are missed.
 */
const callTemuRouterAllRegions = async (appKey, appSecret, accessToken, type, params = {}) => {
  const routerUrls = [
    'https://openapi-b-eu.temu.com/openapi/router',
    'https://openapi-b-global.temu.com/openapi/router',
    'https://openapi-b-us.temu.com/openapi/router'
  ];

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = {
    app_key: appKey,
    access_token: accessToken || '',
    timestamp,
    type,
    ...params
  };

  const sortedKeys = Object.keys(payload).sort();
  const signStr = appSecret + sortedKeys.map(k => `${k}${payload[k]}`).join('') + appSecret;
  const sign = crypto.createHash('md5').update(signStr).digest('hex').toUpperCase();

  const bodyData = { ...payload, sign };
  let combinedOrders = [];

  for (const url of routerUrls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData),
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success || data.result || data.data) {
          const result = data.result || data.data || data;
          const list = result.order_list || result.orderList || result.orders || result.data || [];
          if (Array.isArray(list) && list.length > 0) {
            combinedOrders.push(...list);
          }
        }
      }
    } catch (e) {
      console.warn(`Temu router error hitting ${url}:`, e.message);
    }
  }

  return combinedOrders;
};

/**
 * Map Temu API order object to our TemuOrder model fields
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
  const accessToken = user.temuIntegration.accessToken;

  if (!appKey || !appSecret) {
    return;
  }

  try {
    // --- 1. Fetch all unshipped orders (ALL countries/regions: EU, Global, US) ---
    const unshippedOrders = await callTemuRouterAllRegions(appKey, appSecret, accessToken, 'bg.order.list.v2.get', {
      order_status: '1', // 1 = Unshipped / Pending Fulfillment in Temu API
      page_size: '100',
      page_no: '1'
    });

    // --- 2. Fetch shipped orders to detect externally shipped ones ---
    const shippedList = await callTemuRouterAllRegions(appKey, appSecret, accessToken, 'bg.order.list.v2.get', {
      order_status: '2', // 2 = Shipped / Fulfilled in Temu API
      page_size: '100',
      page_no: '1'
    });
    const shippedOrderNums = shippedList.map(o => o.order_sn || o.orderSn || o.orderNum).filter(Boolean);

    // --- 3. Delete from open queue what Temu already shipped externally ---
    if (shippedOrderNums.length > 0) {
      await TemuOrder.deleteMany({
        user: user._id,
        orderNum: { $in: shippedOrderNums },
        status: 'open'
      });
    }

    // --- 4. Upsert new unshipped orders ---
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

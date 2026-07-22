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

const httpFetch = require('../utils/httpHelper');

/**
 * Call Temu Open Platform Router API across ALL regional endpoints (EU, Global, US)
 * and combine orders from all regions so no country's orders are missed.
 */
const callTemuRouterAllRegions = async (appKey, appSecret, accessToken, type, params = {}) => {
  // Your Temu app (EDER) is registered on the EU platform.
  // Global and US endpoints return errorCode 4000000 ("application information query is abnormal")
  // because the app only exists on EU. Only query EU to avoid noise errors.
  const routerUrls = [
    'https://openapi-b-eu.temu.com/openapi/router'
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
      const res = await httpFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData),
        timeout: 15000
      });
      if (res.ok) {
        const data = await res.json();
        
        // Temu Open API uses errorCode: 1000000 / 0 / success: true to indicate success
        const isOk = data.success === true || data.errorCode === 1000000 || data.errorCode === 0 || Boolean(data.result) || Boolean(data.data);
        if (isOk) {
          const result = data.result || data.response || data.data || data;
          
          // Temu bg.order.list.v2.get returns { result: { totalItemNum, pageItems: [...] } }
          const list = result.pageItems || result.page_items || result.order_list || result.orderList || result.orders || result.order_sn_list || result.data || [];
          
          if (Array.isArray(list) && list.length > 0) {
            console.log(`✅ Fetched ${list.length} order(s) from ${url} (totalItemNum: ${result.totalItemNum || result.total_item_num || '?'})`);
            // Log the first item's full structure so we can map the fields correctly
            console.log(`📦 First order item structure:`, JSON.stringify(list[0]).slice(0, 800));
            combinedOrders.push(...list);
          } else {
            console.log(`📡 Temu API responded OK from ${url} but 0 items in list. totalItemNum: ${result.totalItemNum || result.total_item_num || '?'}`);
          }
        } else {
          console.warn(`⚠️ Temu API error from ${url}: ${data.errorMsg || data.error_msg || 'unknown'} (code: ${data.errorCode || data.error_code})`);
        }
      }
    } catch (e) {
      console.warn(`Temu router error hitting ${url}:`, e.message);
    }
  }

  return combinedOrders;
};

/**
 * Map Temu API order object to our TemuOrder model fields.
 * Temu bg.order.list.v2.get returns each pageItem as:
 *   { parentOrderMap: { parentOrderSn, orderItemList: [...], addressInfo: {...}, ... } }
 */
const mapTemuOrderToModel = (rawItem, userId) => {
  // Unwrap parentOrderMap if present (Temu v2 format)
  const orderData = rawItem.parentOrderMap || rawItem;
  
  // Extract address — Temu uses addressInfo or recipientAddress
  const addr = orderData.addressInfo || orderData.address_info || orderData.recipient_address || orderData.recipientAddress || {};
  
  // Extract goods — Temu uses orderItemList with nested items
  const itemList = orderData.orderItemList || orderData.order_item_list || orderData.goods_list || orderData.goodsList || orderData.item_list || orderData.itemList || [];
  const firstItem = itemList[0] || {};
  // Inside each orderItem there may be a nested goodsList
  const goods = (firstItem.goodsList || firstItem.goods_list || [firstItem])[0] || firstItem;

  // Extract country code from address or order-level fields
  let rawCountry = (
    addr.countryCode ||
    addr.country_code ||
    addr.country ||
    addr.countryId ||
    addr.country_id ||
    orderData.countryCode ||
    orderData.country_code ||
    orderData.country ||
    orderData.regionCode ||
    orderData.region_code ||
    orderData.siteId ||
    orderData.site_id ||
    orderData.region ||
    'EU'
  ).toString().toUpperCase().trim();

  // Clean country code if full country name was passed
  if (rawCountry.length > 2) {
    if (rawCountry.includes('POLAND') || rawCountry.includes('POLSKA')) rawCountry = 'PL';
    else if (rawCountry.includes('GERMANY') || rawCountry.includes('DEUTSCHLAND')) rawCountry = 'DE';
    else if (rawCountry.includes('NETHERLANDS') || rawCountry.includes('HOLLAND')) rawCountry = 'NL';
    else if (rawCountry.includes('SPAIN') || rawCountry.includes('ESPAÑA')) rawCountry = 'ES';
    else if (rawCountry.includes('FRANCE')) rawCountry = 'FR';
    else if (rawCountry.includes('ITALY') || rawCountry.includes('ITALIA')) rawCountry = 'IT';
    else if (rawCountry.includes('UNITED KINGDOM') || rawCountry.includes('GREAT BRITAIN')) rawCountry = 'GB';
    else if (rawCountry.includes('PORTUGAL')) rawCountry = 'PT';
    else if (rawCountry.includes('SWEDEN') || rawCountry.includes('SVERIGE')) rawCountry = 'SE';
    else if (rawCountry.includes('SWITZERLAND') || rawCountry.includes('SCHWEIZ')) rawCountry = 'CH';
    else if (rawCountry.includes('GREECE')) rawCountry = 'GR';
    else if (rawCountry.includes('IRELAND')) rawCountry = 'IE';
    else if (rawCountry.includes('CYPRUS')) rawCountry = 'CY';
    else if (rawCountry.includes('CZECH')) rawCountry = 'CZ';
    else if (rawCountry.includes('HUNGARY')) rawCountry = 'HU';
    else if (rawCountry.includes('DENMARK') || rawCountry.includes('DANMARK')) rawCountry = 'DK';
    else if (rawCountry.includes('ROMANIA')) rawCountry = 'RO';
    else if (rawCountry.includes('BULGARIA')) rawCountry = 'BG';
    else if (rawCountry.includes('BELGIUM')) rawCountry = 'BE';
    else if (rawCountry.includes('AUSTRIA') || rawCountry.includes('ÖSTERREICH')) rawCountry = 'AT';
    else if (rawCountry.includes('FINLAND') || rawCountry.includes('SUOMI')) rawCountry = 'FI';
    else if (rawCountry.includes('SLOVAKIA')) rawCountry = 'SK';
    else if (rawCountry.includes('CROATIA') || rawCountry.includes('HRVATSKA')) rawCountry = 'HR';
    else if (rawCountry.includes('SLOVENIA')) rawCountry = 'SI';
    else if (rawCountry.includes('LITHUANIA')) rawCountry = 'LT';
    else if (rawCountry.includes('ESTONIA')) rawCountry = 'EE';
    else if (rawCountry.includes('LATVIA')) rawCountry = 'LV';
    else if (rawCountry.includes('ICELAND')) rawCountry = 'IS';
    else if (rawCountry.includes('UNITED STATES') || rawCountry.includes('AMERICA')) rawCountry = 'US';
    else rawCountry = rawCountry.substring(0, 2);
  }

  // Temu uses parentOrderSn as the main order number (e.g. PO-186-03626858276474079)
  const orderNumber = orderData.parentOrderSn || orderData.parent_order_sn || orderData.orderSn || orderData.order_sn || orderData.orderId || orderData.order_id || orderData.orderNum || `PO-${Date.now()}`;

  return {
    user: userId,
    orderNum: orderNumber,
    temuOrderId: orderData.orderId || orderData.order_id || orderData.orderSn || orderData.order_sn || orderNumber,
    name: addr.recipientName || addr.recipient_name || addr.name || orderData.buyerName || orderData.buyer_name || 'Temu Customer',
    country: rawCountry,
    streetName: addr.streetName || addr.street_name || addr.address1 || addr.street || addr.detailAddress || '',
    houseNumber: addr.houseNumber || addr.house_number || addr.address2 || '',
    postcode: addr.zipCode || addr.zipcode || addr.zip_code || addr.postcode || addr.zip || '',
    cityName: addr.city || addr.cityName || addr.city_name || '',
    address: addr.fullAddress || addr.full_address || addr.detailAddress || addr.detail_address ||
      [addr.streetName || addr.street_name, addr.city, addr.zipCode || addr.zipcode, rawCountry].filter(Boolean).join(', ') || '',
    email: addr.email || orderData.buyerEmail || orderData.buyer_email || '',
    phone: addr.phone || addr.mobile || addr.phoneNumber || addr.phone_number || orderData.buyerPhone || orderData.buyer_phone || '',
    articleName: goods.goodsName || goods.goods_name || goods.productName || goods.product_name || goods.goodsTitle || goods.goods_title || orderData.goodsName || 'Temu Article',
    sku: (goods.skuId || goods.sku_id || goods.goodsId || goods.goods_id || goods.sku || '').toString(),
    quantity: goods.goodsNumber || goods.goods_number || goods.goodsNum || goods.goods_num || goods.quantity || 1,
    variation: goods.skuSpec || goods.sku_spec || goods.variation || goods.spec || 'Standard',
    packaging: orderData.packaging || 'Small Parcel (25x18x10cm)',
    productImage: goods.goodsImg || goods.goods_img || goods.thumbUrl || goods.thumb_url || goods.imageUrl || goods.image_url || '',
    price: goods.goodsPrice || goods.goods_price || orderData.paymentAmount || orderData.payment_amount || orderData.orderAmount || orderData.order_amount || 0,
    weight: orderData.weight || orderData.packageWeight || '0.50 kg',
    shippingMethod: orderData.shippingMethod || orderData.shipping_method || orderData.logisticsName || orderData.logistics_name || 'DHL Paket International',
    orderDate: orderData.createTime || orderData.create_time || orderData.confirmTime || orderData.confirm_time
      ? new Date(Number(orderData.createTime || orderData.create_time || orderData.confirmTime || orderData.confirm_time) * 1000).toLocaleDateString('de-DE')
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
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000).toString();

    // --- 1. Fetch all unshipped orders across all regions (Numeric '1' and String 'UNSHIPPED') ---
    const unshipped1 = await callTemuRouterAllRegions(appKey, appSecret, accessToken, 'bg.order.list.v2.get', {
      order_status: '1',
      start_confirm_at: thirtyDaysAgo,
      page_size: '100',
      page_no: '1'
    });

    const unshipped2 = await callTemuRouterAllRegions(appKey, appSecret, accessToken, 'bg.order.list.v2.get', {
      order_status: 'UNSHIPPED',
      start_confirm_at: thirtyDaysAgo,
      page_size: '100',
      page_no: '1'
    });

    // Deduplicate fetched unshipped orders
    const combinedMap = new Map();
    [...unshipped1, ...unshipped2].forEach(o => {
      // Each pageItem may be wrapped in parentOrderMap
      const inner = o.parentOrderMap || o;
      const sn = inner.parentOrderSn || inner.parent_order_sn || inner.orderSn || inner.order_sn || inner.orderId || inner.order_id;
      if (sn) combinedMap.set(sn, o);
    });
    const unshippedOrders = Array.from(combinedMap.values());

    // --- 2. Fetch shipped orders to detect externally shipped ones ---
    const shippedList = await callTemuRouterAllRegions(appKey, appSecret, accessToken, 'bg.order.list.v2.get', {
      order_status: '2', // 2 = Shipped / Fulfilled in Temu API
      page_size: '100',
      page_no: '1'
    });
    const shippedOrderNums = shippedList.map(o => {
      const inner = o.parentOrderMap || o;
      return inner.parentOrderSn || inner.parent_order_sn || inner.orderSn || inner.order_sn;
    }).filter(Boolean);

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
    for (const rawItem of unshippedOrders) {
      const inner = rawItem.parentOrderMap || rawItem;
      const orderNum = inner.parentOrderSn || inner.parent_order_sn || inner.orderSn || inner.order_sn;
      if (!orderNum) continue;

      const exists = await TemuOrder.findOne({ user: user._id, orderNum });
      if (!exists) {
        const mapped = mapTemuOrderToModel(rawItem, user._id);
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

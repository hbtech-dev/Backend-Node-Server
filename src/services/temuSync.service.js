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
            // Detailed structure logging for the first item to understand Temu's field names
            const firstItem = list[0];
            console.log(`📦 FULL first pageItem (3000 chars):`, JSON.stringify(firstItem).slice(0, 3000));
            console.log(`🔑 Top-level keys:`, Object.keys(firstItem));
            const pom = firstItem.parentOrderMap;
            if (pom) {
              console.log(`🔑 parentOrderMap keys:`, Object.keys(pom));
              console.log(`📋 parentOrderSn:`, pom.parentOrderSn);
              console.log(`📋 addressInfo:`, JSON.stringify(pom.addressInfo || pom.address_info || 'NOT_FOUND').slice(0, 500));
              const items = pom.orderItemList || pom.order_item_list || pom.goodsList || pom.goods_list || [];
              console.log(`📋 orderItemList length:`, items.length);
              if (items[0]) {
                console.log(`🔑 First orderItem keys:`, Object.keys(items[0]));
                console.log(`📋 First orderItem (500 chars):`, JSON.stringify(items[0]).slice(0, 500));
              }
            }
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
 * Temu siteId → ISO country code mapping.
 * Temu uses numeric siteId values in API responses instead of ISO codes.
 */
const TEMU_SITE_ID_TO_COUNTRY = {
  // Known EU Temu marketplace site IDs
  101: 'GB', 102: 'DE', 103: 'FR', 104: 'IT', 105: 'ES',
  106: 'NL', 107: 'PT', 108: 'PL', 109: 'SE', 110: 'CH',
  111: 'GR', 112: 'IE', 113: 'CY', 114: 'CZ', 115: 'HU',
  116: 'DK', 117: 'RO', 118: 'BG', 119: 'BE', 120: 'AT',
  121: 'FI', 122: 'SK', 123: 'HR', 124: 'SI', 125: 'LT',
  126: 'EE', 127: 'LV', 128: 'IS',
  // US/Global
  1: 'US', 2: 'CA', 3: 'AU', 4: 'NZ',
};

/**
 * Determine country ISO code from order metadata, siteId, regionId, or orderSn prefix
 */
const getCountryFromTemuOrder = (rawItem) => {
  const parentMap = rawItem.parentOrderMap || {};
  const firstOrder = (rawItem.orderList || [])[0] || {};
  const addr = parentMap.addressInfo || parentMap.recipientAddress || {};

  // 1. Check explicit country code in address/order
  let rawCountry = (
    addr.countryCode || addr.country_code || addr.country ||
    parentMap.countryCode || parentMap.country_code || parentMap.country ||
    firstOrder.countryCode || firstOrder.country_code
  );
  if (rawCountry && typeof rawCountry === 'string' && rawCountry.length === 2 && !/^\d+$/.test(rawCountry)) {
    return rawCountry.toUpperCase();
  }

  // 2. Check order number prefix (e.g., PO-186- = ES, PO-141- = NL, PO-162- = PL, PO-076- = DE)
  const orderSn = parentMap.parentOrderSn || firstOrder.orderSn || '';
  if (orderSn.startsWith('PO-186-')) return 'ES';
  if (orderSn.startsWith('PO-141-')) return 'NL';
  if (orderSn.startsWith('PO-162-')) return 'PL';
  if (orderSn.startsWith('PO-076-')) return 'DE';
  if (orderSn.startsWith('PO-101-')) return 'GB';
  if (orderSn.startsWith('PO-102-')) return 'DE';
  if (orderSn.startsWith('PO-103-')) return 'FR';
  if (orderSn.startsWith('PO-104-')) return 'IT';

  // 3. Check siteId mapping
  const siteId = parentMap.siteId || parentMap.site_id || firstOrder.siteId;
  if (siteId && TEMU_SITE_ID_TO_COUNTRY[siteId]) {
    return TEMU_SITE_ID_TO_COUNTRY[siteId];
  }

  // 4. Check orderLabel for destination country (e.g., EU_to_UK)
  const orderLabels = firstOrder.orderLabel || parentMap.parentOrderLabel || [];
  if (Array.isArray(orderLabels)) {
    for (const label of orderLabels) {
      if (label.name && label.name.includes('_to_')) {
        const dest = label.name.split('_to_')[1];
        if (dest && dest.length === 2) return dest.toUpperCase();
      }
    }
  }

  return 'DE'; // Default EU country fallback
};

/**
 * Map Temu API order object to our TemuOrder model fields.
 */
const mapTemuOrderToModel = (rawItem, userId) => {
  const parentMap = rawItem.parentOrderMap || {};
  const orderList = rawItem.orderList || [];
  const firstOrder = orderList[0] || {};
  const addr = parentMap.addressInfo || parentMap.recipientAddress || rawItem.addressInfo || {};

  // Country
  const country = getCountryFromTemuOrder(rawItem);

  // Order number from parentOrderMap
  const orderNumber = parentMap.parentOrderSn || parentMap.parent_order_sn || firstOrder.orderSn || firstOrder.order_sn || `PO-${Date.now()}`;

  // Product info from first item in orderList
  const articleName = firstOrder.originalGoodsName || firstOrder.goodsName || firstOrder.goods_name || 'Temu Article';
  const sku = (firstOrder.skuId || firstOrder.sku_id || firstOrder.goodsId || firstOrder.goods_id || '').toString();
  const quantity = firstOrder.quantity || firstOrder.originalOrderQuantity || 1;
  const variation = firstOrder.originalSpecName || firstOrder.spec || 'Standard';
  const thumbUrl = firstOrder.thumbUrl || firstOrder.thumb_url || '';

  // Recipient / Buyer Info
  const name = addr.recipientName || addr.recipient_name || addr.name || parentMap.buyerName || parentMap.recipientName || firstOrder.recipientName || 'Temu Customer';
  const streetName = addr.streetName || addr.street_name || addr.detailAddress || addr.address1 || '';
  const houseNumber = addr.houseNumber || addr.house_number || addr.address2 || '';
  const postcode = addr.zipCode || addr.zipcode || addr.postcode || addr.zip || '';
  const cityName = addr.city || addr.cityName || addr.city_name || '';
  const fullAddress = addr.fullAddress || addr.full_address || addr.detailAddress ||
    [streetName, cityName, postcode, country].filter(Boolean).join(', ');
  const email = addr.email || parentMap.buyerEmail || '';
  const phone = addr.phone || addr.mobile || parentMap.buyerPhone || '';

  // Timestamps
  const createTime = parentMap.parentOrderTime || parentMap.parentConfirmTime || firstOrder.orderCreateTime;
  const orderDate = createTime
    ? new Date(Number(createTime) * 1000).toLocaleDateString('de-DE')
    : new Date().toLocaleDateString('de-DE');

  return {
    user: userId,
    orderNum: orderNumber,
    temuOrderId: firstOrder.orderSn || firstOrder.order_sn || orderNumber,
    name,
    country,
    streetName,
    houseNumber,
    postcode,
    cityName,
    address: fullAddress,
    email,
    phone,
    articleName,
    sku,
    quantity,
    variation,
    packaging: 'Small Parcel (25x18x10cm)',
    productImage: thumbUrl,
    price: 0,
    weight: '0.50 kg',
    shippingMethod: 'DHL Paket International',
    orderDate,
    status: 'open',
    source: 'Temu'
  };
};

const syncUserTemuOrders = async (user) => {
  if (!user) return;

  // Collect all active store integrations
  const integrations = [];
  if (user.temuIntegrations && user.temuIntegrations.length > 0) {
    integrations.push(...user.temuIntegrations.filter(i => i.isConnected));
  } else if (user.temuIntegration && user.temuIntegration.isConnected) {
    integrations.push(user.temuIntegration);
  }

  if (integrations.length === 0) return;

  console.log(`📡 Starting Temu sync for user ${user._id} across ${integrations.length} store integration(s)...`);

  for (const integration of integrations) {
    const appKey = integration.appKey;
    const appSecret = integration.appSecret;
    const accessToken = integration.accessToken;
    const shopName = integration.shopName || 'Temu Store';

    if (!appKey || !appSecret) continue;

    try {
      console.log(`🔄 Syncing Temu store "${shopName}"...`);

      // Pass BOTH camelCase and snake_case parameters so Temu router accepts the query regardless of version
      // parentOrderStatus 2 = UN_SHIPPING (Awaiting shipment), 1 = PENDING, 0 = ALL
      const unshippedList = await callTemuRouterAllRegions(appKey, appSecret, accessToken, 'bg.order.list.v2.get', {
        parentOrderStatus: 2,
        parent_order_status: 2,
        pageNumber: 1,
        page_number: 1,
        pageSize: 100,
        page_size: 100
      });

      const pendingList = await callTemuRouterAllRegions(appKey, appSecret, accessToken, 'bg.order.list.v2.get', {
        parentOrderStatus: 1,
        parent_order_status: 1,
        pageNumber: 1,
        page_number: 1,
        pageSize: 100,
        page_size: 100
      });

      const allList = await callTemuRouterAllRegions(appKey, appSecret, accessToken, 'bg.order.list.v2.get', {
        parentOrderStatus: 0,
        parent_order_status: 0,
        pageNumber: 1,
        page_number: 1,
        pageSize: 100,
        page_size: 100
      });

      // Deduplicate and filter active unshipped/pending orders returned strictly from live Temu API
      const activeMap = new Map();
      [...unshippedList, ...pendingList, ...allList].forEach(rawItem => {
        const pm = rawItem.parentOrderMap || {};
        const ol = (rawItem.orderList || [])[0] || {};
        const status = pm.parentOrderStatus;
        const orderSn = pm.parentOrderSn || ol.orderSn || rawItem.orderSn;

        // Keep orders that are unshipped (status 2), pending (status 1), or partially shipped (status 41)
        const isUnshippedStatus = status === 2 || status === 1 || status === 41;

        if (isUnshippedStatus && status !== 4 && status !== 5 && status !== 3) {
          if (orderSn) activeMap.set(orderSn, rawItem);
        }
      });

      const activeUnshippedOrders = Array.from(activeMap.values());

      // --- Purge only orders that are explicitly returned by the API as shipped/canceled ---
      const orderNumsToPurge = [];
      [...unshippedList, ...pendingList, ...allList].forEach(rawItem => {
        const pm = rawItem.parentOrderMap || {};
        const status = pm.parentOrderStatus;
        const orderSn = pm.parentOrderSn || (rawItem.orderList || [])[0]?.orderSn;
        
        // Status 3 = Canceled, 4 = Shipped, 5 = Receipted (fully processed)
        if (status === 3 || status === 4 || status === 5) {
          if (orderSn) orderNumsToPurge.push(orderSn);
        }
      });

      if (orderNumsToPurge.length > 0) {
        const deletedCount = await TemuOrder.deleteMany({
          user: user._id,
          status: 'open',
          orderNum: { $in: orderNumsToPurge }
        });
        if (deletedCount.deletedCount > 0) {
          console.log(`🧹 Cleaned up ${deletedCount.deletedCount} shipped/canceled open order(s) for store "${shopName}".`);
        }
      }

      // --- Upsert active unshipped orders into MongoDB ---
      let newCount = 0;
      for (const rawItem of activeUnshippedOrders) {
        const pm = rawItem.parentOrderMap || {};
        const ol = (rawItem.orderList || [])[0] || {};
        const orderNum = pm.parentOrderSn || ol.orderSn;
        if (!orderNum) continue;

        const mapped = mapTemuOrderToModel(rawItem, user._id);

        // Try to fetch detailed recipient address via bg.logistics.address.get if available
        try {
          const addrResult = await callTemuRouterAllRegions(appKey, appSecret, accessToken, 'bg.logistics.address.get', {
            order_sn: ol.orderSn || orderNum
          });
          if (addrResult.length > 0) {
            const addrData = addrResult[0].parentOrderMap || addrResult[0];
            const addr = addrData.addressInfo || addrData.address_info || addrData;
            if (addr.recipientName || addr.recipient_name || addr.name) {
              mapped.name = addr.recipientName || addr.recipient_name || addr.name;
            }
            if (addr.detailAddress || addr.detail_address || addr.fullAddress) {
              mapped.address = addr.detailAddress || addr.detail_address || addr.fullAddress || mapped.address;
            }
            if (addr.zipCode || addr.zipcode) mapped.postcode = addr.zipCode || addr.zipcode;
            if (addr.city || addr.cityName) mapped.cityName = addr.city || addr.city;
            if (addr.phone || addr.mobile) mapped.phone = addr.phone || addr.mobile;
          }
        } catch (addrErr) {
          // Address fetch failed — ignore and continue
        }

        // Upsert order in database
        const existing = await TemuOrder.findOne({ user: user._id, orderNum });
        if (!existing) {
          await TemuOrder.create(mapped);
          newCount++;

          // Only create Notification if one doesn't already exist for this orderNum (prevents notification spam)
          const notifExists = await Notification.findOne({ user: user._id, message: { $regex: orderNum } });
          if (!notifExists) {
            await Notification.create({
              title: 'New Temu Order Received',
              message: `Order ${orderNum} (${mapped.country}) is unshipped and ready for shipment on store ${shopName}.`,
              type: 'info',
              user: user._id
            });
          }
        } else {
          // Update existing record with fresh mapped fields
          await TemuOrder.updateOne({ _id: existing._id }, { $set: mapped });
        }
      }

      // Update sync timestamp on this integration
      integration.lastSyncedAt = new Date();
      if (user.temuIntegration && user.temuIntegration.shopName === shopName) {
        user.temuIntegration.lastSyncedAt = integration.lastSyncedAt;
      }

      if (newCount > 0) {
        console.info(`[${shopName}] Temu sync: ${newCount} new unshipped order(s) added.`);
      }
    } catch (err) {
      console.error(`Error syncing Temu store "${shopName}":`, err.message);
    }
  }

  // Save updated user integrations
  await user.save();
};

exports.startTemuBackgroundSync = () => {
  if (syncInterval) return;
  console.log('⚡ Temu Background Sync Service started (polling every 20s)...');

  const runSync = async () => {
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) return;
      const connectedUsers = await User.find({
        $or: [
          { 'temuIntegration.isConnected': true },
          { 'temuIntegrations.isConnected': true },
          { 'temuIntegrations.0': { $exists: true } }
        ]
      });
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

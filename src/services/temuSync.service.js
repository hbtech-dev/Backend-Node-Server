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
 * Map Temu API order object to our TemuOrder model fields.
 * 
 * REAL Temu bg.order.list.v2.get structure (from live API logs):
 * {
 *   parentOrderMap: {
 *     parentOrderSn: "PO-076-...",
 *     parentOrderStatus: 1,  // 1=unshipped, 4=shipped
 *     regionId: 76,
 *     siteId: 105,
 *     parentOrderTime: 1784656483,  // unix timestamp
 *     parentConfirmTime: 1784656574,
 *   },
 *   orderList: [
 *     {
 *       orderSn: "076-...",
 *       originalGoodsName: "Apple Cider Vinegar Gummies...",
 *       goodsName: "Жевательные конфеты...",  // translated
 *       skuId: 60685740456090,
 *       goodsId: 604336172154090,
 *       quantity: 1,
 *       originalSpecName: "Packung 1",
 *       thumbUrl: "https://img-eu.kwcdn.com/...",
 *       orderCreateTime: 1784656483,
 *       productList: [{ productSkuId, extCode, productId }]
 *     }
 *   ]
 * }
 * 
 * NOTE: Address/buyer info is NOT returned by bg.order.list.v2.get.
 *       Use bg.logistics.address.get for address data.
 */
const mapTemuOrderToModel = (rawItem, userId) => {
  const parentMap = rawItem.parentOrderMap || {};
  const orderList = rawItem.orderList || [];
  const firstOrder = orderList[0] || {};

  // Country: map siteId to ISO country code
  const siteId = parentMap.siteId || parentMap.site_id;
  const country = TEMU_SITE_ID_TO_COUNTRY[siteId] || 'EU';

  // Order number from parentOrderMap
  const orderNumber = parentMap.parentOrderSn || parentMap.parent_order_sn || firstOrder.orderSn || firstOrder.order_sn || `PO-${Date.now()}`;

  // Product info from first item in orderList
  const articleName = firstOrder.originalGoodsName || firstOrder.goodsName || firstOrder.goods_name || 'Temu Article';
  const sku = (firstOrder.skuId || firstOrder.sku_id || firstOrder.goodsId || firstOrder.goods_id || '').toString();
  const quantity = firstOrder.quantity || firstOrder.originalOrderQuantity || 1;
  const variation = firstOrder.originalSpecName || firstOrder.spec || 'Standard';
  const thumbUrl = firstOrder.thumbUrl || firstOrder.thumb_url || '';
  const goodsId = (firstOrder.goodsId || firstOrder.goods_id || '').toString();

  // Timestamps
  const createTime = parentMap.parentOrderTime || parentMap.parentConfirmTime || firstOrder.orderCreateTime;
  const orderDate = createTime
    ? new Date(createTime * 1000).toLocaleDateString('de-DE')
    : new Date().toLocaleDateString('de-DE');

  return {
    user: userId,
    orderNum: orderNumber,
    temuOrderId: firstOrder.orderSn || firstOrder.order_sn || orderNumber,
    name: 'Temu Buyer',  // Address API needed for real buyer name
    country,
    streetName: '',       // Not available from bg.order.list.v2.get
    houseNumber: '',
    postcode: '',
    cityName: '',
    address: '',
    email: '',
    phone: '',
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
  if (!user || !user.temuIntegration || !user.temuIntegration.isConnected) return;

  const appKey = user.temuIntegration.appKey;
  const appSecret = user.temuIntegration.appSecret;
  const accessToken = user.temuIntegration.accessToken;

  if (!appKey || !appSecret) {
    return;
  }

  try {
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000).toString();

    // --- 1. Fetch orders from Temu API ---
    // Note: Temu API may ignore order_status filter and return ALL orders.
    // We filter client-side by parentOrderStatus to get only unshipped ones.
    const allOrders = await callTemuRouterAllRegions(appKey, appSecret, accessToken, 'bg.order.list.v2.get', {
      order_status: '1',
      start_confirm_at: thirtyDaysAgo,
      page_size: '100',
      page_no: '1'
    });

    // --- 2. Client-side filter: only keep UNSHIPPED orders (parentOrderStatus === 1) ---
    // Temu parentOrderStatus values: 1=unshipped, 2=partially shipped, 3=awaiting collection, 4=shipped
    const unshippedOrders = [];
    const shippedOrderNums = [];
    
    for (const rawItem of allOrders) {
      const parentMap = rawItem.parentOrderMap || {};
      const status = parentMap.parentOrderStatus;
      const orderSn = parentMap.parentOrderSn || '';
      
      if (status === 1 || status === 0) {
        // Unshipped — keep it
        unshippedOrders.push(rawItem);
      } else if (status === 4 || status === 3) {
        // Shipped — track for removal from our DB
        if (orderSn) shippedOrderNums.push(orderSn);
      }
    }

    console.log(`📊 Temu sync: ${allOrders.length} total from API → ${unshippedOrders.length} unshipped, ${shippedOrderNums.length} shipped`);
    
    // Log siteId values for first few unshipped orders to help refine country mapping
    unshippedOrders.slice(0, 5).forEach((item, i) => {
      const pm = item.parentOrderMap || {};
      const ol = (item.orderList || [])[0] || {};
      console.log(`📍 Unshipped order #${i+1}: sn=${pm.parentOrderSn}, siteId=${pm.siteId}, regionId=${pm.regionId}, goods="${(ol.originalGoodsName || ol.goodsName || '').slice(0, 60)}"`);
    });

    // --- 3. Delete from open queue what Temu already shipped ---
    if (shippedOrderNums.length > 0) {
      const deleted = await TemuOrder.deleteMany({
        user: user._id,
        orderNum: { $in: shippedOrderNums },
        status: 'open'
      });
      if (deleted.deletedCount > 0) {
        console.log(`🚛 Removed ${deleted.deletedCount} shipped order(s) from open queue.`);
      }
    }

    // --- 4. Upsert new unshipped orders + fetch address ---
    let newCount = 0;
    for (const rawItem of unshippedOrders) {
      const parentMap = rawItem.parentOrderMap || {};
      const orderNum = parentMap.parentOrderSn || '';
      if (!orderNum) continue;

      const exists = await TemuOrder.findOne({ user: user._id, orderNum });
      if (!exists) {
        const mapped = mapTemuOrderToModel(rawItem, user._id);
        
        // Try to fetch buyer address via bg.logistics.address.get
        try {
          const addrResult = await callTemuRouterAllRegions(appKey, appSecret, accessToken, 'bg.logistics.address.get', {
            order_sn: (rawItem.orderList || [])[0]?.orderSn || orderNum
          });
          if (addrResult.length > 0) {
            const addrData = addrResult[0].parentOrderMap || addrResult[0];
            const addr = addrData.addressInfo || addrData.address_info || addrData;
            if (addr.recipientName || addr.recipient_name || addr.name) {
              mapped.name = addr.recipientName || addr.recipient_name || addr.name;
            }
            if (addr.detailAddress || addr.detail_address || addr.fullAddress) {
              mapped.address = addr.detailAddress || addr.detail_address || addr.fullAddress || '';
            }
            if (addr.zipCode || addr.zipcode) mapped.postcode = addr.zipCode || addr.zipcode;
            if (addr.city || addr.cityName) mapped.cityName = addr.city || addr.cityName;
            if (addr.phone || addr.mobile) mapped.phone = addr.phone || addr.mobile;
          }
        } catch (addrErr) {
          // Address fetch failed — not critical, order still gets saved
          console.warn(`Address fetch failed for ${orderNum}:`, addrErr.message);
        }

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

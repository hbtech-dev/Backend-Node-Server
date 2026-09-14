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
 * Call Temu Router for APIs that return a SINGLE object (not a list/array).
 * Used for bg.logistics.address.get and similar single-record endpoints.
 * Returns the raw result object, or null on failure.
 */
const callTemuRouterRaw = async (appKey, appSecret, accessToken, type, params = {}) => {
  const url = 'https://openapi-b-eu.temu.com/openapi/router';
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

  try {
    const res = await httpFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, sign }),
      timeout: 10000
    });
    if (!res.ok) return null;
    const data = await res.json();
    console.log(`🔍 [${type}] Response for ${params.parentOrderSn || params.parent_order_sn || 'query'}:`, JSON.stringify(data).slice(0, 500));
    const isOk = data.success === true || data.errorCode === 1000000 || data.errorCode === 0 || Boolean(data.result);
    if (!isOk) return null;
    return data.result || data.response || data.data || null;
  } catch (e) {
    console.warn(`⚠️ [${type}] Fetch exception:`, e.message);
    return null;
  }
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

const COUNTRY_NAME_TO_ISO = {
  'ITALY': 'IT', 'ITALIA': 'IT',
  'PORTUGAL': 'PT',
  'FRANCE': 'FR', 'FRANKREICH': 'FR',
  'GERMANY': 'DE', 'DEUTSCHLAND': 'DE',
  'SPAIN': 'ES', 'ESPAÑA': 'ES', 'SPANIEN': 'ES',
  'UNITED KINGDOM': 'GB', 'GREAT BRITAIN': 'GB', 'UK': 'GB',
  'NETHERLANDS': 'NL', 'NEDERLAND': 'NL', 'HOLLAND': 'NL',
  'AUSTRIA': 'AT', 'ÖSTERREICH': 'AT',
  'POLAND': 'PL', 'POLSKA': 'PL',
  'BELGIUM': 'BE', 'BELGIË': 'BE', 'BELGIQUE': 'BE',
  'SWEDEN': 'SE', 'SVERIGE': 'SE',
  'GREECE': 'GR', 'HELLAS': 'GR',
  'CZECH REPUBLIC': 'CZ', 'CZECHIA': 'CZ',
  'ROMANIA': 'RO',
  'HUNGARY': 'HU', 'MAGYARORSZÁG': 'HU',
  'DENMARK': 'DK', 'DANMARK': 'DK',
  'FINLAND': 'FI', 'SUOMI': 'FI',
  'SLOVAKIA': 'SK',
  'CROATIA': 'HR', 'HRVATSKA': 'HR',
  'SLOVENIA': 'SI',
  'LITHUANIA': 'LT',
  'LATVIA': 'LV',
  'ESTONIA': 'EE',
  'IRELAND': 'IE',
  'BULGARIA': 'BG',
  'SWITZERLAND': 'CH', 'SCHWEIZ': 'CH', 'SUISSE': 'CH',
  'UNITED STATES': 'US', 'USA': 'US',
  'CANADA': 'CA',
  'AUSTRALIA': 'AU'
};

const resolveCountryIso = (val) => {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim().toUpperCase();
  if (trimmed.length === 2 && !/^\d+$/.test(trimmed)) return trimmed;
  if (COUNTRY_NAME_TO_ISO[trimmed]) return COUNTRY_NAME_TO_ISO[trimmed];
  return null;
};

/**
 * Determine country ISO code from order metadata, siteId, regionId, or orderSn prefix
 */
const getCountryFromTemuOrder = (rawItem, addrMapItem = null) => {
  const parentMap = rawItem.parentOrderMap || {};
  const firstOrder = (rawItem.orderList || [])[0] || {};
  const addr = addrMapItem || parentMap.addressInfo || parentMap.recipientAddress || {};

  // 1. Check explicit regionName1 / country in logistics address or parentMap FIRST
  const rawCountry = addr.regionName1 || addr.countryName || addr.countryCode || addr.country_code || addr.country ||
    parentMap.regionName1 || parentMap.countryCode || parentMap.country_code || parentMap.country ||
    firstOrder.countryCode || firstOrder.country_code;
  
  const isoFromCountry = resolveCountryIso(rawCountry);
  if (isoFromCountry) return isoFromCountry;

  // 2. Check siteId mapping
  const siteId = parentMap.siteId || parentMap.site_id || firstOrder.siteId;
  if (siteId && TEMU_SITE_ID_TO_COUNTRY[siteId]) {
    return TEMU_SITE_ID_TO_COUNTRY[siteId];
  }

  // 3. Check order number prefix
  const orderSn = parentMap.parentOrderSn || parentMap.parent_order_sn || firstOrder.orderSn || firstOrder.order_sn || '';
  if (orderSn.startsWith('PO-098-') || orderSn.startsWith('PO-104-')) return 'IT';
  if (orderSn.startsWith('PO-069-') || orderSn.startsWith('PO-103-')) return 'FR';
  if (orderSn.startsWith('PO-076-') || orderSn.startsWith('PO-105-') || orderSn.startsWith('PO-186-')) return 'ES';
  if (orderSn.startsWith('PO-107-')) return 'PT';
  if (orderSn.startsWith('PO-102-')) return 'DE';
  if (orderSn.startsWith('PO-101-')) return 'GB';
  if (orderSn.startsWith('PO-106-') || orderSn.startsWith('PO-141-')) return 'NL';
  if (orderSn.startsWith('PO-108-') || orderSn.startsWith('PO-162-')) return 'PL';
  if (orderSn.startsWith('PO-120-')) return 'AT';
  if (orderSn.startsWith('PO-111-')) return 'GR';

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
 * Calculate dynamic packaging dimensions and weight based on actual order items and quantities.
 */
const calculateTemuPackageInfo = (items = []) => {
  let totalWeightKg = 0;
  let totalQty = 0;

  for (const item of items) {
    const qty = Number(item.quantity || 1);
    totalQty += qty;
    const spec = `${item.variation || ''} ${item.articleName || ''}`.toUpperCase();

    let unitWeight = 0.35; // Default fallback unit weight (kg)

    if (spec.includes('720 SOFT') || spec.includes('720 CAPS') || spec.includes('720 COUNT')) {
      unitWeight = 0.85;
    } else if (spec.includes('360 SOFT') || spec.includes('360 CAPS') || spec.includes('360 COUNT')) {
      unitWeight = 0.45;
    } else if (spec.includes('180 SOFT') || spec.includes('180 CAPS')) {
      unitWeight = 0.30;
    } else if (spec.includes('120') || spec.includes('90')) {
      unitWeight = 0.25;
    } else if (spec.includes('GUMM') || spec.includes('PACK OF 1') || spec.includes('1 PACK') || spec.includes('60')) {
      unitWeight = 0.20;
    }

    totalWeightKg += unitWeight * qty;
  }

  if (totalWeightKg === 0) totalWeightKg = 0.20;

  const formattedWeight = `${totalWeightKg.toFixed(2)} kg`;

  let packaging = 'Small Box (16×12×8cm)';
  if (totalWeightKg > 1.50 || totalQty >= 4) {
    packaging = 'XL Parcel (35×25×15cm)';
  } else if (totalWeightKg > 0.70 || totalQty >= 2) {
    packaging = 'Large Box (28×20×12cm)';
  } else if (totalWeightKg > 0.35) {
    packaging = 'Medium Box (22×16×10cm)';
  }

  return { packaging, weight: formattedWeight };
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

  // Build items array from orderList
  const items = (orderList.length > 0 ? orderList : [firstOrder]).map(item => {
    const itemTitle = item.originalGoodsName || item.goodsName || item.goods_name || 'Temu Article';
    const itemSku = (item.skuId || item.sku_id || item.goodsId || item.goods_id || '').toString();
    const itemQty = Number(item.quantity || item.originalOrderQuantity || 1);
    const itemVar = (
      item.originalSpecName ||
      item.original_spec_name ||
      item.specName ||
      item.spec_name ||
      item.spec ||
      item.goodsSpec ||
      item.goods_spec ||
      'Standard'
    );
    const itemImg = item.thumbUrl || item.thumb_url || item.imageUrl || item.image_url || item.goodsImg || item.goods_img || item.goodsThumbUrl || item.goods_thumb_url || '';
    let itemPrice = Number(item.goodsPrice || item.goods_price || 0);
    if (itemPrice > 500) itemPrice = itemPrice / 100;
    return {
      sku: itemSku,
      articleName: itemTitle,
      quantity: itemQty,
      variation: itemVar,
      price: itemPrice,
      productImage: itemImg
    };
  });

  const primaryItem = items[0] || {
    articleName: 'Temu Article',
    sku: '',
    quantity: 1,
    variation: 'Standard',
    productImage: '',
    price: 19.99
  };

  const articleName = primaryItem.articleName;
  const sku = primaryItem.sku;
  const quantity = items.reduce((sum, i) => sum + i.quantity, 0);
  const variation = items.map(i => i.variation).filter(Boolean).join(', ') || primaryItem.variation;
  const thumbUrl = primaryItem.productImage;

  // Recipient / Buyer Info
  const email = addr.mail || addr.email || parentMap.buyerEmail || '';
  const phone = addr.mobile || addr.phone || parentMap.buyerPhone || '';

  const rawBuyerName = addr.recipientName || addr.recipient_name || addr.receiptName || addr.receipt_name || addr.name || addr.consigneeName || addr.consignee || parentMap.buyerName || parentMap.recipientName || firstOrder.recipientName;
  const recipientName = (rawBuyerName && rawBuyerName !== 'NOT_FOUND') ? rawBuyerName : 'Temu Customer';

  let rawBuyerHandle = (
    parentMap.buyerName ||
    parentMap.buyer_name ||
    parentMap.buyerNickName ||
    parentMap.buyer_nickname ||
    parentMap.buyerAccount ||
    parentMap.buyer_account ||
    parentMap.userName ||
    parentMap.user_name ||
    firstOrder.buyerName ||
    firstOrder.buyer_name ||
    firstOrder.buyerNickName ||
    firstOrder.buyer_nickname ||
    rawItem.buyerName
  );

  if (!rawBuyerHandle || rawBuyerHandle === recipientName) {
    if (email && email.includes('@')) {
      const prefix = email.split('@')[0];
      if (prefix && prefix.length > 4) {
        rawBuyerHandle = `${prefix.slice(0, 3)}***${prefix.slice(-2)}`;
      }
    }
  }

  const buyerName = rawBuyerHandle || 'Temu Buyer';
  const streetName = addr.addressLineAll || addr.addressLine1 || addr.streetName || addr.street_name || addr.detailAddress || addr.address1 || '';
  const houseNumber = addr.houseNumber || addr.house_number || addr.address2 || '';
  const postcode = addr.postCode || addr.postcode || addr.zipCode || addr.zipcode || addr.zip || '';
  const cityName = addr.regionName3 || addr.city || addr.cityName || addr.city_name || parentMap.regionName3 || '';
  const fullAddress = addr.fullAddress || addr.full_address || addr.detailAddress ||
    [streetName, cityName, postcode, country].filter(Boolean).join(', ') || (cityName ? `${cityName}, ${country}` : '');

  // Timestamps
  const createTime = parentMap.parentOrderTime || parentMap.parentConfirmTime || firstOrder.orderCreateTime;
  const orderDate = createTime
    ? new Date(Number(createTime) * 1000).toLocaleDateString('de-DE')
    : new Date().toLocaleDateString('de-DE');

  // Parse actual order price from Temu API
  let rawPrice = parentMap.orderAmount || parentMap.order_amount || parentMap.payAmount || parentMap.pay_amount || parentMap.totalAmount || firstOrder.goodsPrice || firstOrder.goods_price || 0;
  let parsedPrice = Number(rawPrice) || 0;
  if (parsedPrice > 500) {
    parsedPrice = parsedPrice / 100;
  }
  if (parsedPrice <= 0) {
    parsedPrice = primaryItem.price || 19.99;
  }

  const pkgInfo = calculateTemuPackageInfo(items);

  return {
    user: userId,
    orderNum: orderNumber,
    temuOrderId: firstOrder.orderSn || firstOrder.order_sn || orderNumber,
    name: recipientName,
    recipientName,
    buyerName,
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
    items,
    packaging: pkgInfo.packaging,
    productImage: thumbUrl,
    price: parsedPrice,
    weight: pkgInfo.weight,
    shippingMethod: 'DHL Paket International',
    orderDate,
    status: 'open',
    source: 'Temu'
  };
};

/**
 * Fetch address data from Temu for a list of parent order SNs via shippinginfo / decrypt / detail endpoints
 * Returns a Map of orderSn -> address object
 */
const fetchTemuLogisticsAddresses = async (appKey, appSecret, accessToken, orderSnList = []) => {
  const addrMap = new Map();
  if (!orderSnList || orderSnList.length === 0) return addrMap;

  for (const parentOrderSn of orderSnList) {
    try {
      // 1. Try bg.order.shippinginfo.v2.get
      let detail = await callTemuRouterRaw(appKey, appSecret, accessToken, 'bg.order.shippinginfo.v2.get', {
        parentOrderSn,
        parent_order_sn: parentOrderSn
      });

      // 2. Try bg.order.decryptshippinginfo.get
      if (!detail) {
        detail = await callTemuRouterRaw(appKey, appSecret, accessToken, 'bg.order.decryptshippinginfo.get', {
          parentOrderSn,
          parent_order_sn: parentOrderSn
        });
      }

      // 3. Fallback to bg.order.detail.v2.get
      if (!detail) {
        detail = await callTemuRouterRaw(appKey, appSecret, accessToken, 'bg.order.detail.v2.get', {
          parentOrderSn,
          parent_order_sn: parentOrderSn
        });
      }

      if (detail) {
        const pm = detail.parentOrderMap || {};
        const ol = (detail.orderList || [])[0] || {};

        const isDirectAddressObject = Boolean(
          detail.receiptName || detail.addressLineAll || detail.addressLine1 ||
          detail.regionName1 || detail.mobile || detail.mail || detail.addressExtra
        );

        const addr = isDirectAddressObject ? detail : (
          detail.receiptAddressInfo || detail.shippingInfo || detail.addressInfo || detail.recipientAddress ||
          detail.address_info || detail.receipt_address_info || detail.receiveAddressInfo ||
          pm.receiptAddressInfo || pm.addressInfo || pm.recipientAddress || pm.receiverAddress ||
          pm.receiptAddress || pm.address_info || pm.receipt_address_info || pm.recipient_address_info ||
          ol.receiptAddressInfo || ol.addressInfo || ol.recipientAddress || ol.address_info ||
          ol.receipt_address_info || ol.consignee || ol.shippingAddress || ol.recipientInfo
        );

        if (addr) {
          console.log(`✅ Found address object for ${parentOrderSn}:`, JSON.stringify(addr).slice(0, 300));
          addrMap.set(parentOrderSn, addr);
        } else {
          console.log(`⚠️ Address object not found in standard paths for ${parentOrderSn}`);
        }
      }
    } catch (e) {
      console.warn(`⚠️ Error calling address endpoints for ${parentOrderSn}:`, e.message);
    }
  }

  return addrMap;
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

      const nowSec = Math.floor(Date.now() / 1000);
      const thirtyDaysAgo = nowSec - (30 * 86400);

      // --- Step 2: Fetch unshipped & pending order lists with 30-day historical time window ---
      // parentOrderStatus 2 = UN_SHIPPING, 1 = PENDING, 0 = ALL
      const unshippedList = await callTemuRouterAllRegions(appKey, appSecret, accessToken, 'bg.order.list.v2.get', {
        parentOrderStatus: 2, parent_order_status: 2,
        updateTimeStart: thirtyDaysAgo, update_time_start: thirtyDaysAgo,
        updateTimeEnd: nowSec, update_time_end: nowSec,
        createTimeStart: thirtyDaysAgo, create_time_start: thirtyDaysAgo,
        createTimeEnd: nowSec, create_time_end: nowSec,
        pageNumber: 1, page_number: 1,
        pageSize: 100, page_size: 100
      });

      const pendingList = await callTemuRouterAllRegions(appKey, appSecret, accessToken, 'bg.order.list.v2.get', {
        parentOrderStatus: 1, parent_order_status: 1,
        updateTimeStart: thirtyDaysAgo, update_time_start: thirtyDaysAgo,
        updateTimeEnd: nowSec, update_time_end: nowSec,
        createTimeStart: thirtyDaysAgo, create_time_start: thirtyDaysAgo,
        createTimeEnd: nowSec, create_time_end: nowSec,
        pageNumber: 1, page_number: 1,
        pageSize: 100, page_size: 100
      });

      const allList = await callTemuRouterAllRegions(appKey, appSecret, accessToken, 'bg.order.list.v2.get', {
        parentOrderStatus: 0, parent_order_status: 0,
        updateTimeStart: thirtyDaysAgo, update_time_start: thirtyDaysAgo,
        updateTimeEnd: nowSec, update_time_end: nowSec,
        createTimeStart: thirtyDaysAgo, create_time_start: thirtyDaysAgo,
        createTimeEnd: nowSec, create_time_end: nowSec,
        pageNumber: 1, page_number: 1,
        pageSize: 100, page_size: 100
      });

      // Deduplicate and filter active unshipped/pending orders
      const activeMap = new Map();
      [...unshippedList, ...pendingList, ...allList].forEach(rawItem => {
        const pm = rawItem.parentOrderMap || {};
        const ol = (rawItem.orderList || [])[0] || {};
        const status = pm.parentOrderStatus;
        const orderSn = pm.parentOrderSn || ol.orderSn || rawItem.orderSn;
        const isUnshippedStatus = status === 2 || status === 1 || status === 41;
        if (isUnshippedStatus && status !== 4 && status !== 5 && status !== 3) {
          if (orderSn) activeMap.set(orderSn, rawItem);
        }
      });

      const activeUnshippedOrders = Array.from(activeMap.values());
      const activeOrderSns = activeUnshippedOrders.map(item => item.parentOrderMap?.parentOrderSn || item.orderList?.[0]?.orderSn).filter(Boolean);

      // --- Fetch logistics address details for active orders via bg.order.detail.v2.get ---
      const logisticsAddrMap = await fetchTemuLogisticsAddresses(appKey, appSecret, accessToken, activeOrderSns);

      // Update shipped/canceled statuses in DB (preserves history)
      const shippedNums = [];
      const canceledNums = [];
      [...unshippedList, ...pendingList, ...allList].forEach(rawItem => {
        const pm = rawItem.parentOrderMap || {};
        const status = pm.parentOrderStatus;
        const orderSn = pm.parentOrderSn || (rawItem.orderList || [])[0]?.orderSn;
        if (status === 4 || status === 5) { if (orderSn) shippedNums.push(orderSn); }
        else if (status === 3) { if (orderSn) canceledNums.push(orderSn); }
      });
      if (shippedNums.length > 0) {
        await TemuOrder.updateMany(
          { user: user._id, status: 'open', orderNum: { $in: shippedNums } },
          { $set: { status: 'printed' } }
        );
      }
      if (canceledNums.length > 0) {
        await TemuOrder.updateMany(
          { user: user._id, status: 'open', orderNum: { $in: canceledNums } },
          { $set: { status: 'canceled' } }
        );
      }

      // --- Step 3: Upsert active unshipped orders with address enrichment ---
      let newCount = 0;
      for (const rawItem of activeUnshippedOrders) {
        const pm = rawItem.parentOrderMap || {};
        const ol = (rawItem.orderList || [])[0] || {};
        const orderNum = pm.parentOrderSn || ol.orderSn;
        if (!orderNum) continue;

        const mapped = mapTemuOrderToModel(rawItem, user._id);

        // --- Enrich with address from logistics API map ---
        const addrData = logisticsAddrMap.get(orderNum) || logisticsAddrMap.get(ol.orderSn);
        if (addrData) {
          const nameExtra = addrData.addressExtra
            ? `${addrData.addressExtra.firstName || ''} ${addrData.addressExtra.lastName || ''}`.trim()
            : '';
          const resolvedName = (
            addrData.receiptName ||
            addrData.receipt_name ||
            (nameExtra && nameExtra !== '' ? nameExtra : null) ||
            addrData.recipientName ||
            addrData.recipient_name ||
            addrData.name ||
            addrData.buyerName ||
            addrData.consigneeName ||
            addrData.consignee
          );

          const resolvedStreet = (
            addrData.addressLineAll ||
            addrData.addressLine1 ||
            addrData.detailAddress ||
            addrData.detail_address ||
            addrData.streetName ||
            addrData.street_name ||
            addrData.address1 ||
            addrData.address
          );

          const resolvedCity = addrData.regionName3 || addrData.city || addrData.cityName || addrData.city_name;
          const resolvedState = addrData.regionName2 || addrData.province || addrData.state;
          const resolvedZip = addrData.postCode || addrData.postcode || addrData.zipCode || addrData.zipcode || addrData.zip_code || addrData.zip || addrData.postalCode;
          const resolvedPhone = addrData.mobile || addrData.phone || addrData.phoneNumber || addrData.phone_number || addrData.backupMobile;
          const resolvedEmail = addrData.mail || addrData.email || addrData.buyerEmail;

          const rawCountryName = addrData.regionName1 || addrData.country || addrData.countryCode;
          const resolvedCountry = resolveCountryIso(rawCountryName) || mapped.country;

          if (resolvedName && resolvedName !== 'NOT_FOUND') {
            mapped.name = resolvedName;
            mapped.recipientName = resolvedName;
            console.log(`✅ Got recipient name for ${orderNum}: ${resolvedName}`);
          }
          const resolvedBuyer = pm.buyerName || pm.buyer_name || pm.buyerNickName || addrData.buyerName || mapped.buyerName;
          if (resolvedBuyer) mapped.buyerName = resolvedBuyer;

          if (resolvedStreet) mapped.streetName = resolvedStreet;
          if (resolvedCity) mapped.cityName = resolvedCity;
          if (resolvedZip) mapped.postcode = resolvedZip;
          if (resolvedPhone) mapped.phone = resolvedPhone;
          if (resolvedEmail) mapped.email = resolvedEmail;
          if (resolvedCountry) mapped.country = resolvedCountry;

          const addressParts = [];
          if (resolvedStreet) addressParts.push(resolvedStreet);
          const cityZipPart = [resolvedZip, resolvedCity].filter(Boolean).join(' ');
          if (cityZipPart) addressParts.push(cityZipPart);
          if (resolvedState && resolvedState !== resolvedCity) addressParts.push(resolvedState);
          if (mapped.country) addressParts.push(mapped.country);
          if (addressParts.length > 0) {
            mapped.address = addressParts.join(', ');
          }
        } else {
          // Fallback: query order detail via bg.order.detail.v2.get for full recipient name & shipping address
          try {
            const orderDetail = await callTemuRouterRaw(appKey, appSecret, accessToken, 'bg.order.detail.v2.get', {
              parentOrderSn: orderNum,
              parent_order_sn: orderNum,
              orderSn: ol.orderSn || orderNum,
              order_sn: ol.orderSn || orderNum
            }) || await callTemuRouterRaw(appKey, appSecret, accessToken, 'bg.logistics.shipment.get', {
              parentOrderSn: orderNum,
              parent_order_sn: orderNum
            });

            if (orderDetail) {
              const pmDetail = orderDetail.parentOrderMap || {};
              const addr = (
                orderDetail.receiptName || orderDetail.addressLineAll ? orderDetail :
                (orderDetail.receiptAddressInfo || orderDetail.addressInfo || orderDetail.recipientAddress || orderDetail.address_info ||
                 pmDetail.receiptAddressInfo || pmDetail.addressInfo || pmDetail.recipientAddress || pmDetail.receiverAddress || pmDetail.receiptAddress || pmDetail)
              );

              const nameExtra = addr.addressExtra
                ? `${addr.addressExtra.firstName || ''} ${addr.addressExtra.lastName || ''}`.trim()
                : '';
              const n = addr.receiptName || addr.receipt_name || (nameExtra && nameExtra !== '' ? nameExtra : null) ||
                addr.recipientName || addr.recipient_name || addr.receiverName || addr.receiver_name || addr.name ||
                addr.buyerName || addr.buyer_name || addr.consigneeName || addr.consignee || pmDetail.recipientName || pmDetail.receiptName || pmDetail.buyerName;
              if (n && n !== 'NOT_FOUND') { mapped.name = n; }

              const s = addr.addressLineAll || addr.addressLine1 || addr.streetName || addr.street_name || addr.detailAddress || addr.detail_address || addr.address1 || addr.address;
              if (s) mapped.streetName = s;
              const c = addr.regionName3 || addr.city || addr.cityName || addr.city_name || pmDetail.regionName3;
              if (c) mapped.cityName = c;
              const z = addr.postCode || addr.postcode || addr.zipCode || addr.zipcode || addr.zip_code;
              if (z) mapped.postcode = z;
              const p = addr.mobile || addr.phone || addr.phoneNumber;
              if (p) mapped.phone = p;
              const em = addr.mail || addr.email || pmDetail.buyerEmail;
              if (em) mapped.email = em;

              const cnt = resolveCountryIso(addr.regionName1 || pmDetail.regionName1) || mapped.country;
              if (cnt) mapped.country = cnt;

              if (s || c) {
                mapped.address = [s || mapped.streetName, [z || mapped.postcode, c || mapped.cityName].filter(Boolean).join(' '), mapped.country].filter(Boolean).join(', ');
              }
            }
          } catch (_) { /* silent fallback */ }
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

const uploadTrackingToTemu = async (user, order) => {
  if (!user || !order || !order.tracking) return;

  // Find the matching integration for the Temu order
  let integration = null;
  if (user.temuIntegrations && user.temuIntegrations.length > 0) {
    integration = user.temuIntegrations.find(i => i.isConnected);
  } else if (user.temuIntegration && user.temuIntegration.isConnected) {
    integration = user.temuIntegration;
  }

  if (!integration || !integration.appKey || !integration.appSecret) {
    console.warn('⚠️ Cannot upload Temu tracking: No connected Temu integration found.');
    return;
  }

  const { appKey, appSecret, accessToken } = integration;

  // Temu express company IDs (approximates/standard mappings):
  // DHL is usually 100001 or standard string, FedEx is 100002 or standard string.
  const isDhl = order.shippingMethod && order.shippingMethod.toLowerCase().includes('dhl');
  const expressCompanyId = isDhl ? 100001 : 100002;

  console.log(`📤 Pushing tracking number ${order.tracking} to Temu for order ${order.orderNum}...`);

  try {
    const res = await callTemuRouterAllRegions(appKey, appSecret, accessToken, 'bg.order.shipment.create', {
      order_sn: order.temuOrderId || order.orderNum,
      tracking_number: order.tracking,
      express_company_id: expressCompanyId,
      shipping_company_id: expressCompanyId
    });
    console.log(`📦 Temu tracking upload response:`, JSON.stringify(res));
  } catch (err) {
    console.error(`❌ Temu tracking upload failed:`, err.message);
  }
};

exports.syncUserTemuOrders = syncUserTemuOrders;
exports.uploadTrackingToTemu = uploadTrackingToTemu;
exports.calculateTemuPackageInfo = calculateTemuPackageInfo;


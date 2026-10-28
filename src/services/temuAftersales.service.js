const crypto = require("crypto");
const httpFetch = require("../utils/httpHelper");
const TemuReturn = require("../models/temuReturn.model");
const TemuOrder = require("../models/temuOrder.model");
const User = require("../models/user.model");

/**
 * Temu PO prefix -> country (built from real synced orders in the DB).
 * NOTE: these are Temu site IDs, not phone codes.
 */
const PREFIX_COUNTRY_MAP = {
  "013": "AT", "020": "BE", "032": "BG", "044": "GB", "050": "HR", "052": "CY", "053": "CZ",
  "054": "DK", "064": "EE", "068": "FI", "069": "FR", "076": "DE", "077": "GB", "078": "GB",
  "079": "GR", "090": "HU", "096": "IE", "098": "IT", "108": "LV", "110": "LT", "115": "LU",
  "138": "NO", "141": "NL", "162": "PL", "163": "PT", "167": "RO", "180": "SK", "181": "SI",
  "186": "ES", "191": "SE", "192": "CH"
};

const TEMU_ROUTER_URL = "https://openapi-b-eu.temu.com/openapi/router";
const LOOKBACK_DAYS = 90;
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
// Temu status groups: 1 = awaiting seller action, 5/6/7 = completed/refunded/cancelled
const CLOSED_STATUS_GROUPS = [5, 6, 7];

const extractCountryFromOrderNum = (orderNum) => {
  if (!orderNum) return "DE";
  const clean = String(orderNum).replace(/^(RET-)?PO-/i, "");
  const prefix = clean.split("-")[0];
  return PREFIX_COUNTRY_MAP[prefix] || "DE";
};

const signValue = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : String(v));

/**
 * Call Temu router. Returns { ok, result, errorCode, errorMsg }.
 */
const callTemu = async (store, type, params = {}) => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = {
    app_key: store.appKey,
    access_token: store.accessToken || "",
    timestamp,
    type,
    ...params
  };
  const sortedKeys = Object.keys(payload).sort();
  const signStr = store.appSecret + sortedKeys.map(k => `${k}${payload[k]}`).join("") + store.appSecret;
  const sign = crypto.createHash("md5").update(signStr).digest("hex").toUpperCase();
  try {
    const res = await httpFetch(TEMU_ROUTER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, sign }),
      timeout: 15000
    });
    const data = await res.json();
    const ok = data && (data.success === true || data.errorCode === 1000000 || data.errorCode === 0);
    return { ok, result: data && (data.result || data.data), errorCode: data && data.errorCode, errorMsg: data && (data.errorMsg || data.error_msg) };
  } catch (err) {
    return { ok: false, errorCode: "NETWORK", errorMsg: err.message };
  }
};

/**
 * Fetch parent after-sales records for one regional store.
 * Temu REQUIRES createAtStart/createAtEnd (unix seconds).
 */
const fetchStoreAftersales = async (store) => {
  const now = Math.floor(Date.now() / 1000);
  const start = now - LOOKBACK_DAYS * 86400;
  const records = [];
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    const r = await callTemu(store, "bg.aftersales.parentaftersales.list.get", {
      pageNo,
      pageSize: PAGE_SIZE,
      createAtStart: start,
      createAtEnd: now
    });
    if (!r.ok) {
      if (pageNo === 1) return { records, error: `${r.errorCode}: ${r.errorMsg}` };
      break;
    }
    const list = (r.result && (r.result.data || r.result.list)) || [];
    records.push(...list);
    const total = (r.result && r.result.total) || 0;
    if (list.length < PAGE_SIZE || records.length >= total) break;
  }
  return { records, error: null };
};

/**
 * Check if the return is awaiting seller action on Temu
 */
const isActionable = (rec) => {
  return Number(rec.afterSalesStatusGroup) === 1;
};


/**
 * Extract tracking number and courier from any Temu order / package / shipment payload structure
 * Supports bg.logistics.shipment.v2.get and trackingNum / logisticsStatus specifications
 */
const extractTrackingFromTemuResult = (resObj) => {
  if (!resObj) return null;
  if (typeof resObj !== 'object') return null;
  const pm = resObj.parentOrderMap || {};
  const ol = (resObj.orderList || [])[0] || {};
  const pkg = (resObj.packageList || pm.packageList || ol.packageList || resObj.packageDTOList || [])[0] || {};
  const shipList = (resObj.shippingList || pm.shippingList || ol.shippingList || resObj.shipmentList || resObj.sendRequestList || [])[0] || {};
  const shipment = resObj.shipment || resObj.shipmentInfo || {};

  const candidates = [
    resObj.trackingNumber, resObj.tracking_number, resObj.trackingNum, resObj.tracking_num,
    resObj.trackingNo, resObj.tracking_no, resObj.waybillNo, resObj.waybill_no, resObj.expressNo, resObj.express_no,
    shipment.trackingNumber, shipment.trackingNum, shipment.trackingNo, shipment.waybillNo,
    pm.trackingNo, pm.tracking_no, pm.trackingNum, pm.trackingNumber, pm.waybillNo, pm.waybill_no, pm.expressNo, pm.express_no,
    pkg.trackingNo, pkg.tracking_no, pkg.trackingNum, pkg.trackingNumber, pkg.waybillNo, pkg.waybill_no, pkg.expressNo, pkg.express_no,
    shipList.trackingNo, shipList.tracking_no, shipList.trackingNum, shipList.trackingNumber, shipList.waybillNo, shipList.waybill_no, shipList.expressNo, shipList.express_no,
    ol.trackingNo, ol.tracking_no, ol.trackingNum, ol.trackingNumber, ol.waybillNo, ol.waybill_no, ol.expressNo, ol.express_no
  ];
  const foundTrk = candidates.find(c => Boolean(c && String(c).trim() && String(c).trim() !== "null" && String(c).trim() !== "undefined"));

  const carrierCandidates = [
    resObj.carrierName, resObj.carrier_name, resObj.carrierType, resObj.carrier_type, resObj.expressCompanyName,
    shipment.carrierName, shipment.carrierType, shipment.expressCompanyName,
    pkg.carrierName, pkg.carrierType, pkg.expressCompanyName,
    shipList.carrierName, shipList.carrierType, shipList.expressCompanyName,
    pm.shippingMethod, ol.shippingMethod
  ];
  const foundCarrier = carrierCandidates.find(c => Boolean(c && String(c).trim() && String(c).trim() !== "null")) || "DHL Warenpost";

  const logisticsStatus = resObj.logisticsStatus || resObj.logistics_status || shipment.logisticsStatus || pkg.logisticsStatus || null;

  return foundTrk ? { tracking: String(foundTrk).trim(), carrier: String(foundCarrier).trim(), logisticsStatus } : null;
};

/**
 * Query Temu router across logistics & order endpoints (including bg.logistics.shipment.v2.get)
 */
const queryTemuForOrderTracking = async (store, orderNum, childOrderSn = null) => {
  if (!store || !store.appKey || !store.appSecret || !orderNum) return null;
  const cleanSn = String(orderNum).replace(/^PO-/i, "").trim();
  const fullSn = `PO-${cleanSn}`;
  const targetChildSn = childOrderSn || cleanSn;

  const endpointsToTry = [
    // 1. bg.logistics.shipment.v2.get (Temu official carrier type & shipment getter)
    { type: "bg.logistics.shipment.v2.get", params: { parentOrderSn: fullSn, orderSn: targetChildSn } },
    { type: "bg.logistics.shipment.v2.get", params: { parentOrderSn: cleanSn, orderSn: targetChildSn } },
    { type: "bg.logistics.shipment.v2.get", params: { parentOrderSn: fullSn } },

    // 2. bg.logistics.shipment.get
    { type: "bg.logistics.shipment.get", params: { parentOrderSn: fullSn, orderSn: targetChildSn } },
    { type: "bg.logistics.shipment.get", params: { parentOrderSn: cleanSn, orderSn: targetChildSn } },

    // 3. bg.order.shippinginfo.v2.get
    { type: "bg.order.shippinginfo.v2.get", params: { parentOrderSn: fullSn } },
    { type: "bg.order.shippinginfo.v2.get", params: { parentOrderSn: cleanSn } },

    // 4. bg.order.detail.v2.get
    { type: "bg.order.detail.v2.get", params: { parentOrderSn: fullSn } },
    { type: "bg.order.detail.v2.get", params: { parentOrderSn: cleanSn } },

    // 5. bg.logistics.shipment.result.get
    { type: "bg.logistics.shipment.result.get", params: { parentOrderSn: fullSn, orderSn: targetChildSn } }
  ];

  for (const ep of endpointsToTry) {
    try {
      const r = await callTemu(store, ep.type, ep.params);
      if (r && r.ok && r.result) {
        const found = extractTrackingFromTemuResult(r.result);
        if (found && found.tracking) {
          console.log(`🎯 [Temu Tracking Lookup] Hit on ${ep.type} for ${orderNum}: ${found.tracking} (${found.carrier})`);
          return found;
        }
      }
    } catch (_) {}
  }

  return null;
};

/**
 * On-demand lookup of real tracking for an order across local DB, return records, and Temu OpenAPI
 */
const fetchTemuTrackingForOrder = async (userId, orderNum) => {
  const user = await User.findById(userId);
  if (!user) return { success: false, error: "User not found" };

  const cleanOrderSn = String(orderNum).replace(/^PO-/i, "").trim();
  const fullOrderSn = `PO-${cleanOrderSn}`;

  // 1. Check local DB (TemuOrder) first
  const existingOrder = await TemuOrder.findOne({
    user: user._id,
    $or: [{ orderNum: fullOrderSn }, { orderNum: cleanOrderSn }]
  }).lean();

  if (existingOrder && existingOrder.tracking && existingOrder.tracking.trim()) {
    await TemuReturn.updateMany(
      { user: user._id, orderNum: { $in: [fullOrderSn, cleanOrderSn] } },
      { $set: { trackingNumber: existingOrder.tracking.trim(), carrier: existingOrder.shippingMethod || "DHL Warenpost" } }
    ).catch(() => {});
    return {
      success: true,
      tracking: existingOrder.tracking.trim(),
      carrier: existingOrder.shippingMethod || "DHL Warenpost",
      source: "database"
    };
  }

  // 2. Check TemuReturn record if it already has tracking
  const existingReturn = await TemuReturn.findOne({
    user: user._id,
    $or: [{ orderNum: fullOrderSn }, { orderNum: cleanOrderSn }],
    trackingNumber: { $exists: true, $ne: "" }
  }).lean();

  if (existingReturn && existingReturn.trackingNumber && existingReturn.trackingNumber.trim()) {
    await TemuOrder.updateOne(
      { user: user._id, $or: [{ orderNum: fullOrderSn }, { orderNum: cleanOrderSn }] },
      { $set: { tracking: existingReturn.trackingNumber.trim() } }
    ).catch(() => {});
    return {
      success: true,
      tracking: existingReturn.trackingNumber.trim(),
      carrier: existingReturn.carrier || "DHL Warenpost",
      source: "database"
    };
  }

  // 3. Query Temu OpenAPI across stores in parallel
  const stores = (user.temuIntegrations && user.temuIntegrations.length > 0)
    ? user.temuIntegrations.filter(i => i.isConnected && i.appKey && i.appSecret)
    : (user.temuIntegration && user.temuIntegration.isConnected ? [user.temuIntegration] : []);

  if (!stores.length) {
    return { success: false, error: "No connected Temu stores found" };
  }

  const childOrderSn = (existingOrder && (existingOrder.temuOrderId || existingOrder.orderId)) || cleanOrderSn;

  // Prioritize matching regional store if known from prefix
  const targetCountry = extractCountryFromOrderNum(orderNum);
  const sortedStores = [...stores].sort((a, b) => {
    const aMatch = (a.region === targetCountry || (a.shopName && a.shopName.includes(targetCountry))) ? -1 : 1;
    const bMatch = (b.region === targetCountry || (b.shopName && b.shopName.includes(targetCountry))) ? -1 : 1;
    return aMatch - bMatch;
  });

  const promises = sortedStores.map(store =>
    queryTemuForOrderTracking(store, cleanOrderSn, childOrderSn).then(res => (res && res.tracking ? { ...res, store: store.shopName } : null))
  );

  const results = await Promise.allSettled(promises);
  for (const r of results) {
    if (r.status === "fulfilled" && r.value && r.value.tracking) {
      const found = r.value;
      console.log(`🎯 [Temu Tracking Lookup] Found tracking ${found.tracking} from store ${found.store} for ${orderNum}`);
      await TemuOrder.updateOne(
        { user: user._id, $or: [{ orderNum: fullOrderSn }, { orderNum: cleanOrderSn }] },
        { $set: { tracking: found.tracking, status: "printed" } }
      ).catch(() => {});
      await TemuReturn.updateMany(
        { user: user._id, orderNum: { $in: [fullOrderSn, cleanOrderSn] } },
        { $set: { trackingNumber: found.tracking, carrier: found.carrier } }
      ).catch(() => {});

      return {
        success: true,
        tracking: found.tracking,
        carrier: found.carrier,
        source: "temu_api",
        store: found.store
      };
    }
  }

  return {
    success: false,
    message: "Tracking number not exposed by Temu OpenAPI for this order.",
    orderNum
  };
};

const syncAllRegionalReturns = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return { syncedStores: 0, newlySynced: 0, totalPending: 0, storeErrors: [] };

  const stores = (user.temuIntegrations && user.temuIntegrations.length > 0)
    ? user.temuIntegrations.filter(i => i.isConnected && i.appKey && i.appSecret)
    : (user.temuIntegration && user.temuIntegration.isConnected ? [user.temuIntegration] : []);

  console.log(`🌐 [Temu Regional Sync] Checking ${stores.length} regional stores for ${user.email}`);

  const storeErrors = [];
  const found = [];

  // Run stores in parallel batches of 8 for high throughput
  const BATCH = 8;
  for (let i = 0; i < stores.length; i += BATCH) {
    const batch = stores.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(fetchStoreAftersales));
    results.forEach((res, idx) => {
      const store = batch[idx];
      if (res.status !== "fulfilled") {
        storeErrors.push({ store: store.shopName, error: String(res.reason) });
        return;
      }
      if (res.value.error) storeErrors.push({ store: store.shopName, error: res.value.error });
      res.value.records.forEach(rec => found.push({ store, rec }));
    });
  }

  console.log(`📦 [Temu Regional Sync] Temu returned ${found.length} after-sales records across ${stores.length} stores.`);

  let newlySynced = 0;
  let closedUpdated = 0;
  const countries = {};

  // Bulk query existing records & matched orders to eliminate hundreds of slow sequential roundtrips
  const allReturnIds = [];
  const allOrderNums = [];
  for (const { rec } of found) {
    if (rec.parentAfterSalesSn) {
      allReturnIds.push(rec.parentAfterSalesSn);
    }
    if (rec.parentOrderSn) {
      allReturnIds.push(`RET-${rec.parentOrderSn}`);
      const cleanSn = String(rec.parentOrderSn).replace(/^PO-/i, '').trim();
      allOrderNums.push(cleanSn);
      allOrderNums.push(`PO-${cleanSn}`);
    }
  }

  const existingReturns = await TemuReturn.find({
    user: user._id,
    returnId: { $in: allReturnIds }
  }).lean();
  const existingMap = new Map();
  for (const doc of existingReturns) {
    existingMap.set(doc.returnId, doc);
    if (doc.orderNum) {
      existingMap.set(`RET-${doc.orderNum}`, doc);
    }
  }

  const matchedOrders = await TemuOrder.find({
    user: user._id,
    orderNum: { $in: allOrderNums }
  }).lean();
  const orderMap = new Map();
  for (const o of matchedOrders) {
    orderMap.set(o.orderNum, o);
    const clean = String(o.orderNum).replace(/^PO-/i, '').trim();
    orderMap.set(clean, o);
    orderMap.set(`PO-${clean}`, o);
  }

  for (const { store, rec } of found) {
    const returnId = rec.parentAfterSalesSn;
    const orderNum = rec.parentOrderSn;
    if (!returnId || !orderNum) continue;

    const actionable = isActionable(rec);
    const cleanSn = String(orderNum).replace(/^PO-/i, '').trim();
    const matchedOrder = orderMap.get(orderNum) || orderMap.get(cleanSn) || orderMap.get(`PO-${cleanSn}`);
    const existing = existingMap.get(returnId) || existingMap.get(`RET-${orderNum}`);

    // Parse Temu specific refund amount & reasons if present in payload
    let temuRefund = null;
    const rawAmount = rec.refundAmount ?? rec.applyRefundAmount ?? rec.refundFee ?? rec.actualRefundAmount;
    if (rawAmount !== undefined && rawAmount !== null) {
      const num = Number(rawAmount);
      if (!isNaN(num) && num > 0) {
        temuRefund = (Number.isInteger(num) && num > 100 && (!matchedOrder || num > (Number(matchedOrder.price) || 0) * 2)) ? num / 100 : num;
      }
    }

    const goodsItem = (rec.goodsList && rec.goodsList[0]) || {};
    const orderItemSn = rec.orderItemSn || rec.orderItemId || rec.orderGoodsId || rec.orderDetailId || goodsItem.orderGoodsId || (matchedOrder && matchedOrder.temuOrderId) || "";
    const rawReason = rec.buyerReasonDesc || rec.buyerReason || rec.reason || rec.afterSalesReason || rec.buyerApplyReason || goodsItem.buyerReasonDesc || goodsItem.buyerReason || (existing && existing.reason && !existing.reason.startsWith("Refund-only") && !existing.reason.startsWith("Return & refund") ? existing.reason : "");
    const buyerComment = rec.buyerComment || rec.comment || rec.afterSalesDesc || goodsItem.buyerComment || (existing && existing.buyerComment) || "";
    let reasonText = rawReason || (existing && existing.reason) || null;
    const mediaUrls = (Array.isArray(rec.pictureList) && rec.pictureList.length) ? rec.pictureList : (Array.isArray(rec.pictures) && rec.pictures.length) ? rec.pictures : (Array.isArray(rec.evidenceList) && rec.evidenceList.length) ? rec.evidenceList : (goodsItem.pictureList && Array.isArray(goodsItem.pictureList) && goodsItem.pictureList.length) ? goodsItem.pictureList : (existing && existing.mediaUrls && existing.mediaUrls.length) ? existing.mediaUrls : ((matchedOrder && matchedOrder.productImage) ? [matchedOrder.productImage] : []);
    const productImage = (matchedOrder && matchedOrder.productImage) || goodsItem.goodsImgUrl || (existing && existing.itemDetails && existing.itemDetails.productImage) || "";
    const variation = (matchedOrder && matchedOrder.variation) || goodsItem.specDesc || (existing && existing.itemDetails && existing.itemDetails.variation) || "Pack of 1";
    const orderDate = (matchedOrder && matchedOrder.createdAt) || (existing && existing.orderDate) || (rec.orderTime ? new Date(rec.orderTime * 1000) : null);
    const requestedDate = rec.createAt ? new Date(Number(rec.createAt) * 1000) : (existing && existing.requestedDate) || (existing && existing.temuCreatedAt) || new Date();


    const temuMeta = {
      temuStatusGroup: Number(rec.afterSalesStatusGroup),
      temuStatus: rec.parentAfterSalesStatus,
      temuAfterSalesType: rec.afterSalesType,
      availableActions: Array.isArray(rec.availableOperateList) ? rec.availableOperateList.map(String) : [],
      operateExpireAt: rec.operateExpireTimeMs ? new Date(Number(rec.operateExpireTimeMs)) : null,
      temuCreatedAt: rec.createAt ? new Date(Number(rec.createAt) * 1000) : null,
      lastTemuSyncAt: new Date()
    };

    if (existing) {
      const update = { ...temuMeta };
      // If Temu closed it (group 5, 6, 7) and it's still open without manual notes, close it
      if (!actionable && existing.status === 'pending' && !existing.resolutionNotes) {
        update.status = Number(rec.afterSalesStatusGroup) === 7 ? 'rejected' : 'refunded';
        update.resolvedAt = new Date();
        closedUpdated++;
      }
      // If Temu marks it awaiting seller action and it has no manual resolution, ensure it's pending
      if (actionable && existing.status !== 'pending' && !existing.resolutionNotes) {
        update.status = 'pending';
      }
      if (temuRefund) update.refundAmount = temuRefund;
      if (reasonText && (!existing.reason || existing.reason.startsWith('Customer Returnless') || existing.reason.startsWith('Return & refund') || existing.reason.startsWith('Refund-only'))) {
        update.reason = reasonText;
      }
      if (orderItemSn) {
        update['itemDetails.orderItemId'] = orderItemSn;
      }
      if (!existing.trackingNumber) {
        const fetched = (matchedOrder && matchedOrder.tracking)
          ? { tracking: matchedOrder.tracking, carrier: matchedOrder.shippingMethod }
          : (actionable ? await queryTemuForOrderTracking(store, orderNum) : null);
        if (fetched && fetched.tracking) {
          update.trackingNumber = fetched.tracking;
          if (fetched.carrier) update.carrier = fetched.carrier;
          await TemuOrder.updateOne(
            { user: user._id, $or: [{ orderNum }, { orderNum: cleanSn }, { orderNum: `PO-${cleanSn}` }] },
            { $set: { tracking: fetched.tracking, status: 'printed' } }
          ).catch(() => {});
        }
      }
      await TemuReturn.updateOne({ _id: existing._id }, { $set: update });
      if (actionable) {
        const c = existing.country || extractCountryFromOrderNum(orderNum);
        countries[c] = (countries[c] || 0) + 1;
      }
      continue;
    }

    // Do not import closed historical returns as pending
    if (!actionable) continue;

    const country = (matchedOrder && matchedOrder.country) || extractCountryFromOrderNum(orderNum);
    const typeLabel = Number(rec.afterSalesType) === 1 ? 'Refund-only (returnless) request' : 'Return & refund request';

    let trackingNumber = (matchedOrder && matchedOrder.tracking) || '';
    let carrier = (matchedOrder && matchedOrder.shippingMethod) || 'DHL Paket';

    if (!trackingNumber) {
      const fetched = await queryTemuForOrderTracking(store, orderNum);
      if (fetched && fetched.tracking) {
        trackingNumber = fetched.tracking;
        if (fetched.carrier) carrier = fetched.carrier;
        await TemuOrder.updateOne(
          { user: user._id, $or: [{ orderNum }, { orderNum: cleanSn }, { orderNum: `PO-${cleanSn}` }] },
          { $set: { tracking: trackingNumber, status: 'printed' } }
        ).catch(() => {});
      }
    }

    const createdDoc = await TemuReturn.create({
      user: user._id,
      returnId,
      orderNum,
      buyerName: (matchedOrder && (matchedOrder.buyerName || matchedOrder.name)) || 'Temu Customer',
      country,
      refundAmount: temuRefund || (matchedOrder && Number(matchedOrder.price)) || 19.95,
      reason: reasonText || `${typeLabel} on Temu (${country})`,
      itemDetails: {
        articleName: (matchedOrder && matchedOrder.articleName) || 'Temu Product',
        sku: (matchedOrder && matchedOrder.sku) || '',
        quantity: 1,
        orderItemId: orderItemSn
      },
      trackingNumber,
      carrier,
      status: 'pending',
      resolutionNotes: '',
      ...temuMeta
    });
    existingMap.set(returnId, createdDoc);
    existingMap.set(`RET-${orderNum}`, createdDoc);
    newlySynced++;
    countries[country] = (countries[country] || 0) + 1;
  }

  const totalPending = await TemuReturn.countDocuments({
    user: user._id,
    status: 'pending',
    temuStatusGroup: 1,
    $or: [{ resolutionNotes: '' }, { resolutionNotes: { $exists: false } }, { resolutionNotes: null }]
  });
  console.log(`✅ [Temu Regional Sync] Done. Actionable pending now: ${totalPending}`);
  return {
    syncedStores: stores.length,
    storesWithErrors: storeErrors.length,
    temuRecords: found.length,
    newlySynced,
    closedUpdated,
    openByCountry: countries,
    totalPending
  };
};

module.exports = {
  syncAllRegionalReturns,
  extractCountryFromOrderNum,
  fetchTemuTrackingForOrder,
  queryTemuForOrderTracking
};

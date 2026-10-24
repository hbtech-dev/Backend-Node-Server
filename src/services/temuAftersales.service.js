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
  "013": "AT", "020": "BE", "032": "BG", "050": "HR", "053": "CZ",
  "054": "DK", "064": "EE", "069": "FR", "076": "DE", "079": "GR",
  "090": "HU", "096": "IE", "098": "IT", "108": "LV", "141": "NL",
  "162": "PL", "163": "PT", "167": "RO", "180": "SK", "181": "SI",
  "186": "ES", "191": "SE", "192": "CH"
};

const TEMU_ROUTER_URL = "https://openapi-b-eu.temu.com/openapi/router";
const LOOKBACK_DAYS = 180;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
// afterSalesStatusGroup 5 = completed/closed on Temu
const CLOSED_STATUS_GROUPS = [5];

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
  const payload = {
    app_key: store.appKey,
    access_token: store.accessToken || "",
    timestamp: Math.floor(Date.now() / 1000).toString(),
    type,
    data_type: "JSON",
    ...params
  };
  const signStr = store.appSecret + Object.keys(payload).sort().map(k => k + signValue(payload[k])).join("") + store.appSecret;
  const sign = crypto.createHash("md5").update(signStr).digest("hex").toUpperCase();
  try {
    const res = await httpFetch(TEMU_ROUTER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, sign }),
      timeout: 12000
    });
    const data = await res.json();
    const ok = data && (data.success === true || data.errorCode === 1000000);
    return { ok, result: data && data.result, errorCode: data && data.errorCode, errorMsg: data && data.errorMsg };
  } catch (err) {
    return { ok: false, errorCode: "NETWORK", errorMsg: err.message };
  }
};

/**
 * Fetch every parent after-sales record for one regional store (paginated).
 * Temu REQUIRES createAtStart/createAtEnd (unix seconds) - without them it
 * responds "The parameter is illegal".
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
 * Best-effort: fetch child after-sales details (refund amount / reason).
 */
const fetchAftersalesDetails = async (store, parentAfterSalesSn, parentOrderSn) => {
  const r = await callTemu(store, "bg.aftersales.aftersales.list.get", {
    parentAfterSalesSnList: [parentAfterSalesSn],
    parentOrderSn
  });
  if (!r.ok) {
    console.log(`ℹ️ [Temu Regional Sync] detail lookup for ${parentAfterSalesSn} failed: ${r.errorCode} ${r.errorMsg}`);
    return null;
  }
  const list = (r.result && (r.result.data || r.result.list || r.result.afterSalesList)) || [];
  if (Array.isArray(list) && list[0]) console.log("ℹ️ [Temu Regional Sync] detail sample:", JSON.stringify(list[0]).slice(0, 800));
  return Array.isArray(list) && list.length ? list : null;
};

const isActionable = (rec) => {
  const ops = Array.isArray(rec.availableOperateList) ? rec.availableOperateList : [];
  if (ops.length > 0) return true;
  return !CLOSED_STATUS_GROUPS.includes(Number(rec.afterSalesStatusGroup));
};

const syncAllRegionalReturns = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return { syncedStores: 0, newlySynced: 0, totalPending: 0, storeErrors: [] };

  const stores = (user.temuIntegrations && user.temuIntegrations.length > 0)
    ? user.temuIntegrations.filter(i => i.isConnected && i.appKey && i.appSecret)
    : (user.temuIntegration && user.temuIntegration.isConnected ? [user.temuIntegration] : []);

  console.log(`🌐 [Temu Regional Sync] Checking ${stores.length} regional stores for ${user.email}`);

  const storeErrors = [];
  const found = []; // { store, rec }

  // Run stores in small parallel batches to avoid Temu rate limiting
  const BATCH = 6;
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

  console.log(`📦 [Temu Regional Sync] Temu returned ${found.length} after-sales records. Store errors: ${storeErrors.length}`);
  if (storeErrors.length) console.warn("⚠️ [Temu Regional Sync] Store errors:", JSON.stringify(storeErrors).slice(0, 1500));

  let newlySynced = 0;
  let closedUpdated = 0;
  const countries = {};

  for (const { store, rec } of found) {
    const returnId = rec.parentAfterSalesSn;
    const orderNum = rec.parentOrderSn;
    if (!returnId || !orderNum) continue;

    const actionable = isActionable(rec);
    const existing = await TemuReturn.findOne({
      user: user._id,
      returnId: { $in: [returnId, `RET-${orderNum}`] }
    });

    const temuMeta = {
      temuStatusGroup: rec.afterSalesStatusGroup,
      temuStatus: rec.parentAfterSalesStatus,
      temuAfterSalesType: rec.afterSalesType,
      availableActions: Array.isArray(rec.availableOperateList) ? rec.availableOperateList.map(String) : [],
      operateExpireAt: rec.operateExpireTimeMs ? new Date(Number(rec.operateExpireTimeMs)) : null,
      temuCreatedAt: rec.createAt ? new Date(Number(rec.createAt) * 1000) : null,
      lastTemuSyncAt: new Date()
    };

    if (existing) {
      const update = { ...temuMeta };
      // Temu closed it but we still show it as open -> close it locally
      if (!actionable && existing.status === "pending" && !existing.resolutionNotes) {
        update.status = "refunded";
        update.resolvedAt = new Date();
        closedUpdated++;
      }
      // Temu still awaiting seller action and we never resolved it
      if (actionable && existing.status !== "pending" && !existing.resolutionNotes) {
        update.status = "pending";
      }
      await TemuReturn.updateOne({ _id: existing._id }, { $set: update });
      if (actionable) {
        const c = existing.country || extractCountryFromOrderNum(orderNum);
        countries[c] = (countries[c] || 0) + 1;
      }
      continue;
    }

    // New record: only import still-open returns (closed history is not useful in the work queue)
    if (!actionable) continue;

    const matchedOrder = await TemuOrder.findOne({
      user: user._id,
      $or: [
        { orderNum },
        { orderNum: orderNum.replace(/^PO-/i, "") },
        { orderNum: "PO-" + orderNum.replace(/^PO-/i, "") }
      ]
    }).lean();

    let refundAmount = null;
    let reason = "";
    let articleName = "";
    let sku = "";
    const details = await fetchAftersalesDetails(store, returnId, orderNum);
    if (details) {
      const d = details[0];
      const amt = d.refundAmount || d.applyRefundAmount || d.refund_amount;
      if (amt !== undefined && amt !== null) {
        const n = Number(typeof amt === "object" ? (amt.amount || amt.value) : amt);
        if (!Number.isNaN(n)) refundAmount = n > 1000 ? n / 100 : n;
      }
      reason = d.reasonDesc || d.afterSalesReason || d.applyReason || d.buyerComment || "";
      articleName = d.goodsName || "";
      sku = d.skuId ? String(d.skuId) : "";
    }

    const country = (matchedOrder && matchedOrder.country) || extractCountryFromOrderNum(orderNum);
    const typeLabel = Number(rec.afterSalesType) === 1 ? "Refund-only (returnless) request" : "Return & refund request";

    await TemuReturn.create({
      user: user._id,
      returnId,
      orderNum,
      buyerName: (matchedOrder && (matchedOrder.buyerName || matchedOrder.name)) || "Temu Customer",
      country,
      refundAmount: refundAmount || (matchedOrder && Number(matchedOrder.price)) || 0,
      reason: reason || `${typeLabel} on Temu (${country})`,
      itemDetails: {
        articleName: articleName || (matchedOrder && matchedOrder.articleName) || "Temu Product",
        sku: sku || (matchedOrder && matchedOrder.sku) || "",
        quantity: 1
      },
      trackingNumber: (matchedOrder && matchedOrder.tracking) || "",
      carrier: (matchedOrder && matchedOrder.shippingMethod) || "DHL Paket",
      status: "pending",
      resolutionNotes: "",
      ...temuMeta
    });
    newlySynced++;
    countries[country] = (countries[country] || 0) + 1;
  }

  const totalPending = await TemuReturn.countDocuments({
    user: user._id,
    status: "pending",
    $or: [{ resolutionNotes: "" }, { resolutionNotes: { $exists: false } }, { resolutionNotes: null }]
  });

  console.log(`✅ [Temu Regional Sync] Done. Temu records: ${found.length}, new: ${newlySynced}, closed: ${closedUpdated}, pending now: ${totalPending}`);
  return {
    syncedStores: stores.length,
    storesWithErrors: storeErrors.length,
    storeErrors: storeErrors.slice(0, 10),
    temuRecords: found.length,
    newlySynced,
    closedUpdated,
    openByCountry: countries,
    totalPending
  };
};

module.exports = {
  syncAllRegionalReturns,
  extractCountryFromOrderNum
};

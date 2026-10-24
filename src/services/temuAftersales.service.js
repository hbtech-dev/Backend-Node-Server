const crypto = require("crypto");
const TemuReturn = require("../models/temuReturn.model");
const TemuOrder = require("../models/temuOrder.model");
const User = require("../models/user.model");

const PREFIX_COUNTRY_MAP = {
  "076": "DE", "069": "FR", "163": "PT", "034": "ES", "039": "IT",
  "020": "BE", "079": "GR", "096": "IE", "053": "CZ", "048": "PL",
  "031": "NL", "046": "SE", "054": "DK", "043": "AT", "041": "CH",
  "044": "GB", "040": "RO", "036": "HU", "042": "SK", "035": "BG",
  "038": "HR", "037": "LT", "071": "LV", "072": "EE", "058": "FI",
  "047": "NO", "030": "SI", "052": "LU", "051": "CY", "056": "MT"
};

const extractCountryFromOrderNum = (orderNum) => {
  if (!orderNum) return "DE";
  const clean = String(orderNum).replace(/^PO-/i, "");
  const prefix = clean.split("-")[0];
  return PREFIX_COUNTRY_MAP[prefix] || "DE";
};

const callTemuApi = async (url, appKey, appSecret, accessToken, apiType, extraParams = {}) => {
  if (!appKey || !appSecret) return null;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = {
    app_key: appKey,
    access_token: accessToken || "",
    timestamp,
    type: apiType,
    data_type: "JSON",
    page_size: 50,
    page_number: 1,
    page: 1,
    ...extraParams
  };
  const sortedKeys = Object.keys(payload).sort();
  const signStr = appSecret + sortedKeys.map(k => String(k) + String(payload[k])).join("") + appSecret;
  const sign = crypto.createHash("md5").update(signStr).digest("hex").toUpperCase();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, sign }),
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
};

const syncAllRegionalReturns = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return { syncedStores: 0, newlySynced: 0, totalPending: 0 };

  const stores = (user.temuIntegrations && user.temuIntegrations.length > 0)
    ? user.temuIntegrations.filter(i => i.isConnected && i.appKey && i.appSecret)
    : (user.temuIntegration && user.temuIntegration.isConnected ? [user.temuIntegration] : []);

  console.log("🌐 [Temu Regional Sync] Checking " + stores.length + " connected regional stores concurrently for " + user.email);

  const routerUrl = "https://openapi-b-eu.temu.com/openapi/router";
  const apiEndpoints = [
    "bg.aftersales.parentaftersales.list.get",
    "bg.aftersales.aftersales.list.get"
  ];

  let newlySynced = 0;
  const foundReturns = [];

  // Query all stores concurrently in parallel
  await Promise.allSettled(stores.map(async (store) => {
    for (const apiType of apiEndpoints) {
      const result = await callTemuApi(routerUrl, store.appKey, store.appSecret, store.accessToken, apiType, {
        after_sales_status: 1
      });

      if (result && result.success && result.result) {
        const items = Array.isArray(result.result.list)
          ? result.result.list
          : Array.isArray(result.result)
            ? result.result
            : Array.isArray(result.result.data)
              ? result.result.data
              : [];

        for (const item of items) {
          const retId = item.parent_after_sales_sn || item.after_sales_sn || item.return_order_sn || item.return_id;
          const orderSn = item.parent_order_sn || item.order_sn;
          if (retId && orderSn) {
            foundReturns.push({
              returnId: String(retId),
              orderNum: String(orderSn).startsWith("PO-") ? String(orderSn) : "PO-" + orderSn,
              buyerName: item.buyer_name || item.consignee_name || "Temu Customer",
              refundAmount: item.refund_amount ? (Number(item.refund_amount) > 100 ? Number(item.refund_amount) / 100 : Number(item.refund_amount)) : 19.95,
              reason: item.after_sales_reason || item.reason_desc || item.buyer_comment || "Customer Return / Refund Request on Temu",
              goodsName: item.goods_name || "Temu Product",
              sku: item.sku_id || "SKU-TEMU"
            });
          }
        }
      }
    }
  }));

  // Correlate with TemuOrder to get full customer details and upsert
  for (const ret of foundReturns) {
    const existing = await TemuReturn.findOne({ user: user._id, returnId: ret.returnId });
    if (existing && existing.status === "rejected" && existing.resolutionNotes) {
      continue;
    }

    const matchedOrder = await TemuOrder.findOne({
      user: user._id,
      $or: [
        { orderNum: ret.orderNum },
        { orderNum: ret.orderNum.replace(/^PO-/i, "") },
        { orderNum: "PO-" + ret.orderNum.replace(/^PO-/i, "") }
      ]
    }).lean();

    const country = matchedOrder?.country || extractCountryFromOrderNum(ret.orderNum);
    const buyerName = matchedOrder?.buyerName || matchedOrder?.name || ret.buyerName;
    const priceVal = ret.refundAmount || matchedOrder?.price || 19.95;
    const article = matchedOrder?.articleName || ret.goodsName;
    const sku = matchedOrder?.sku || ret.sku;
    const trackingNo = matchedOrder?.tracking || "";
    const carrier = matchedOrder?.shippingMethod || "DHL Paket";

    await TemuReturn.updateOne(
      { user: user._id, returnId: ret.returnId },
      {
        $set: {
          user: user._id,
          returnId: ret.returnId,
          orderNum: ret.orderNum,
          buyerName,
          country,
          refundAmount: priceVal,
          reason: ret.reason,
          itemDetails: {
            articleName: article,
            sku,
            quantity: 1
          },
          trackingNumber: trackingNo,
          carrier
        },
        $setOnInsert: {
          status: "pending",
          resolutionNotes: "",
          resolvedAt: null
        }
      },
      { upsert: true }
    );
    newlySynced++;
  }

  const currentPending = await TemuReturn.countDocuments({
    user: user._id,
    status: "pending",
    $or: [{ resolutionNotes: "" }, { resolutionNotes: { $exists: false } }, { resolutionNotes: null }]
  });

  console.log("✅ [Temu Regional Sync] Finished concurrent sync across " + stores.length + " regional stores. Total Pending now: " + currentPending);
  return {
    syncedStores: stores.length,
    newlySynced,
    totalPending: currentPending
  };
};

module.exports = {
  syncAllRegionalReturns,
  extractCountryFromOrderNum
};

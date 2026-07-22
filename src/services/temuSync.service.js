/**
 * Temu Real-Time Order Sync Service
 * Periodically polls Temu Open Platform API for new unshipped orders
 * and keeps orders updated in MongoDB.
 */

const User = require('../models/user.model');
const TemuOrder = require('../models/temuOrder.model');
const Notification = require('../models/notification.model');

let syncInterval = null;

const syncUserTemuOrders = async (user) => {
  if (!user || !user.temuIntegration || !user.temuIntegration.isConnected) return;

  try {
    const appKey = user.temuIntegration.appKey;
    const appSecret = user.temuIntegration.appSecret;
    const baseUrl = process.env.TEMU_API_BASE_URL;

    let unshippedOrders = [];
    let shippedOrderNums = [];

    // If live API credentials exist and base URL configured
    if (baseUrl && appKey && appSecret) {
      try {
        // Fetch unshipped orders from Temu
        const unshippedRes = await fetch(`${baseUrl}/api/v1/orders/unshipped`, {
          headers: {
            'X-Temu-App-Key': appKey,
            'Authorization': `Bearer ${appSecret}`,
            'Content-Type': 'application/json'
          }
        });
        if (unshippedRes.ok) {
          const payload = await unshippedRes.json();
          unshippedOrders = payload.orders || payload.data || [];
        }

        // Fetch shipped/fulfilled orders from Temu so we can remove them from open
        const shippedRes = await fetch(`${baseUrl}/api/v1/orders/shipped`, {
          headers: {
            'X-Temu-App-Key': appKey,
            'Authorization': `Bearer ${appSecret}`,
            'Content-Type': 'application/json'
          }
        });
        if (shippedRes.ok) {
          const shippedPayload = await shippedRes.json();
          const shippedList = shippedPayload.orders || shippedPayload.data || [];
          shippedOrderNums = shippedList.map(o => o.orderNum).filter(Boolean);
        }
      } catch (err) {
        console.warn(`Temu live API poll error for user ${user._id}:`, err.message);
      }
    }

    // Remove orders from our open queue that Temu has marked as shipped externally
    // (i.e., shipped by seller outside our portal — don't override our portal's created_label)
    if (shippedOrderNums.length > 0) {
      await TemuOrder.deleteMany({
        user: user._id,
        orderNum: { $in: shippedOrderNums },
        status: 'open' // Only delete if still open — leave created_label/printed intact
      });
    }

    // Upsert truly unshipped orders from Temu live API
    for (const orderData of unshippedOrders) {
      const exists = await TemuOrder.findOne({ user: user._id, orderNum: orderData.orderNum });
      if (!exists) {
        await TemuOrder.create({
          user: user._id,
          orderNum: orderData.orderNum || `PO-TEMU-${Date.now()}`,
          temuOrderId: orderData.temuOrderId || `TM-${Math.floor(100000000 + Math.random() * 900000000)}`,
          name: orderData.name || orderData.recipientName || 'Temu Customer',
          country: orderData.country || 'DE',
          streetName: orderData.streetName || '',
          houseNumber: orderData.houseNumber || '',
          postcode: orderData.postcode || '',
          cityName: orderData.cityName || '',
          address: orderData.address || '',
          email: orderData.email || '',
          phone: orderData.phone || '',
          articleName: orderData.articleName || orderData.productName || orderData.goodsName || 'Temu Item',
          sku: orderData.sku || orderData.skuId || orderData.goodsId || 'TM-SKU-001',
          quantity: orderData.quantity || orderData.goodsNum || 1,
          variation: orderData.variation || orderData.goodsSpec || orderData.skuSpec || orderData.spec || 'Standard',
          packaging: orderData.packaging || orderData.packageSpec || 'Small Parcel (25×18×10cm)',
          productImage: orderData.productImage || orderData.imageUrl || orderData.goodsImg || orderData.goods_img || orderData.thumbUrl || orderData.sku_img || '',
          price: orderData.price || orderData.goodsPrice || 19.99,
          weight: orderData.weight || '0.50 kg',
          status: 'open',
          source: 'Temu'
        });

        // Notify user of new unshipped order arrival from Temu
        await Notification.create({
          title: 'New Temu Order Received',
          message: `Order ${orderData.orderNum} received from Temu store. Ready for shipment.`,
          type: 'info',
          user: user._id
        });
      }
    }

    user.temuIntegration.lastSyncedAt = new Date();
    await user.save();
  } catch (error) {
    console.error(`Error background-syncing Temu orders for user ${user._id}:`, error.message);
  }
};

exports.startTemuBackgroundSync = () => {
  if (syncInterval) return;

  console.log('⚡ Temu Background Sync Service started (polling every 20s)...');

  // Run initial sync check
  const runSync = async () => {
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) {
        return; // DB offline, skip background sync safely
      }
      const connectedUsers = await User.find({ 'temuIntegration.isConnected': true });
      for (const user of connectedUsers) {
        await syncUserTemuOrders(user);
      }
    } catch (err) {
      console.error('Temu background sync iteration error:', err.message);
    }
  };

  runSync();
  syncInterval = setInterval(runSync, 20000); // Poll every 20 seconds
};

exports.stopTemuBackgroundSync = () => {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
};

exports.syncUserTemuOrders = syncUserTemuOrders;

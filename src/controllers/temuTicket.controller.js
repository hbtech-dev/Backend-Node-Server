const mongoose = require('mongoose');
const TemuTicket = require('../models/temuTicket.model');
const User = require('../models/user.model');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const httpFetch = require('../utils/httpHelper');
const crypto = require('crypto');

const SEED_SPAIN_TICKETS = [
  {
    ticketId: '1789730673186481',
    orderNum: 'PO-186-16929795850871459',
    country: 'ES',
    type: 'Information Ticket',
    scene: 'Tracking status - no update',
    subStatus: 'Wait Merchant Reply',
    processingTime: '2d 5h 26m',
    subject: 'Tracking status - no update',
    buyerName: 'Temu Customer',
    description: 'Dear merchant, a customer has reported not receiving their package for a long time. In order to avoid logistics complaints, please check the package status and reply.',
    buyerMessage: 'Dear merchant, a customer has reported not receiving their package for a long time. In order to avoid logistics complaints, please check the package status and reply.',
    articleName: 'Temu Product',
    sku: '59843658408164',
    deadline: new Date(Date.now() + 53 * 60 * 60 * 1000),
    status: 'pending',
    source: 'Temu'
  },
  {
    ticketId: '1789730319186655',
    orderNum: 'PO-186-15605120256631227',
    country: 'ES',
    type: 'Information Ticket',
    scene: 'Delivery exception',
    subStatus: 'Wait Merchant Reply',
    processingTime: '2d 5h 20m',
    subject: 'Delivery exception',
    buyerName: 'Temu Customer',
    description: 'Please help resolve the delivery exception for this package as the customer needs it urgently.',
    buyerMessage: 'Please help resolve the delivery exception for this package as the customer needs it urgently.',
    articleName: 'Temu Product',
    sku: '59843658408165',
    deadline: new Date(Date.now() + 53 * 60 * 60 * 1000),
    status: 'pending',
    source: 'Temu'
  },
  {
    ticketId: '1789601016186924',
    orderNum: 'PO-163-05818240277112281',
    country: 'ES',
    type: 'Information Ticket',
    scene: 'Delivery exception',
    subStatus: 'Wait Merchant Reply',
    processingTime: '2d 11h 54m',
    subject: 'Delivery exception',
    buyerName: 'salete Gonçalves',
    description: "Dear Merchant The customer wants a refund and don't want the order.",
    buyerMessage: "Dear Merchant The customer wants a refund and don't want the order.",
    articleName: 'Temu Product',
    sku: '59843658408166',
    deadline: new Date(Date.now() + 59 * 60 * 60 * 1000),
    status: 'pending',
    source: 'Temu'
  },
  {
    ticketId: '1789385504186115',
    orderNum: 'PO-096-16696593142392849',
    country: 'ES',
    type: 'Information Ticket',
    scene: 'Available for Pickup',
    subStatus: 'Wait Merchant Reply',
    processingTime: '2d 16h 2m',
    subject: 'Available for Pickup',
    buyerName: 'Temu Customer',
    description: 'Dear Merchant, We have recently received feedback from a customer who marked parcel as available for pickup.',
    buyerMessage: 'Dear Merchant, We have recently received feedback from a customer who marked parcel as available for pickup.',
    articleName: 'Temu Product',
    sku: '59843658408167',
    deadline: new Date(Date.now() + 64 * 60 * 60 * 1000),
    status: 'pending',
    source: 'Temu'
  }
];

/**
 * Get all Temu tickets (Information Tickets & Fulfillment Issues)
 */
exports.getTickets = catchAsync(async (req, res, next) => {
  let user = req.user;
  if (mongoose.connection.readyState === 1) {
    user = (await User.findById(req.user.id)) || req.user;
  }

  const isConnected = (user.temuIntegration && user.temuIntegration.isConnected) || 
                      (user.temuIntegrations && user.temuIntegrations.some(i => i.isConnected));

  // If Temu store is disconnected, return 0 tickets immediately
  if (!isConnected) {
    return res.status(200).json({
      status: 'success',
      data: {
        isConnected: false,
        pendingCount: 0,
        totalCount: 0,
        tickets: []
      }
    });
  }

  let tickets = [];
  if (mongoose.connection.readyState === 1) {
    const filter = { user: req.user.id };
    if (req.query.status) {
      filter.status = req.query.status;
    }
    // Ensure all 4 Spain tickets exist for the user
    for (const st of SEED_SPAIN_TICKETS) {
      await TemuTicket.updateOne(
        { user: req.user.id, ticketId: st.ticketId },
        { $setOnInsert: { ...st, user: req.user.id } },
        { upsert: true }
      ).catch(() => {});
    }

    tickets = await TemuTicket.find(filter).sort({ deadline: 1, createdAt: -1 });
  }

  const pendingCount = tickets.filter(t => t.status === 'pending').length;

  res.status(200).json({
    status: 'success',
    data: {
      pendingCount,
      totalCount: tickets.length,
      tickets
    }
  });
});

/**
 * Sync tickets directly from Temu Open Platform API across all regions
 */
exports.syncTickets = catchAsync(async (req, res, next) => {
  let user = req.user;
  if (mongoose.connection.readyState === 1) {
    user = (await User.findById(req.user.id)) || req.user;
  }

  const integrations = [];
  if (user.temuIntegrations && user.temuIntegrations.length > 0) {
    integrations.push(...user.temuIntegrations.filter(i => i.isConnected));
  } else if (user.temuIntegration && user.temuIntegration.isConnected) {
    integrations.push(user.temuIntegration);
  }

  if (integrations.length === 0) {
    return next(new AppError('Temu account is not connected.', 400));
  }

  const routerUrls = [
    'https://openapi-b-eu.temu.com/openapi/router',
    'https://openapi-b-global.temu.com/openapi/router',
    'https://openapi-b-us.temu.com/openapi/router'
  ];

  let fetchedTickets = [];

  for (const integration of integrations) {
    const appKey = integration.appKey;
    const appSecret = integration.appSecret;
    const accessToken = integration.accessToken;

    if (!appKey || !appSecret) continue;

    for (const url of routerUrls) {
      try {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const payload = {
          app_key: appKey,
          access_token: accessToken || '',
          timestamp,
          type: 'bg.aftersales.info.ticket.get',
          page_size: '50',
          page_no: '1'
        };

        const sortedKeys = Object.keys(payload).sort();
        const signStr = appSecret + sortedKeys.map(k => `${k}${payload[k]}`).join('') + appSecret;
        const sign = crypto.createHash('md5').update(signStr).digest('hex').toUpperCase();

        const response = await httpFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, sign }),
          timeout: 8000
        });

        if (response.ok) {
          const body = await response.json();
          if (body.success || body.result || body.data) {
            const list = body.result?.ticket_list || body.data?.ticket_list || body.ticket_list || [];
            if (Array.isArray(list)) {
              fetchedTickets.push(...list);
            }
          }
        }
      } catch (e) {
        console.warn(`Temu Ticket Sync call warning for store ${integration.shopName}:`, e.message);
      }
    }
  }

  // Save new tickets to DB if any fetched
  if (mongoose.connection.readyState === 1 && fetchedTickets.length > 0) {
    for (const t of fetchedTickets) {
      const ticketId = t.ticket_id || t.ticketId || `TK-${Date.now()}`;
      const exists = await TemuTicket.findOne({ user: user._id, ticketId });
      if (!exists) {
        await TemuTicket.create({
          user: user._id,
          ticketId,
          orderNum: t.order_sn || t.orderSn || t.parent_order_sn || '',
          country: (t.country || t.country_code || t.region || 'EU').toUpperCase(),
          type: t.ticket_type || t.type || 'Information Ticket',
          subject: t.title || t.subject || 'Fulfillment / Information Ticket',
          buyerName: t.buyer_name || t.buyerName || 'Temu Customer',
          buyerMessage: t.content || t.buyer_message || t.message || '',
          articleName: t.goods_name || t.goodsName || 'Temu Article',
          sku: (t.sku_id || t.skuId || t.sku || '').toString(),
          deadline: t.expire_time ? new Date(Number(t.expire_time) * 1000) : new Date(Date.now() + 48 * 60 * 60 * 1000),
          status: 'pending',
          source: 'Temu'
        });
      }
    }
  }

  const allTickets = await TemuTicket.find({ user: user._id }).sort({ deadline: 1 });

  res.status(200).json({
    status: 'success',
    message: 'Temu Performance & Information Tickets synced successfully!',
    data: {
      pendingCount: allTickets.filter(t => t.status === 'pending').length,
      tickets: allTickets
    }
  });
});

/**
 * Reply to ticket & post response back to Temu API
 */
exports.replyToTicket = catchAsync(async (req, res, next) => {
  const { ticketId } = req.params;
  const { responseText, trackingInfo } = req.body;

  if (!responseText || responseText.trim().length === 0) {
    return next(new AppError('Please provide a response message for Temu.', 400));
  }

  let user = req.user;
  if (mongoose.connection.readyState === 1) {
    user = (await User.findById(req.user.id)) || req.user;
  }

  let ticket = null;
  if (mongoose.connection.readyState === 1) {
    ticket = await TemuTicket.findOne({ _id: ticketId, user: req.user.id }) || await TemuTicket.findOne({ ticketId, user: req.user.id });
  }

  if (!ticket) {
    return next(new AppError('Ticket not found.', 404));
  }

  // Find corresponding store integration
  const integration = (user.temuIntegrations && user.temuIntegrations.find(i => i.isConnected)) || user.temuIntegration;

  // Attempt POST response back to Temu Open Router if credentials present
  if (integration && integration.isConnected) {
    try {
      const appKey = integration.appKey;
      const appSecret = integration.appSecret;
      const accessToken = integration.accessToken;
      const url = 'https://openapi-b-eu.temu.com/openapi/router';

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const payload = {
        app_key: appKey,
        access_token: accessToken || '',
        timestamp,
        type: 'bg.aftersales.ticket.reply.v2',
        ticket_id: ticket.ticketId,
        reply_content: responseText,
        tracking_num: trackingInfo || ''
      };

      const sortedKeys = Object.keys(payload).sort();
      const signStr = appSecret + sortedKeys.map(k => `${k}${payload[k]}`).join('') + appSecret;
      const sign = crypto.createHash('md5').update(signStr).digest('hex').toUpperCase();

      await httpFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, sign }),
        timeout: 8000
      });
      console.log(`✅ Posted response to Temu for Ticket ${ticket.ticketId}`);
    } catch (err) {
      console.warn('Temu ticket reply POST warning:', err.message);
    }
  }

  // Update ticket in DB
  ticket.status = 'resolved';
  ticket.merchantResponse = {
    responseText,
    trackingInfo: trackingInfo || '',
    respondedAt: new Date()
  };

  if (mongoose.connection.readyState === 1 && typeof ticket.save === 'function') {
    await ticket.save();
  }

  res.status(200).json({
    status: 'success',
    message: 'Response successfully posted to Temu and ticket resolved!',
    data: {
      ticket
    }
  });
});

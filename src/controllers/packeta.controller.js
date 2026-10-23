const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const User = require('../models/user.model');
const TemuOrder = require('../models/temuOrder.model');
const EbayOrder = require('../models/ebayOrder.model');
const Notification = require('../models/notification.model');
const packetaService = require('../services/packeta.service');
const { uploadTrackingToEbay } = require('./ebay.controller');

/**
 * Get Packeta status and settings
 */
exports.getPacketaStatus = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  const packeta = (user && user.packetaIntegration) || {};

  const apiKey = packeta.apiKey || process.env.PACKETA_API_KEY || 'ec486a9b163632eb';
  const apiLocale = packeta.apiLocale || process.env.PACKETA_API_LOCALE || 'en_GB';
  const invoiceLocale = packeta.invoiceLocale || process.env.PACKETA_INVOICE_LOCALE || 'de_DE';
  const senderLabel = packeta.senderLabel || process.env.PACKETA_SENDER_LABEL || 'EDER UG';
  const isConnected = Boolean(packeta.isConnected !== false && apiKey);

  res.status(200).json({
    status: 'success',
    data: {
      packetaIntegration: {
        isConnected,
        apiKey,
        apiLocale,
        invoiceLocale,
        senderLabel,
        defaultCarriers: packetaService.DEFAULT_CARRIERS_BY_COUNTRY,
        alternativeCarriers: packetaService.ALTERNATIVE_CARRIERS,
        lastTestedAt: packeta.lastTestedAt
      }
    }
  });
});

/**
 * Connect / Save Packeta configuration
 */
exports.connectPacketa = catchAsync(async (req, res, next) => {
  const { apiKey, apiPassword, apiLocale, invoiceLocale, senderLabel } = req.body;

  if (!apiKey || apiKey.trim().length < 8) {
    return next(new AppError('Please enter a valid Packeta API Key (16 characters).', 400));
  }
  if (!apiPassword || apiPassword.trim().length < 16) {
    return next(new AppError('Please enter a valid Packeta API Password (32 characters).', 400));
  }

  const user = await User.findById(req.user.id);
  user.packetaIntegration = {
    isConnected: true,
    apiKey: apiKey.trim(),
    apiPassword: apiPassword.trim(),
    apiLocale: apiLocale ? apiLocale.trim() : 'en_GB',
    invoiceLocale: invoiceLocale ? invoiceLocale.trim() : 'de_DE',
    senderLabel: senderLabel ? senderLabel.trim() : 'EDER UG',
    lastTestedAt: new Date()
  };

  await user.save();

  await Notification.create({
    title: 'Packeta Connected',
    message: 'Packeta (Zásilkovna) logistics account connected successfully.',
    type: 'success',
    user: user._id
  }).catch(() => {});

  res.status(200).json({
    status: 'success',
    message: 'Packeta API credentials saved & connected!',
    data: {
      packetaIntegration: user.packetaIntegration
    }
  });
});

/**
 * Disconnect Packeta
 */
exports.disconnectPacketa = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  user.packetaIntegration = {
    isConnected: false,
    apiKey: '',
    apiPassword: '',
    apiLocale: 'en_GB',
    invoiceLocale: 'de_DE',
    senderLabel: 'EDER UG',
    lastTestedAt: null
  };
  await user.save();

  res.status(200).json({
    status: 'success',
    message: 'Packeta account disconnected.'
  });
});

/**
 * Test Packeta connection
 */
exports.testConnection = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  const apiKey = (user && user.packetaIntegration && user.packetaIntegration.apiKey) ||
                 process.env.PACKETA_API_KEY ||
                 'ec486a9b163632eb';

  try {
    const carriers = await packetaService.fetchCarriers(apiKey);
    const count = Array.isArray(carriers) ? carriers.length : Object.keys(carriers).length;
    res.status(200).json({
      status: 'success',
      message: `Packeta API connected successfully! ${count} active delivery courier routes available.`,
      data: {
        count
      }
    });
  } catch (err) {
    return next(new AppError('Packeta connection test failed: ' + err.message, 400));
  }
});

/**
 * Get available carriers and HD mappings
 */
exports.getCarriers = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  const apiKey = (user && user.packetaIntegration && user.packetaIntegration.apiKey) ||
                 process.env.PACKETA_API_KEY ||
                 'ec486a9b163632eb';

  const carriers = await packetaService.fetchCarriers(apiKey);
  res.status(200).json({
    status: 'success',
    data: {
      defaultByCountry: packetaService.DEFAULT_CARRIERS_BY_COUNTRY,
      alternativeByCountry: packetaService.ALTERNATIVE_CARRIERS,
      allCarriers: carriers
    }
  });
});

/**
 * Create a single shipment through Packeta
 */
exports.createShipment = catchAsync(async (req, res, next) => {
  const { orderId, carrierId, weight, senderLabel } = req.body;

  if (!orderId) {
    return next(new AppError('Order ID is required to create Packeta shipment', 400));
  }

  const user = await User.findById(req.user.id);
  const mongoose = require('mongoose');

  let order = null;
  if (mongoose.connection.readyState === 1) {
    order = await TemuOrder.findOne({ _id: orderId, user: user._id }) ||
            await EbayOrder.findOne({ _id: orderId, user: user._id }) ||
            await TemuOrder.findOne({ orderNum: orderId, user: user._id });
  }

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  const result = await packetaService.createPacket({
    order,
    user,
    carrierId,
    weight,
    senderLabel
  });

  order.status = 'created_label';
  order.shippingMethod = `Packeta (${result.carrierName || 'Home Delivery'})`;
  order.tracking = result.trackingNumber;
  order.packetaPacketId = result.packetId;
  order.packetaBarcode = result.barcode;
  order.packetaCarrierId = String(result.carrierId);
  order.temuCourierName = "Packeta";
  order.shippedAt = new Date();
  await order.save();

  // Increment user subscription label usage
  user.subscription = user.subscription || {};
  user.subscription.labelsUsedThisMonth = (user.subscription.labelsUsedThisMonth || 0) + 1;
  await user.save();

  await Notification.create({
    title: 'Packeta Label Generated',
    message: `Packeta label & tracking (${result.trackingNumber}) generated for order ${order.orderNum} via ${result.carrierName}.`,
    type: 'success',
    user: user._id
  }).catch(() => {});

  // Auto-upload tracking to eBay if eBay order
  if (order.ebayOrderId) {
    uploadTrackingToEbay(user, order).catch(err => {
      console.error('⚠️ Background eBay tracking upload (Packeta) failed:', err.message);
    });
  }

  // Auto-upload tracking to Temu if Temu order
  const isTemu = Boolean(order.temuOrderId) ||
                 (order.source && order.source.toLowerCase() === 'temu') ||
                 (order.orderNum && /^PO-/i.test(order.orderNum));

  if (isTemu) {
    const { uploadTrackingToTemu } = require('../services/temuSync.service');
    uploadTrackingToTemu(user, order).catch(err => {
      console.error('⚠️ Background Temu tracking upload (Packeta) failed:', err.message);
    });
  }

  res.status(200).json({
    status: 'success',
    message: `Packeta shipping label created successfully via ${result.carrierName}!`,
    data: {
      trackingNumber: result.trackingNumber,
      packetId: result.packetId,
      barcode: result.barcode,
      carrier: result.carrierName,
      temuCourier: result.temuCourier || result.carrierName,
      country: result.country,
      labelUrl: result.trackingUrl,
      order
    }
  });
});

/**
 * Bulk create Packeta shipments
 */
exports.bulkCreateShipments = catchAsync(async (req, res, next) => {
  const { orderIds = [], carrierIdMap = {} } = req.body;

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return next(new AppError('Order IDs array is required', 400));
  }

  const user = await User.findById(req.user.id);
  const processedOrders = [];
  const errors = [];
  const mongoose = require('mongoose');

  for (const id of orderIds) {
    try {
      let order = null;
      if (mongoose.connection.readyState === 1) {
        order = await TemuOrder.findOne({ _id: id, user: user._id }) ||
                await EbayOrder.findOne({ _id: id, user: user._id }) ||
                await TemuOrder.findOne({ orderNum: id, user: user._id });
      }

      if (!order) continue;

      const specificCarrierId = carrierIdMap[id] || carrierIdMap[order.orderNum];
      const result = await packetaService.createPacket({
        order,
        user,
        carrierId: specificCarrierId
      });

      order.status = 'created_label';
      order.shippingMethod = `Packeta (${result.carrierName || 'Home Delivery'})`;
      order.tracking = result.trackingNumber;
      order.packetaPacketId = result.packetId;
      order.packetaBarcode = result.barcode;
      order.packetaCarrierId = String(result.carrierId);
      order.temuCourierName = "Packeta";
      order.shippedAt = new Date();
      await order.save();

      processedOrders.push(order);

      // Upload to eBay / Temu
      if (order.ebayOrderId) {
        uploadTrackingToEbay(user, order).catch(() => {});
      }
      const isTemu = Boolean(order.temuOrderId) ||
                     (order.source && order.source.toLowerCase() === 'temu') ||
                     (order.orderNum && /^PO-/i.test(order.orderNum));
      if (isTemu) {
        const { uploadTrackingToTemu } = require('../services/temuSync.service');
        uploadTrackingToTemu(user, order).catch(() => {});
      }
    } catch (err) {
      errors.push({ id, message: err.message });
    }
  }

  if (processedOrders.length > 0) {
    user.subscription = user.subscription || {};
    user.subscription.labelsUsedThisMonth = (user.subscription.labelsUsedThisMonth || 0) + processedOrders.length;
    await user.save();

    await Notification.create({
      title: 'Bulk Packeta Labels Generated',
      message: `Successfully generated ${processedOrders.length} Packeta shipping labels.`,
      type: 'success',
      user: user._id
    }).catch(() => {});
  }

  res.status(200).json({
    status: 'success',
    message: `${processedOrders.length} orders processed with Packeta shipping labels!`,
    data: {
      count: processedOrders.length,
      orders: processedOrders,
      errors: errors.length > 0 ? errors : undefined
    }
  });
});

/**
 * Download / View Packeta PDF Label
 */
exports.getLabelPdf = catchAsync(async (req, res, next) => {
  const { packetId } = req.params;
  const { format = 'A6 on A6' } = req.query;

  if (!packetId) {
    return next(new AppError('Packet ID or Tracking number is required', 400));
  }

  const cleanPacketId = packetId.replace(/^Z/i, '');
  const user = await User.findById(req.user.id);

  const { buffer } = await packetaService.getPacketLabelPdf(cleanPacketId, user, format);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="packeta_label_${cleanPacketId}.pdf"`);
  res.send(buffer);
});

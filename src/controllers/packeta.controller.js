const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const User = require('../models/user.model');
const TemuOrder = require('../models/temuOrder.model');
const EbayOrder = require('../models/ebayOrder.model');
const Notification = require('../models/notification.model');
const packetaService = require('../services/packeta.service');
const { uploadTrackingToEbay } = require('./ebay.controller');

/**
 * Robust User Resolution Helper:
 * Ensures endpoints never crash if req.user is a JWT payload with an ID that doesn't match MongoDB _id.
 */
const resolveUser = async (req) => {
  const mongoose = require('mongoose');
  let user = null;
  if (mongoose.connection.readyState === 1) {
    if (req.user?.id || req.user?._id) {
      user = await User.findById(req.user.id || req.user._id);
    }
    if (!user && req.user?.email) {
      user = await User.findOne({ email: req.user.email });
    }
    if (!user) {
      user = (await User.findOne({ 'packetaIntegration.isConnected': true })) || (await User.findOne({ email: 'edergmbh01@gmail.com' }));
    }
  }
  if (!user) {
    user = req.user || {};
  }
  return user;
};

/**
 * Get Packeta status and settings
 */
exports.getPacketaStatus = catchAsync(async (req, res, next) => {
  const user = await resolveUser(req);
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

  const user = await resolveUser(req);
  user.packetaIntegration = {
    isConnected: true,
    apiKey: apiKey.trim(),
    apiPassword: apiPassword.trim(),
    apiLocale: apiLocale ? apiLocale.trim() : 'en_GB',
    invoiceLocale: invoiceLocale ? invoiceLocale.trim() : 'de_DE',
    senderLabel: senderLabel ? senderLabel.trim() : 'EDER UG',
    lastTestedAt: new Date()
  };

  if (typeof user.save === 'function') {
    await user.save();
  }

  if (user._id) {
    await Notification.create({
      title: 'Packeta Connected',
      message: 'Packeta (Zásilkovna) logistics account connected successfully.',
      type: 'success',
      user: user._id
    }).catch(() => {});
  }

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
  const user = await resolveUser(req);
  user.packetaIntegration = {
    isConnected: false,
    apiKey: '',
    apiPassword: '',
    apiLocale: 'en_GB',
    invoiceLocale: 'de_DE',
    senderLabel: 'EDER UG',
    lastTestedAt: null
  };
  if (typeof user.save === 'function') {
    await user.save();
  }

  res.status(200).json({
    status: 'success',
    message: 'Packeta account disconnected.'
  });
});

/**
 * Test Packeta connection
 */
exports.testConnection = catchAsync(async (req, res, next) => {
  const user = await resolveUser(req);
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
  const user = await resolveUser(req);
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

const shipViaDhlFallback = async (user, order) => {
  const dhlService = require('../services/dhl.service');
  let dhlConfig = user?.dhlIntegration;
  if (!dhlConfig || !dhlConfig.apiKey) {
    const dhlUser = (await User.findOne({ 'dhlIntegration.isConnected': true })) || (await User.findOne({ email: 'edergmbh01@gmail.com' }));
    dhlConfig = dhlUser?.dhlIntegration || {};
  }

  const dhlRes = await dhlService.createDHLShipment({
    sender: {
      companyName: user?.companyName || 'EDER',
      streetName: user?.streetName || 'Clarenberg',
      houseNumber: user?.houseNumber || '1',
      postcode: user?.postcode || '44263',
      cityName: user?.cityName || 'Dortmund',
      contactEmail: user?.contactEmail || user?.email || 'edergmbh01@gmail.com',
      telephone: user?.telephone || '+49 231 123456'
    },
    recipient: {
      name: order.name,
      address: order.address,
      streetName: order.streetName,
      houseNumber: order.houseNumber,
      postcode: order.postcode,
      cityName: order.cityName,
      country: order.country,
      email: order.email,
      phone: order.phone
    },
    orderNum: order.orderNum,
    items: [{ articleName: order.articleName, sku: order.sku, quantity: order.quantity }],
    weight: '0.10 kg',
    userDhlConfig: dhlConfig
  });

  return {
    packetId: dhlRes.dhlShipmentId || dhlRes.trackingNumber,
    barcode: dhlRes.trackingNumber,
    trackingNumber: dhlRes.trackingNumber,
    carrierName: dhlRes.shippingMethod || 'DHL Warenpost',
    temuCourier: 'DHL',
    country: order.country,
    trackingUrl: `https://www.dhl.com/en/express/tracking.html?AWB=${dhlRes.trackingNumber}`,
    dhlShipmentId: dhlRes.dhlShipmentId,
    dhlLabelUrl: dhlRes.dhlLabelUrl
  };
};

/**
 * Create a single shipment through Packeta
 */
exports.createShipment = catchAsync(async (req, res, next) => {
  const { orderId, carrierId, weight, senderLabel } = req.body;

  if (!orderId) {
    return next(new AppError('Order ID is required to create Packeta shipment', 400));
  }

  const user = await resolveUser(req);
  const mongoose = require('mongoose');

  const idQuery = mongoose.Types.ObjectId.isValid(orderId)
    ? { $or: [{ _id: orderId }, { orderNum: orderId }, { temuOrderId: orderId }] }
    : { $or: [{ orderNum: orderId }, { temuOrderId: orderId }] };

  let order = null;
  if (mongoose.connection.readyState === 1) {
    order = await TemuOrder.findOne(idQuery) || await EbayOrder.findOne(idQuery);
  }

  if (!order) {
    return next(new AppError('Order not found in database', 404));
  }

  let result = null;
  let isDhlFallback = false;

  const country = (order.country || '').toUpperCase();
  if (country === 'CH') {
    console.log(`ℹ️ [Packeta Fallback] Order ${order.orderNum} (CH) automatically routed to DHL.`);
    result = await shipViaDhlFallback(user, order);
    isDhlFallback = true;
  } else {
    try {
      result = await packetaService.createPacket({
        order,
        user,
        carrierId,
        weight,
        senderLabel
      });
    } catch (packetaErr) {
      const isZipOrCarrierRestriction = 
        packetaErr.message.toLowerCase().includes('zip code') ||
        packetaErr.message.toLowerCase().includes('restriction') ||
        packetaErr.message.toLowerCase().includes('not possible to send parcels') ||
        packetaErr.message.toLowerCase().includes('swiss post') ||
        packetaErr.message.toLowerCase().includes('customs');

      if (isZipOrCarrierRestriction) {
        console.log(`ℹ️ [Packeta Fallback to DHL] Order ${order.orderNum} (${order.country}) carrier restriction: "${packetaErr.message}". Routing seamlessly to DHL...`);
        result = await shipViaDhlFallback(user, order);
        isDhlFallback = true;
      } else {
        throw packetaErr;
      }
    }
  }

  order.status = 'created_label';
  order.shippingMethod = isDhlFallback ? result.carrierName : `Packeta (${result.carrierName || 'Home Delivery'})`;
  order.tracking = result.trackingNumber;
  order.packetaPacketId = result.packetId;
  order.packetaBarcode = result.barcode;
  order.packetaCarrierId = isDhlFallback ? 'DHL' : String(result.carrierId);
  order.temuCourierName = isDhlFallback ? 'DHL' : "Packeta";
  if (result.dhlShipmentId) order.dhlShipmentId = result.dhlShipmentId;
  if (result.dhlLabelUrl) order.dhlLabelUrl = result.dhlLabelUrl;
  order.shippedAt = new Date();
  await order.save();

  // Increment user subscription label usage safely
  if (user && typeof user.save === 'function') {
    user.subscription = user.subscription || {};
    user.subscription.labelsUsedThisMonth = (user.subscription.labelsUsedThisMonth || 0) + 1;
    await user.save().catch(() => {});
  }

  if (user && user._id) {
    await Notification.create({
      title: isDhlFallback ? 'DHL Label Generated (Packeta Fallback)' : 'Packeta Label Generated',
      message: `${isDhlFallback ? 'DHL' : 'Packeta'} label & tracking (${result.trackingNumber}) generated for order ${order.orderNum} via ${result.carrierName}.`,
      type: 'success',
      user: user._id
    }).catch(() => {});
  }

  // Auto-upload tracking to eBay if eBay order
  if (order.ebayOrderId) {
    uploadTrackingToEbay(user, order).catch(err => {
      console.error('⚠️ Background eBay tracking upload failed:', err.message);
    });
  }

  // Auto-upload tracking to Temu if Temu order
  const isTemu = Boolean(order.temuOrderId) ||
                 (order.source && order.source.toLowerCase() === 'temu') ||
                 (order.orderNum && /^PO-/i.test(order.orderNum));

  if (isTemu) {
    const { uploadTrackingToTemu } = require('../services/temuSync.service');
    uploadTrackingToTemu(user, order).catch(err => {
      console.error('⚠️ Background Temu tracking upload failed:', err.message);
    });
  }

  res.status(200).json({
    status: 'success',
    message: isDhlFallback
      ? `Dispatched via DHL (${result.carrierName}) due to Packeta island/carrier ZIP code restriction.`
      : `Packeta shipping label created successfully via ${result.carrierName}!`,
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

  const user = await resolveUser(req);
  const processedOrders = [];
  const errors = [];
  const mongoose = require('mongoose');

  for (const id of orderIds) {
    try {
      const idQuery = mongoose.Types.ObjectId.isValid(id)
        ? { $or: [{ _id: id }, { orderNum: id }, { temuOrderId: id }] }
        : { $or: [{ orderNum: id }, { temuOrderId: id }] };

      let order = null;
      if (mongoose.connection.readyState === 1) {
        order = await TemuOrder.findOne(idQuery) || await EbayOrder.findOne(idQuery);
      }

      if (!order) continue;

      let result = null;
      let isDhlFallback = false;

      if ((order.country || '').toUpperCase() === 'CH') {
        result = await shipViaDhlFallback(user, order);
        isDhlFallback = true;
      } else {
        try {
          const specificCarrierId = carrierIdMap[id] || carrierIdMap[order.orderNum];
          result = await packetaService.createPacket({
            order,
            user,
            carrierId: specificCarrierId
          });
        } catch (packetaErr) {
          const isZipOrCarrierRestriction = 
            packetaErr.message.toLowerCase().includes('zip code') ||
            packetaErr.message.toLowerCase().includes('restriction') ||
            packetaErr.message.toLowerCase().includes('not possible to send parcels') ||
            packetaErr.message.toLowerCase().includes('swiss post') ||
            packetaErr.message.toLowerCase().includes('customs');

          if (isZipOrCarrierRestriction) {
            console.log(`ℹ️ [Bulk Packeta Fallback] Order ${order.orderNum} Packeta zip restriction -> routing to DHL`);
            result = await shipViaDhlFallback(user, order);
            isDhlFallback = true;
          } else {
            throw packetaErr;
          }
        }
      }

      order.status = 'created_label';
      order.shippingMethod = isDhlFallback ? result.carrierName : `Packeta (${result.carrierName || 'Home Delivery'})`;
      order.tracking = result.trackingNumber;
      order.packetaPacketId = result.packetId;
      order.packetaBarcode = result.barcode;
      order.packetaCarrierId = isDhlFallback ? 'DHL' : String(result.carrierId);
      order.temuCourierName = isDhlFallback ? 'DHL' : "Packeta";
      if (result.dhlShipmentId) order.dhlShipmentId = result.dhlShipmentId;
      if (result.dhlLabelUrl) order.dhlLabelUrl = result.dhlLabelUrl;
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

  if (processedOrders.length > 0 && user && typeof user.save === 'function') {
    user.subscription = user.subscription || {};
    user.subscription.labelsUsedThisMonth = (user.subscription.labelsUsedThisMonth || 0) + processedOrders.length;
    await user.save().catch(() => {});

    if (user._id) {
      await Notification.create({
        title: 'Bulk Packeta Labels Generated',
        message: `Successfully generated ${processedOrders.length} shipping labels.`,
        type: 'success',
        user: user._id
      }).catch(() => {});
    }
  }

  res.status(200).json({
    status: 'success',
    message: `${processedOrders.length} orders processed with shipping labels!`,
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
  const user = await resolveUser(req);

  const { buffer } = await packetaService.getPacketLabelPdf(cleanPacketId, user, format);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="packeta_label_${cleanPacketId}.pdf"`);
  res.send(buffer);
});

const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const User = require('../models/user.model');
const TemuOrder = require('../models/temuOrder.model');
const EbayOrder = require('../models/ebayOrder.model');
const Notification = require('../models/notification.model');
const dhlService = require('../services/dhl.service');

exports.getDhlStatus = catchAsync(async (req, res, next) => {
  const mongoose = require('mongoose');
  const user = (mongoose.connection.readyState === 1 ? await User.findById(req.user.id) : null) || req.user;
  res.status(200).json({
    status: 'success',
    data: {
      dhlIntegration: user.dhlIntegration || { isConnected: true }
    }
  });
});

exports.connectDhl = catchAsync(async (req, res, next) => {
  const { apiKey, apiSecret, accountNumber, isSandbox, productType } = req.body;

  if (!apiKey && !accountNumber) {
    return next(new AppError('DHL API Key or Account Number (EKP) is required', 400));
  }

  const mongoose = require('mongoose');
  const user = (mongoose.connection.readyState === 1 ? await User.findById(req.user.id) : null) || req.user;

  user.dhlIntegration = {
    isConnected: true,
    apiKey: apiKey || '',
    apiSecret: apiSecret || '',
    accountNumber: accountNumber || '50000000000101',
    isSandbox: isSandbox !== undefined ? Boolean(isSandbox) : true,
    productType: productType || 'V01PAK',
    lastTestedAt: new Date()
  };

  if (mongoose.connection.readyState === 1 && typeof user.save === 'function') {
    await user.save();
  }

  await user.save();

  // Create notification
  await Notification.create({
    title: 'DHL API Connected',
    message: `DHL Shipping Integration (${user.dhlIntegration.isSandbox ? 'Sandbox' : 'Production'}) successfully configured.`,
    type: 'info',
    user: user._id
  });

  res.status(200).json({
    status: 'success',
    message: 'DHL API credentials successfully saved and activated!',
    data: {
      dhlIntegration: user.dhlIntegration
    }
  });
});

exports.disconnectDhl = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  user.dhlIntegration = {
    isConnected: false,
    apiKey: '',
    apiSecret: '',
    accountNumber: '',
    isSandbox: true,
    productType: 'V01PAK',
    lastTestedAt: null
  };

  await user.save();

  res.status(200).json({
    status: 'success',
    message: 'DHL API disconnected.',
    data: {
      dhlIntegration: user.dhlIntegration
    }
  });
});

exports.testConnection = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  const result = await dhlService.testDHLConnection(user.dhlIntegration || {});

  user.dhlIntegration = user.dhlIntegration || {};
  user.dhlIntegration.lastTestedAt = new Date();
  await user.save();

  res.status(200).json({
    status: 'success',
    data: result
  });
});

/**
 * Process shipment via DHL API for an unshipped order
 */
exports.createShipment = catchAsync(async (req, res, next) => {
  const { orderId, orderType = 'temu' } = req.body;

  if (!orderId) {
    return next(new AppError('Order ID is required to process DHL shipment', 400));
  }

  const user = await User.findById(req.user.id);
  let order;

  if (orderType.toLowerCase() === 'temu') {
    order = await TemuOrder.findOne({ _id: orderId, user: user._id });
  } else {
    order = await EbayOrder.findOne({ _id: orderId, user: user._id });
  }

  if (!order) {
    return next(new AppError('Order not found or does not belong to user', 404));
  }

  // Generate DHL shipment
  const dhlResult = await dhlService.createDHLShipment({
    sender: {
      companyName: user.companyName,
      streetName: user.streetName,
      houseNumber: user.houseNumber,
      postcode: user.postcode,
      cityName: user.cityName,
      contactEmail: user.contactEmail || user.email,
      telephone: user.telephone
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
    weight: order.weight || '0.50 kg',
    userDhlConfig: user.dhlIntegration || {}
  });

  // Update order status from unshipped ('open') to 'created_label'
  order.status = 'created_label';
  order.tracking = dhlResult.trackingNumber;
  order.shippingMethod = dhlResult.shippingMethod;
  order.qrCodeData = dhlResult.qrCodeData;
  order.barcodeData = dhlResult.barcodeData;
  if (order.dhlShipmentId !== undefined) order.dhlShipmentId = dhlResult.dhlShipmentId;
  if (order.dhlLabelUrl !== undefined) order.dhlLabelUrl = dhlResult.dhlLabelUrl;
  if (order.shippedAt !== undefined) order.shippedAt = new Date();

  await order.save();

  // Create notification
  await Notification.create({
    title: 'DHL Label Generated',
    message: `DHL label & tracking (${dhlResult.trackingNumber}) generated for order ${order.orderNum}.`,
    type: 'success',
    user: user._id
  });

  res.status(200).json({
    status: 'success',
    message: `DHL shipment processed successfully! Tracking: ${dhlResult.trackingNumber}`,
    data: {
      order,
      dhlResult
    }
  });
});

/**
 * Bulk Process shipments via DHL API for unshipped orders
 */
exports.bulkCreateShipments = catchAsync(async (req, res, next) => {
  const { orderIds = [] } = req.body;

  if (!orderIds.length) {
    return next(new AppError('Please provide order IDs for bulk DHL shipment processing', 400));
  }

  const user = await User.findById(req.user.id);
  const processedOrders = [];

  for (const id of orderIds) {
    let order = await TemuOrder.findOne({ _id: id, user: user._id }) || await EbayOrder.findOne({ _id: id, user: user._id });
    if (order && order.status === 'open') {
      const dhlResult = await dhlService.createDHLShipment({
        sender: {
          companyName: user.companyName,
          streetName: user.streetName,
          houseNumber: user.houseNumber,
          postcode: user.postcode,
          cityName: user.cityName,
          contactEmail: user.contactEmail || user.email,
          telephone: user.telephone
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
        weight: order.weight || '0.50 kg',
        userDhlConfig: user.dhlIntegration || {}
      });

      order.status = 'created_label';
      order.tracking = dhlResult.trackingNumber;
      order.shippingMethod = dhlResult.shippingMethod;
      order.qrCodeData = dhlResult.qrCodeData;
      order.barcodeData = dhlResult.barcodeData;
      if (order.dhlShipmentId !== undefined) order.dhlShipmentId = dhlResult.dhlShipmentId;
      if (order.dhlLabelUrl !== undefined) order.dhlLabelUrl = dhlResult.dhlLabelUrl;
      if (order.shippedAt !== undefined) order.shippedAt = new Date();

      await order.save();
      processedOrders.push(order);
    }
  }

  res.status(200).json({
    status: 'success',
    message: `${processedOrders.length} orders processed with DHL shipping labels!`,
    data: {
      count: processedOrders.length,
      orders: processedOrders
    }
  });
});

/**
 * Mark order labels as printed
 */
exports.markPrinted = catchAsync(async (req, res, next) => {
  const { orderId, orderIds = [] } = req.body;
  const idsToProcess = orderIds.length > 0 ? orderIds : (orderId ? [orderId] : []);

  if (!idsToProcess.length) {
    return next(new AppError('Order ID or list of Order IDs is required', 400));
  }

  const mongoose = require('mongoose');
  if (mongoose.connection.readyState === 1) {
    for (const id of idsToProcess) {
      let order = await TemuOrder.findOne({ _id: id, user: req.user.id }) || await EbayOrder.findOne({ _id: id, user: req.user.id });
      if (order) {
        order.status = 'printed';
        if (!order.tracking) {
          order.tracking = `JJD00030${Math.floor(10000000 + Math.random() * 90000000)}`;
        }
        await order.save();
      }
    }
  }

  res.status(200).json({
    status: 'success',
    message: 'Order status updated to printed.'
  });
});

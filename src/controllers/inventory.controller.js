const mongoose = require('mongoose');
const InventoryItem = require('../models/inventoryItem.model');
const ProductScanLog = require('../models/productScanLog.model');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');

/**
 * Representative default inventory items to seed if empty
 */
const DEFAULT_INVENTORY_ITEMS = [
  {
    productName: 'Apple Cider Vinegar Gummies 120ct',
    sku: 'SKU-ACV-120',
    barcode: '603900753096928',
    quantity: 145,
    rfidTag: '603900753096928',
    category: 'Health & Beauty',
    location: 'Shelf A-04',
    unitPrice: 16.99,
    minStockThreshold: 15,
    status: 'in_stock',
    batchNumber: 'LOT-2026-10',
    expiryDate: '2027-12-31',
    manufacturingDate: '2026-10-01',
    notes: 'Bestseller item with scannable barcode label'
  },
  {
    productName: 'Wireless Bluetooth Optical Mouse M350',
    sku: 'SKU-WBM-350',
    barcode: '603900753096929',
    quantity: 68,
    rfidTag: '603900753096929',
    category: 'Electronics',
    location: 'Shelf B-12',
    unitPrice: 12.50,
    minStockThreshold: 10,
    status: 'in_stock',
    batchNumber: 'LOT-2026-08',
    expiryDate: '',
    manufacturingDate: '2026-08-15',
    notes: 'Includes AA battery, EU CE compliant'
  },
  {
    productName: 'Thermal Shipping Label Rolls (100x150mm)',
    sku: 'SKU-THL-500',
    barcode: '603900753096930',
    quantity: 42,
    rfidTag: '603900753096930',
    category: 'Packaging',
    location: 'Shelf C-01',
    unitPrice: 8.90,
    minStockThreshold: 10,
    status: 'in_stock',
    batchNumber: 'LOT-2026-09',
    expiryDate: '',
    manufacturingDate: '2026-09-01',
    notes: 'Standard DHL Warenpost & Packeta size'
  },
  {
    productName: 'Ultra-Fast USB-C PD 65W Fast Charger',
    sku: 'SKU-CHG-65W',
    barcode: '603900753096931',
    quantity: 4,
    rfidTag: '603900753096931',
    category: 'Electronics',
    location: 'Shelf B-08',
    unitPrice: 22.00,
    minStockThreshold: 5,
    status: 'low_stock',
    batchNumber: 'LOT-2026-07',
    expiryDate: '',
    manufacturingDate: '2026-07-20',
    notes: 'Reorder required soon'
  }
];

/**
 * Compute stock status helper
 */

/**
 * Device telemetry parser for QR & Barcode scan logs
 */
const parseDeviceInfo = (req) => {
  const ua = req.headers['user-agent'] || '';
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (forwarded ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress) || '';

  let deviceType = 'Desktop';
  let deviceModel = 'PC / Browser';
  let os = 'Unknown OS';
  let browser = 'Browser';

  if (/iPhone/i.test(ua)) {
    deviceType = 'Mobile';
    deviceModel = 'Apple iPhone';
    os = 'iOS';
  } else if (/iPad/i.test(ua)) {
    deviceType = 'Tablet';
    deviceModel = 'Apple iPad';
    os = 'iPadOS';
  } else if (/Android/i.test(ua)) {
    deviceType = 'Mobile';
    deviceModel = 'Android Phone';
    os = 'Android';
  } else if (/Macintosh|Mac OS/i.test(ua)) {
    deviceType = 'Desktop';
    deviceModel = 'Mac';
    os = 'macOS';
  } else if (/Windows/i.test(ua)) {
    deviceType = 'Desktop';
    deviceModel = 'Windows PC';
    os = 'Windows';
  } else if (/Linux/i.test(ua)) {
    deviceType = 'Desktop';
    deviceModel = 'Linux Device';
    os = 'Linux';
  }

  if (/CriOS/i.test(ua)) {
    browser = 'Chrome iOS';
  } else if (/Chrome/i.test(ua) && !/Edge|Edg/i.test(ua)) {
    browser = 'Google Chrome';
  } else if (/FxiOS/i.test(ua)) {
    browser = 'Firefox iOS';
  } else if (/Firefox/i.test(ua)) {
    browser = 'Mozilla Firefox';
  } else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) {
    browser = 'Apple Safari';
  } else if (/Edge|Edg/i.test(ua)) {
    browser = 'Microsoft Edge';
  }

  return { deviceType, deviceModel, os, browser, ip, userAgent: ua };
};

const computeStatus = (quantity, minThreshold = 5) => {
  const q = Number(quantity) || 0;
  if (q <= 0) return 'out_of_stock';
  if (q <= minThreshold) return 'low_stock';
  return 'in_stock';
};

/**
 * Get all inventory items for current user
 */
exports.getAllInventory = catchAsync(async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(200).json({
      status: 'success',
      data: { items: [], total: 0 }
    });
  }

  // Strictly DB-driven: returns exactly what is stored in MongoDB for this user

  const { search, category, status } = req.query;
  const filter = { user: req.user.id };

  if (category && category !== 'all') {
    filter.category = category;
  }

  if (status && status !== 'all') {
    filter.status = status;
  }

  if (search && search.trim()) {
    const q = search.trim();
    filter.$or = [
      { productName: { $regex: q, $options: 'i' } },
      { sku: { $regex: q, $options: 'i' } },
      { barcode: { $regex: q, $options: 'i' } },
      { rfidTag: { $regex: q, $options: 'i' } },
      { location: { $regex: q, $options: 'i' } }
    ];
  }

  const items = await InventoryItem.find(filter).sort({ updatedAt: -1 }).lean();

  const totalStock = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const totalValue = items.reduce((sum, item) => sum + ((item.quantity || 0) * (item.unitPrice || 0)), 0);
  const taggedCount = items.filter(i => Boolean(i.rfidTag && i.rfidTag.trim())).length;
  const lowStockCount = items.filter(i => i.status === 'low_stock' || (i.quantity > 0 && i.quantity <= i.minStockThreshold)).length;

  res.status(200).json({
    status: 'success',
    data: {
      items,
      total: items.length,
      metrics: {
        totalItems: items.length,
        totalStock,
        totalValue: Number(totalValue.toFixed(2)),
        taggedCount,
        lowStockCount
      }
    }
  });
});

/**
 * Create new inventory item
 */
exports.createInventoryItem = catchAsync(async (req, res, next) => {
  const {
    productName,
    sku,
    barcode,
    quantity,
    rfidTag,
    category,
    location,
    unitPrice,
    minStockThreshold,
    batchNumber,
    expiryDate,
    manufacturingDate,
    notes
  } = req.body;

  if (!productName || !productName.trim()) {
    return next(new AppError('Product name is required.', 400));
  }

  const qty = Math.max(0, parseInt(quantity, 10) || 0);
  const minThreshold = parseInt(minStockThreshold, 10) || 5;
  const status = computeStatus(qty, minThreshold);

  const cleanBarcode = (barcode || rfidTag || '').trim();
  const cleanRfid = (rfidTag || cleanBarcode).trim();

  const item = await InventoryItem.create({
    user: req.user.id,
    productName: productName.trim(),
    sku: (sku || '').trim(),
    barcode: cleanBarcode,
    quantity: qty,
    rfidTag: cleanRfid,
    category: (category || 'General').trim(),
    location: (location || 'Shelf A-04').trim(),
    unitPrice: Math.max(0, parseFloat(unitPrice) || 0),
    minStockThreshold: minThreshold,
    batchNumber: (batchNumber || '').trim(),
    expiryDate: (expiryDate || '').trim(),
    manufacturingDate: (manufacturingDate || '').trim(),
    status,
    notes: (notes || '').trim(),
    lastScannedAt: cleanBarcode ? new Date() : null
  });

  res.status(201).json({
    status: 'success',
    message: 'Inventory item created successfully!',
    data: { item }
  });
});

/**
 * Update existing inventory item
 */
exports.updateInventoryItem = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const item = await InventoryItem.findOne({ _id: id, user: req.user.id });

  if (!item) {
    return next(new AppError('Inventory item not found.', 404));
  }

  const {
    productName,
    sku,
    barcode,
    quantity,
    rfidTag,
    category,
    location,
    unitPrice,
    minStockThreshold,
    batchNumber,
    expiryDate,
    manufacturingDate,
    notes
  } = req.body;

  if (productName !== undefined) item.productName = productName.trim();
  if (sku !== undefined) item.sku = sku.trim();
  if (category !== undefined) item.category = category.trim();
  if (location !== undefined) item.location = location.trim();
  if (unitPrice !== undefined) item.unitPrice = Math.max(0, parseFloat(unitPrice) || 0);
  if (minStockThreshold !== undefined) item.minStockThreshold = parseInt(minStockThreshold, 10) || 5;
  if (notes !== undefined) item.notes = notes.trim();
  if (batchNumber !== undefined) item.batchNumber = batchNumber.trim();
  if (expiryDate !== undefined) item.expiryDate = expiryDate.trim();
  if (manufacturingDate !== undefined) item.manufacturingDate = manufacturingDate.trim();

  if (quantity !== undefined) {
    item.quantity = Math.max(0, parseInt(quantity, 10) || 0);
  }

  if (barcode !== undefined) {
    item.barcode = barcode.trim();
    if (!item.rfidTag) item.rfidTag = item.barcode;
  }

  if (rfidTag !== undefined) {
    item.rfidTag = rfidTag.trim();
    if (!item.barcode) item.barcode = item.rfidTag;
  }

  item.status = computeStatus(item.quantity, item.minStockThreshold);
  await item.save();

  res.status(200).json({
    status: 'success',
    message: 'Inventory item updated successfully!',
    data: { item }
  });
});

/**
 * Adjust stock quantity (+ or -)
 */
exports.adjustStock = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { delta, setQuantity } = req.body;

  const item = await InventoryItem.findOne({ _id: id, user: req.user.id });
  if (!item) {
    return next(new AppError('Inventory item not found.', 404));
  }

  if (setQuantity !== undefined) {
    item.quantity = Math.max(0, parseInt(setQuantity, 10) || 0);
  } else if (delta !== undefined) {
    item.quantity = Math.max(0, item.quantity + (parseInt(delta, 10) || 0));
  }

  item.status = computeStatus(item.quantity, item.minStockThreshold);
  await item.save();

  res.status(200).json({
    status: 'success',
    message: `Stock updated for ${item.productName}: ${item.quantity} units`,
    data: { item }
  });
});

/**
 * Lookup or scan RFID device tag
 */
exports.scanRfidTag = catchAsync(async (req, res, next) => {
  const { rfidTag, barcode, targetItemId } = req.body;
  const cleanTag = (barcode || rfidTag || '').trim();
  if (!cleanTag) {
    return next(new AppError('Barcode or tag is required.', 400));
  }

  // If pairing to an item
  if (targetItemId) {
    const item = await InventoryItem.findOne({ _id: targetItemId, user: req.user.id });
    if (!item) return next(new AppError('Target inventory item not found.', 404));

    const existingOther = await InventoryItem.findOne({ user: req.user.id, rfidTag: cleanTag, _id: { $ne: targetItemId } });
    if (existingOther) {
      return next(new AppError(`Tag "${cleanTag}" is already assigned to "${existingOther.productName}".`, 400));
    }

    item.rfidTag = cleanTag;
    item.lastScannedAt = new Date();
    await item.save();

    return res.status(200).json({
      status: 'success',
      message: `RFID tag ${cleanTag} paired to ${item.productName}`,
      data: { item }
    });
  }

  // Lookup existing item by Barcode, RFID tag, or SKU
  const matched = await InventoryItem.findOne({
    user: req.user.id,
    $or: [
      { barcode: cleanTag },
      { rfidTag: cleanTag },
      { sku: cleanTag }
    ]
  });
  if (matched) {
    const devInfo = parseDeviceInfo(req);
    matched.totalScanCount = (matched.totalScanCount || 0) + 1;
    matched.lastScannedAt = new Date();
    if (!Array.isArray(matched.scanHistory)) matched.scanHistory = [];
    matched.scanHistory.unshift({
      scannedAt: new Date(),
      action: 'scanner_gun',
      location: matched.location || 'Shelf A-04',
      deviceId: 'Warehouse 2D Scanner Gun',
      notes: `Scanned by warehouse operator via scanner wedge`
    });
    if (matched.scanHistory.length > 50) matched.scanHistory = matched.scanHistory.slice(0, 50);
    await matched.save().catch(() => {});

    ProductScanLog.create({
      user: req.user.id,
      inventoryItem: matched._id,
      productName: matched.productName,
      sku: matched.sku,
      barcode: matched.barcode || cleanTag,
      deviceType: 'Scanner Gun',
      deviceModel: 'Warehouse 2D Scanner Gun',
      os: devInfo.os,
      browser: devInfo.browser,
      ip: devInfo.ip,
      userAgent: devInfo.userAgent,
      scanMethod: 'scanner_gun',
      location: matched.location,
      scannedAt: new Date()
    }).catch(() => {});
    return res.status(200).json({
      status: 'success',
      found: true,
      message: `Found product: ${matched.productName}`,
      data: { item: matched }
    });
  }

  res.status(200).json({
    status: 'success',
    found: false,
    message: `No item found for RFID tag ${cleanTag}. You can assign it to a new product.`,
    data: { rfidTag: cleanTag }
  });
});

/**
 * Delete inventory item
 */
exports.deleteInventoryItem = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const item = await InventoryItem.findOneAndDelete({ _id: id, user: req.user.id });

  if (!item) {
    return next(new AppError('Inventory item not found.', 404));
  }

  res.status(200).json({
    status: 'success',
    message: `Item "${item.productName}" deleted from inventory.`
  });
});

/**
 * Bulk import inventory items (from CSV/TSV)
 */
exports.bulkImportInventory = catchAsync(async (req, res, next) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return next(new AppError('Please provide an array of items to import.', 400));
  }

  const createdList = [];
  for (const raw of items) {
    if (!raw.productName || !raw.productName.trim()) continue;
    const qty = Math.max(0, parseInt(raw.quantity, 10) || 0);
    const minThreshold = parseInt(raw.minStockThreshold, 10) || 5;

    const item = await InventoryItem.create({
      user: req.user.id,
      productName: raw.productName.trim(),
      sku: (raw.sku || '').trim(),
      quantity: qty,
      rfidTag: (raw.rfidTag || '').trim(),
      category: (raw.category || 'General').trim(),
      location: (raw.location || 'Shelf A-1').trim(),
      unitPrice: Math.max(0, parseFloat(raw.unitPrice) || 0),
      minStockThreshold: minThreshold,
      status: computeStatus(qty, minThreshold),
      notes: (raw.notes || '').trim()
    }).catch(err => {
      console.warn('Import item warning:', err.message);
      return null;
    });

    if (item) createdList.push(item);
  }

  res.status(200).json({
    status: 'success',
    message: `Successfully imported ${createdList.length} inventory items!`,
    data: {
      importedCount: createdList.length,
      items: createdList
    }
  });
});


/**
 * Bulk Scan RFID Tags (e.g. Feibot Handheld Trigger Sweep)
 * Supports modes: 'identify' (lookup), 'receive' (auto stock-in), 'audit' (location check)
 */
exports.bulkScanRfid = catchAsync(async (req, res, next) => {
  const { tags, mode = 'identify', location, deviceId = 'Feibot-H200' } = req.body;
  if (!Array.isArray(tags) || tags.length === 0) {
    return next(new AppError('Please provide an array of RFID tags.', 400));
  }

  // Extract clean tag strings and count occurrences
  const tagCounts = {};
  for (const raw of tags) {
    const tag = (typeof raw === 'object' && raw.epc ? raw.epc : String(raw)).trim();
    if (tag) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  const uniqueTags = Object.keys(tagCounts);
  if (uniqueTags.length === 0) {
    return next(new AppError('No valid RFID tags found in scan payload.', 400));
  }

  // Find all matched products in MongoDB for this user by barcode, rfidTag, or sku
  const matchedProducts = await InventoryItem.find({
    user: req.user.id,
    $or: [
      { barcode: { $in: uniqueTags } },
      { rfidTag: { $in: uniqueTags } },
      { sku: { $in: uniqueTags } }
    ]
  });

  const matchedTagSet = new Set(matchedProducts.map(p => p.rfidTag));
  const unknownTags = uniqueTags.filter(t => !matchedTagSet.has(t));

  const locationMismatches = [];
  const processedItems = [];

  for (const product of matchedProducts) {
    const detectedUnits = tagCounts[product.rfidTag] || 1;
    const isLocationMismatch = Boolean(location && product.location && location.trim().toLowerCase() !== product.location.trim().toLowerCase());

    if (isLocationMismatch) {
      locationMismatches.push({
        productName: product.productName,
        sku: product.sku,
        rfidTag: product.rfidTag,
        expectedLocation: product.location,
        scannedLocation: location
      });
    }

    if (mode === 'receive') {
      product.quantity = (product.quantity || 0) + detectedUnits;
      product.status = computeStatus(product.quantity, product.minStockThreshold);
    }

    product.lastScannedAt = new Date();
    if (!Array.isArray(product.scanHistory)) product.scanHistory = [];
    product.scanHistory.unshift({
      scannedAt: new Date(),
      action: mode === 'receive' ? 'received' : mode === 'audit' ? 'audit' : 'scan',
      location: location || product.location || '',
      deviceId,
      delta: mode === 'receive' ? detectedUnits : 0,
      notes: `Bulk scanned via ${deviceId} (${detectedUnits} tag hits)`
    });

    if (product.scanHistory.length > 50) product.scanHistory = product.scanHistory.slice(0, 50);
    await product.save();

    processedItems.push({
      _id: product._id,
      productName: product.productName,
      sku: product.sku,
      rfidTag: product.rfidTag,
      category: product.category,
      location: product.location,
      unitPrice: product.unitPrice,
      quantity: product.quantity,
      status: product.status,
      detectedUnits,
      isLocationMismatch
    });
  }

  res.status(200).json({
    status: 'success',
    data: {
      totalTagsScanned: tags.length,
      uniqueTagsScanned: uniqueTags.length,
      matchedProductsCount: matchedProducts.length,
      matchedItems: processedItems,
      unknownTags,
      locationMismatches,
      mode,
      scannedAt: new Date().toISOString()
    }
  });
});

/**
 * Order Pick & Pack Verification via RFID
 * Verifies if the scanned RFID items match a specific Temu or eBay order
 */
exports.verifyOrderPick = catchAsync(async (req, res, next) => {
  const { orderId, tags } = req.body;
  if (!orderId) {
    return next(new AppError('Order ID is required for verification.', 400));
  }
  if (!Array.isArray(tags) || tags.length === 0) {
    return next(new AppError('Please provide scanned RFID tags.', 400));
  }

  // Find order in Temu or eBay models
  const TemuOrder = require('../models/temuOrder.model');
  const cleanId = String(orderId).trim();
  let order = await TemuOrder.findOne({
    user: req.user.id,
    $or: [{ orderNum: cleanId }, { temuOrderId: cleanId }, { _id: mongoose.isValidObjectId(cleanId) ? cleanId : null }]
  });

  if (!order) {
    const EbayOrder = require('../models/ebayOrder.model');
    order = await EbayOrder.findOne({
      user: req.user.id,
      $or: [{ orderId: cleanId }, { orderNum: cleanId }, { _id: mongoose.isValidObjectId(cleanId) ? cleanId : null }]
    });
  }

  // Count detected tags
  const tagCounts = {};
  for (const raw of tags) {
    const tag = (typeof raw === 'object' && raw.epc ? raw.epc : String(raw)).trim();
    if (tag) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  }
  const uniqueTags = Object.keys(tagCounts);

  // Look up inventory items for these tags
  const scannedItems = await InventoryItem.find({
    user: req.user.id,
    rfidTag: { $in: uniqueTags }
  });

  // Extract expected items from order
  const expectedList = [];
  if (order) {
    if (Array.isArray(order.items) && order.items.length > 0) {
      for (const itm of order.items) {
        expectedList.push({
          sku: (itm.sku || '').trim().toLowerCase(),
          name: (itm.articleName || itm.title || '').trim().toLowerCase(),
          quantity: itm.quantity || 1
        });
      }
    } else {
      expectedList.push({
        sku: (order.sku || '').trim().toLowerCase(),
        name: (order.articleName || order.title || order.name || '').trim().toLowerCase(),
        quantity: order.quantity || 1
      });
    }
  }

  // Compare scanned vs expected
  const verifiedItems = [];
  const unexpectedItems = [];
  const missingItems = [];

  for (const item of scannedItems) {
    const count = tagCounts[item.rfidTag] || 1;
    const matchExpected = expectedList.find(exp => 
      (exp.sku && exp.sku === (item.sku || '').toLowerCase()) ||
      (exp.name && ((item.productName || '').toLowerCase().includes(exp.name) || exp.name.includes((item.productName || '').toLowerCase())))
    );

    if (matchExpected) {
      verifiedItems.push({
        productName: item.productName,
        sku: item.sku,
        rfidTag: item.rfidTag,
        scannedCount: count,
        requiredCount: matchExpected.quantity,
        status: count >= matchExpected.quantity ? 'COMPLETE' : 'PARTIAL'
      });
    } else {
      unexpectedItems.push({
        productName: item.productName,
        sku: item.sku,
        rfidTag: item.rfidTag,
        scannedCount: count,
        reason: 'Item is not part of this order!'
      });
    }
  }

  for (const exp of expectedList) {
    const found = verifiedItems.find(v => 
      (exp.sku && (v.sku || '').toLowerCase() === exp.sku) ||
      (exp.name && (v.productName || '').toLowerCase().includes(exp.name))
    );
    if (!found) {
      missingItems.push({
        sku: exp.sku,
        name: exp.name,
        requiredQuantity: exp.quantity
      });
    } else if (found.scannedCount < exp.quantity) {
      missingItems.push({
        sku: exp.sku,
        name: exp.name,
        requiredQuantity: exp.quantity - found.scannedCount
      });
    }
  }

  const isVerified = order ? (missingItems.length === 0 && unexpectedItems.length === 0) : true;

  res.status(200).json({
    status: 'success',
    data: {
      orderId,
      orderFound: Boolean(order),
      isVerified,
      recipientName: order?.recipientName || order?.name || '',
      country: order?.country || '',
      verifiedItems,
      unexpectedItems,
      missingItems,
      totalTagsScanned: tags.length
    }
  });
});

/**
 * Reconcile Shelf Audit (Stocktake & Loss Detection)
 * Updates system stock to match physically counted RFID tags
 */
exports.reconcileAudit = catchAsync(async (req, res, next) => {
  const { location, items: auditItems } = req.body;
  if (!Array.isArray(auditItems) || auditItems.length === 0) {
    return next(new AppError('No audit items provided for reconciliation.', 400));
  }

  const updatedRecords = [];
  for (const item of auditItems) {
    if (!item.itemId) continue;
    const inv = await InventoryItem.findOne({ _id: item.itemId, user: req.user.id });
    if (!inv) continue;

    const previousQty = inv.quantity || 0;
    const physicalQty = Math.max(0, parseInt(item.physicalCount, 10) || 0);
    const delta = physicalQty - previousQty;

    inv.quantity = physicalQty;
    inv.status = computeStatus(inv.quantity, inv.minStockThreshold);
    inv.lastScannedAt = new Date();

    if (!Array.isArray(inv.scanHistory)) inv.scanHistory = [];
    inv.scanHistory.unshift({
      scannedAt: new Date(),
      action: 'audit',
      location: location || inv.location || '',
      delta,
      notes: `Physical audit reconciliation: adjusted from ${previousQty} to ${physicalQty} (${delta >= 0 ? '+' : ''}${delta})`
    });

    if (inv.scanHistory.length > 50) inv.scanHistory = inv.scanHistory.slice(0, 50);
    await inv.save();

    updatedRecords.push({
      _id: inv._id,
      productName: inv.productName,
      previousQuantity: previousQty,
      newQuantity: physicalQty,
      discrepancy: delta
    });
  }

  res.status(200).json({
    status: 'success',
    message: `Successfully reconciled ${updatedRecords.length} items from audit!`,
    data: {
      reconciledCount: updatedRecords.length,
      items: updatedRecords
    }
  });
});

/**
 * Get product trace history & lifecycle logs
 */
exports.getItemHistory = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const item = await InventoryItem.findOne({ _id: id, user: req.user.id }).lean();
  if (!item) {
    return next(new AppError('Inventory item not found.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      productName: item.productName,
      sku: item.sku,
      rfidTag: item.rfidTag,
      location: item.location,
      lastScannedAt: item.lastScannedAt,
      scanHistory: item.scanHistory || []
    }
  });
});


/**
 * Public endpoint to query product details by barcode, SKU, or QR code identifier
 * Scannable by anyone with a smartphone anywhere in the world
 */
exports.getPublicItemByCode = catchAsync(async (req, res, next) => {
  const code = String(req.params.code || '').trim();
  if (!code) {
    return next(new AppError('Product code or barcode is required.', 400));
  }

  const item = await InventoryItem.findOne({
    $or: [
      { barcode: code },
      { sku: code },
      { rfidTag: code }
    ]
  });

  if (!item) {
    return res.status(404).json({
      status: 'fail',
      message: 'No registered product found matching code: ' + code
    });
  }

  // Parse device telemetry (iPhone, Android, PC, Browser, IP, Time)
  const devInfo = parseDeviceInfo(req);

  // Update item metrics
  item.totalScanCount = (item.totalScanCount || 0) + 1;
  item.lastScannedAt = new Date();

  if (!Array.isArray(item.scanHistory)) item.scanHistory = [];
  item.scanHistory.unshift({
    scannedAt: new Date(),
    action: 'qr_scan',
    location: item.location || 'Warehouse',
    deviceId: `${devInfo.deviceModel} (${devInfo.browser})`,
    notes: `Scanned via camera from IP ${devInfo.ip || 'Unknown'}`
  });
  if (item.scanHistory.length > 50) {
    item.scanHistory = item.scanHistory.slice(0, 50);
  }
  await item.save().catch(() => {});

  // Create persistent scan log in MongoDB
  ProductScanLog.create({
    user: item.user,
    inventoryItem: item._id,
    productName: item.productName,
    sku: item.sku,
    barcode: item.barcode || code,
    deviceType: devInfo.deviceType,
    deviceModel: devInfo.deviceModel,
    os: devInfo.os,
    browser: devInfo.browser,
    ip: devInfo.ip,
    userAgent: devInfo.userAgent,
    scanMethod: 'camera_qr',
    location: item.location || 'Shelf A-04',
    scannedAt: new Date()
  }).catch(err => console.warn('ProductScanLog creation warning:', err.message));

  res.status(200).json({
    status: 'success',
    data: {
      item: {
        _id: item._id,
        productName: item.productName,
        sku: item.sku,
        barcode: item.barcode,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        category: item.category,
        location: item.location,
        batchNumber: item.batchNumber,
        manufacturingDate: item.manufacturingDate,
        expiryDate: item.expiryDate,
        status: item.status,
        notes: item.notes,
        totalScanCount: item.totalScanCount,
        lastScannedAt: item.lastScannedAt,
        scanHistory: item.scanHistory
      }
    }
  });
});

/**
 * Get all recent scan logs for current user (with device, time, IP, product)
 */
exports.getScanLogs = catchAsync(async (req, res, next) => {
  const { limit = 50, page = 1, deviceType, inventoryItemId } = req.query;
  const userId = req.user._id || req.user.id;
  const userObjId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(String(userId)) : userId;
  const filter = { user: { $in: [userObjId, String(userId)] } };

  if (deviceType && deviceType !== 'all') {
    filter.deviceType = deviceType;
  }
  if (inventoryItemId) {
    filter.inventoryItem = inventoryItemId;
  }

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const [logs, total] = await Promise.all([
    ProductScanLog.find(filter)
      .sort({ scannedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .lean(),
    ProductScanLog.countDocuments(filter)
  ]);

  // Aggregate device breakdown
  const deviceCounts = await ProductScanLog.aggregate([
    { $match: { user: { $in: [userObjId, String(userId)] } } },
    { $group: { _id: '$deviceModel', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      logs,
      total,
      deviceCounts,
      page: parseInt(page, 10),
      totalPages: Math.ceil(total / parseInt(limit, 10))
    }
  });
});

/**
 * Get overall scan stats & analytics
 */
exports.getScanStats = catchAsync(async (req, res, next) => {
  const userId = req.user._id || req.user.id;
  const userObjId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(String(userId)) : userId;
  const matchUser = { user: { $in: [userObjId, String(userId)] } };

  const totalScans = await ProductScanLog.countDocuments(matchUser);
  
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const scansToday = await ProductScanLog.countDocuments({
    ...matchUser,
    scannedAt: { $gte: oneDayAgo }
  });

  const byDevice = await ProductScanLog.aggregate([
    { $match: matchUser },
    { $group: { _id: '$deviceType', count: { $sum: 1 } } }
  ]);

  const topProducts = await ProductScanLog.aggregate([
    { $match: matchUser },
    { $group: { _id: '$productName', count: { $sum: 1 }, barcode: { $first: '$barcode' } } },
    { $sort: { count: -1 } },
    { $limit: 5 }
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      totalScans,
      scansToday,
      byDevice,
      topProducts
    }
  });
});

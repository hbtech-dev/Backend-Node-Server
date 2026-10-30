const mongoose = require('mongoose');
const InventoryItem = require('../models/inventoryItem.model');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');

/**
 * Representative default inventory items to seed if empty
 */
const DEFAULT_INVENTORY_ITEMS = [
  {
    productName: 'Apple Cider Vinegar Gummies 120ct',
    sku: 'SKU-ACV-120',
    quantity: 145,
    rfidTag: 'RFID-E280-1160-5928',
    category: 'Health & Beauty',
    location: 'Shelf A-04',
    unitPrice: 16.99,
    minStockThreshold: 15,
    status: 'in_stock',
    notes: 'Temu bestseller, fast-moving item'
  },
  {
    productName: 'Wireless Bluetooth Optical Mouse M350',
    sku: 'SKU-WBM-350',
    quantity: 68,
    rfidTag: 'RFID-E280-4491-8821',
    category: 'Electronics',
    location: 'Shelf B-12',
    unitPrice: 12.50,
    minStockThreshold: 10,
    status: 'in_stock',
    notes: 'Includes AA battery, EU CE compliant'
  },
  {
    productName: 'Thermal Shipping Label Rolls (100x150mm)',
    sku: 'SKU-THL-500',
    quantity: 42,
    rfidTag: 'RFID-E280-7712-3004',
    category: 'Packaging',
    location: 'Shelf C-01',
    unitPrice: 8.90,
    minStockThreshold: 10,
    status: 'in_stock',
    notes: 'Standard DHL Warenpost & Packeta size'
  },
  {
    productName: 'Ultra-Fast USB-C PD 65W Fast Charger',
    sku: 'SKU-CHG-65W',
    quantity: 4,
    rfidTag: 'RFID-E280-9930-1049',
    category: 'Electronics',
    location: 'Shelf B-08',
    unitPrice: 22.00,
    minStockThreshold: 5,
    status: 'low_stock',
    notes: 'Reorder required soon'
  }
];

/**
 * Compute stock status helper
 */
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

  // Seed default inventory items if user has 0 items
  const count = await InventoryItem.countDocuments({ user: req.user.id });
  if (count === 0) {
    for (const item of DEFAULT_INVENTORY_ITEMS) {
      await InventoryItem.create({
        user: req.user.id,
        ...item
      }).catch(() => {});
    }
  }

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
    quantity,
    rfidTag,
    category,
    location,
    unitPrice,
    minStockThreshold,
    notes
  } = req.body;

  if (!productName || !productName.trim()) {
    return next(new AppError('Product name is required.', 400));
  }

  const qty = Math.max(0, parseInt(quantity, 10) || 0);
  const minThreshold = parseInt(minStockThreshold, 10) || 5;
  const status = computeStatus(qty, minThreshold);

  // If RFID tag is given, ensure it doesn't already belong to another product of this user
  const cleanRfid = (rfidTag || '').trim();
  if (cleanRfid) {
    const existing = await InventoryItem.findOne({ user: req.user.id, rfidTag: cleanRfid });
    if (existing) {
      return next(new AppError(`RFID tag "${cleanRfid}" is already assigned to "${existing.productName}".`, 400));
    }
  }

  const item = await InventoryItem.create({
    user: req.user.id,
    productName: productName.trim(),
    sku: (sku || '').trim(),
    quantity: qty,
    rfidTag: cleanRfid,
    category: (category || 'General').trim(),
    location: (location || 'Shelf A-1').trim(),
    unitPrice: Math.max(0, parseFloat(unitPrice) || 0),
    minStockThreshold: minThreshold,
    status,
    notes: (notes || '').trim(),
    lastScannedAt: cleanRfid ? new Date() : null
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
    quantity,
    rfidTag,
    category,
    location,
    unitPrice,
    minStockThreshold,
    notes
  } = req.body;

  if (productName !== undefined) item.productName = productName.trim();
  if (sku !== undefined) item.sku = sku.trim();
  if (category !== undefined) item.category = category.trim();
  if (location !== undefined) item.location = location.trim();
  if (unitPrice !== undefined) item.unitPrice = Math.max(0, parseFloat(unitPrice) || 0);
  if (minStockThreshold !== undefined) item.minStockThreshold = parseInt(minStockThreshold, 10) || 5;
  if (notes !== undefined) item.notes = notes.trim();

  if (quantity !== undefined) {
    item.quantity = Math.max(0, parseInt(quantity, 10) || 0);
  }

  if (rfidTag !== undefined) {
    const cleanRfid = rfidTag.trim();
    if (cleanRfid && cleanRfid !== item.rfidTag) {
      const existing = await InventoryItem.findOne({ user: req.user.id, rfidTag: cleanRfid, _id: { $ne: id } });
      if (existing) {
        return next(new AppError(`RFID tag "${cleanRfid}" is already assigned to "${existing.productName}".`, 400));
      }
      item.rfidTag = cleanRfid;
      item.lastScannedAt = new Date();
    } else if (!cleanRfid) {
      item.rfidTag = '';
    }
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
  const { rfidTag, targetItemId } = req.body;
  if (!rfidTag || !rfidTag.trim()) {
    return next(new AppError('RFID tag is required.', 400));
  }

  const cleanTag = rfidTag.trim();

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

  // Lookup existing item by RFID tag
  const matched = await InventoryItem.findOne({ user: req.user.id, rfidTag: cleanTag });
  if (matched) {
    matched.lastScannedAt = new Date();
    await matched.save();
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

  // Find all matched products in MongoDB for this user
  const matchedProducts = await InventoryItem.find({
    user: req.user.id,
    rfidTag: { $in: uniqueTags }
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

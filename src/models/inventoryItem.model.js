const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    productName: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      index: true
    },
    sku: {
      type: String,
      trim: true,
      default: ''
    },
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      default: 0,
      min: [0, 'Quantity cannot be negative']
    },
    barcode: {
      type: String,
      trim: true,
      default: '',
      index: true
    },
    batchNumber: {
      type: String,
      trim: true,
      default: ''
    },
    expiryDate: {
      type: String,
      trim: true,
      default: ''
    },
    manufacturingDate: {
      type: String,
      trim: true,
      default: ''
    },
    rfidTag: {
      type: String,
      trim: true,
      default: '',
      index: true
    },
    category: {
      type: String,
      trim: true,
      default: 'General'
    },
    location: {
      type: String,
      trim: true,
      default: 'Shelf A-1'
    },
    unitPrice: {
      type: Number,
      default: 0.00,
      min: 0
    },
    minStockThreshold: {
      type: Number,
      default: 5
    },
    status: {
      type: String,
      enum: ['in_stock', 'low_stock', 'out_of_stock'],
      default: 'in_stock'
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    },
    labelTemplate: {
      designUrl: { type: String, default: '' },
      fileName: { type: String, default: '' },
      fileType: { type: String, default: 'image' },
      placement: {
        x: { type: Number, default: 45 },
        y: { type: Number, default: 38 },
        size: { type: Number, default: 20 },
        width: { type: Number, default: 20 },
        height: { type: Number, default: 20 },
        hasWhiteBg: { type: Boolean, default: false },
        includeLabelNumber: { type: Boolean, default: false }
      }
    },
    lastScannedAt: {
      type: Date,
      default: null
    },
    totalScanCount: {
      type: Number,
      default: 0
    },
    scannedUnits: [
      { type: Number }
    ],
    deductedTokens: [
      { type: String }
    ],
    scanHistory: [
      {
        scannedAt: { type: Date, default: Date.now },
        action: { type: String, default: 'scan' },
        location: { type: String, default: '' },
        deviceId: { type: String, default: '' },
        ip: { type: String, default: '' },
        unitNumber: { type: Number, default: null },
        scannedCode: { type: String, default: '' },
        previousStock: { type: Number },
        remainingStock: { type: Number },
        delta: { type: Number, default: 0 },
        notes: { type: String, default: '' }
      }
    ]
  },
  {
    timestamps: true
  }
);

inventoryItemSchema.index({ user: 1, productName: 1 });
inventoryItemSchema.index({ user: 1, barcode: 1 });
inventoryItemSchema.index({ user: 1, rfidTag: 1 });
inventoryItemSchema.index({ user: 1, createdAt: -1 });
inventoryItemSchema.index({ user: 1, updatedAt: -1 });

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);


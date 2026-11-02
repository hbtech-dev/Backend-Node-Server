const mongoose = require('mongoose');

const productScanLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    inventoryItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryItem',
      required: true,
      index: true
    },
    productName: {
      type: String,
      required: true,
      trim: true
    },
    sku: {
      type: String,
      default: '',
      trim: true
    },
    barcode: {
      type: String,
      default: '',
      trim: true,
      index: true
    },
    deviceType: {
      type: String,
      default: 'Mobile' // 'Mobile', 'Tablet', 'Desktop', 'Scanner Gun'
    },
    deviceModel: {
      type: String,
      default: 'Apple iPhone'
    },
    os: {
      type: String,
      default: 'iOS'
    },
    browser: {
      type: String,
      default: 'Safari'
    },
    ip: {
      type: String,
      default: ''
    },
    userAgent: {
      type: String,
      default: ''
    },
    scanMethod: {
      type: String,
      enum: ['camera_qr', 'scanner_gun', 'in_app_scan', 'manual_lookup'],
      default: 'camera_qr'
    },
    location: {
      type: String,
      default: ''
    },
    scannedAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: true
  }
);

productScanLogSchema.index({ user: 1, scannedAt: -1 });
productScanLogSchema.index({ inventoryItem: 1, scannedAt: -1 });
productScanLogSchema.index({ user: 1, deviceType: 1 });

module.exports = mongoose.model('ProductScanLog', productScanLogSchema);

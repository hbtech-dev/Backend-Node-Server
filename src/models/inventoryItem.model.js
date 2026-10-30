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
    lastScannedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

inventoryItemSchema.index({ user: 1, productName: 1 });
inventoryItemSchema.index({ user: 1, rfidTag: 1 });
inventoryItemSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);


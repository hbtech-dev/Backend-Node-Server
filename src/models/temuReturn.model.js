const mongoose = require('mongoose');

const temuReturnSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    returnId: {
      type: String,
      required: true
    },
    orderNum: {
      type: String,
      required: true
    },
    buyerName: {
      type: String,
      required: true
    },
    country: {
      type: String,
      default: 'DE'
    },
    reason: {
      type: String,
      default: 'Item not as described / size issue'
    },
    refundAmount: {
      type: Number,
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'refunded'],
      default: 'pending'
    },
    itemDetails: {
      articleName: String,
      sku: String,
      quantity: Number
    },
    resolutionNotes: {
      type: String,
      default: ''
    },
    resolvedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('TemuReturn', temuReturnSchema);

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
      required: true,
      index: true
    },
    orderNum: {
      type: String,
      required: true,
      index: true
    },
    buyerName: {
      type: String,
      default: "Temu Customer"
    },
    country: {
      type: String,
      default: "DE"
    },
    reason: {
      type: String,
      default: ""
    },
    buyerComment: { type: String, default: "" },
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
      quantity: Number,
      orderItemId: String,
      productImage: String,
      variation: String
    },
    orderDate: { type: Date, default: null },
    requestedDate: { type: Date, default: null },
    mediaUrls: { type: [String], default: [] },
    afterSaleHistory: { type: Array, default: [] },
    resolutionNotes: {
      type: String,
      default: ''
    },
    evidenceCardUrl: {
      type: String,
      default: ''
    },
    resolvedAt: {
      type: Date,
      default: null
    },
    trackingNumber: {
      type: String,
      default: ''
    },
    carrier: {
      type: String,
      default: 'DHL Paket'
    },
    // Live status mirrored from Temu bg.aftersales.parentaftersales.list.get
    temuStatusGroup: { type: Number, default: null },
    temuStatus: { type: Number, default: null },
    temuAfterSalesType: { type: Number, default: null },
    availableActions: { type: [String], default: [] },
    operateExpireAt: { type: Date, default: null },
    temuCreatedAt: { type: Date, default: null },
    lastTemuSyncAt: { type: Date, default: null }
  },
  {
    timestamps: true
  }
);

temuReturnSchema.index({ user: 1, createdAt: -1 });
temuReturnSchema.index({ user: 1, returnId: 1 }, { unique: true });

module.exports = mongoose.model('TemuReturn', temuReturnSchema);

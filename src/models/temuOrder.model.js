const mongoose = require('mongoose');

const temuOrderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    orderNum: {
      type: String,
      required: true
    },
    orderDate: {
      type: String,
      default: () => new Date().toLocaleDateString('de-DE')
    },
    name: {
      type: String,
      required: true
    },
    country: {
      type: String,
      default: 'DE'
    },
    address: {
      type: String,
      default: ''
    },
    articleName: {
      type: String,
      default: ''
    },
    shippingMethod: {
      type: String,
      default: 'DHL EDER International'
    },
    tracking: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['open', 'created_label', 'printed', 'canceled'],
      default: 'open'
    },
    source: {
      type: String,
      default: 'Temu'
    }
  },
  {
    timestamps: true
  }
);

temuOrderSchema.index({ user: 1, orderNum: 1 });

module.exports = mongoose.model('TemuOrder', temuOrderSchema);

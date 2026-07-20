const mongoose = require('mongoose');

const ebayOrderSchema = new mongoose.Schema(
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
      default: 'DHL Paket International'
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
      default: 'eBay'
    }
  },
  {
    timestamps: true
  }
);

ebayOrderSchema.index({ user: 1, orderNum: 1 });

module.exports = mongoose.model('EbayOrder', ebayOrderSchema);

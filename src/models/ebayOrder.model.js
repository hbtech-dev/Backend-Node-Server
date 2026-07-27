const mongoose = require('mongoose');

const ebayOrderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    ebayOrderId: {
      type: String,
      default: ''
    },
    lineItemId: {
      type: String,
      default: ''
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
    streetName: {
      type: String,
      default: ''
    },
    houseNumber: {
      type: String,
      default: ''
    },
    postcode: {
      type: String,
      default: ''
    },
    cityName: {
      type: String,
      default: ''
    },
    email: {
      type: String,
      default: ''
    },
    phone: {
      type: String,
      default: ''
    },
    articleName: {
      type: String,
      default: ''
    },
    productImage: {
      type: String,
      default: ''
    },
    sku: {
      type: String,
      default: ''
    },
    quantity: {
      type: Number,
      default: 1
    },
    price: {
      type: Number,
      default: 0
    },
    weight: {
      type: String,
      default: '0.30 kg'
    },
    shippingMethod: {
      type: String,
      default: 'DHL Paket International'
    },
    tracking: {
      type: String,
      default: ''
    },
    qrCodeData: {
      type: String,
      default: ''
    },
    barcodeData: {
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
ebayOrderSchema.index({ user: 1, ebayOrderId: 1 });

module.exports = mongoose.model('EbayOrder', ebayOrderSchema);

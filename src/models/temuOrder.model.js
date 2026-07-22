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
    temuOrderId: {
      type: String,
      default: ''
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
    address: {
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
    sku: {
      type: String,
      default: ''
    },
    quantity: {
      type: Number,
      default: 1
    },
    productImage: {
      type: String,
      default: ''
    },
    variation: {
      type: String,
      default: ''
    },
    packaging: {
      type: String,
      default: 'Small Parcel (25×18×10cm)'
    },
    price: {
      type: Number,
      default: 19.99
    },
    weight: {
      type: String,
      default: '0.50 kg'
    },
    shippingMethod: {
      type: String,
      default: 'DHL EDER International'
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
    dhlShipmentId: {
      type: String,
      default: ''
    },
    dhlLabelUrl: {
      type: String,
      default: ''
    },
    shippedAt: {
      type: Date,
      default: null
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

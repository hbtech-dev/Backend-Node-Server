const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema(
  {
    number: {
      type: String,
      required: [true, 'Invoice number is required'],
      unique: true,
      trim: true
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required']
    },
    date: {
      type: Date,
      default: Date.now
    },
    amount: {
      type: Number,
      required: [true, 'Invoice amount is required']
    },
    description: {
      type: String,
      default: 'Invoice Payment'
    },
    paymentMethod: {
      type: String,
      default: 'Stripe Card (Sandbox)'
    },
    stripePaymentId: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['paid', 'unpaid'],
      default: 'paid'
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

invoiceSchema.index({ user: 1, createdAt: -1 });

const Invoice = mongoose.model('Invoice', invoiceSchema);

module.exports = Invoice;

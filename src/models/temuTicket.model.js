const mongoose = require('mongoose');

const temuTicketSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  ticketId: {
    type: String,
    required: true,
    index: true
  },
  orderNum: {
    type: String,
    required: true,
    index: true
  },
  country: {
    type: String,
    default: 'PL'
  },
  type: {
    type: String,
    enum: ['Information Ticket', 'Fulfillment Issue', 'Cancellation Request', 'Logistics Query'],
    default: 'Information Ticket'
  },
  subject: {
    type: String,
    default: 'Address & Delivery Clarification Request'
  },
  buyerName: {
    type: String,
    default: 'Temu Buyer'
  },
  buyerMessage: {
    type: String,
    default: 'Customer requested additional shipping detail / delivery status clarification.'
  },
  articleName: {
    type: String,
    default: 'Apple Cider Vinegar Gummies 120 Gummies'
  },
  sku: {
    type: String,
    default: '59843658408164'
  },
  deadline: {
    type: Date,
    default: () => new Date(Date.now() + 48 * 60 * 60 * 1000)
  },
  status: {
    type: String,
    enum: ['pending', 'resolved', 'escalated'],
    default: 'pending'
  },
  merchantResponse: {
    responseText: { type: String, default: '' },
    respondedAt: { type: Date },
    trackingInfo: { type: String, default: '' }
  },
  source: {
    type: String,
    default: 'Temu'
  }
}, {
  timestamps: true
});

temuTicketSchema.index({ user: 1, ticketId: 1 }, { unique: true });

module.exports = mongoose.model('TemuTicket', temuTicketSchema);

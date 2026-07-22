const mongoose = require('mongoose');

const temuFulfillmentIssueSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    issueId: {
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
    issueType: {
      type: String,
      enum: ['address_change', 'cancellation_request', 'late_shipment', 'logistics_query'],
      required: true
    },
    country: {
      type: String,
      default: 'DE'
    },
    description: {
      type: String,
      required: true
    },
    requestedAddress: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['open', 'resolved'],
      default: 'open'
    },
    resolutionAction: {
      type: String,
      default: ''
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

module.exports = mongoose.model('TemuFulfillmentIssue', temuFulfillmentIssueSchema);

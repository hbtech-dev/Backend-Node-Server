const mongoose = require("mongoose");

const temuFulfillmentIssueSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    issueId: {
      type: String,
      required: true
    },
    orderNum: {
      type: String,
      default: ""
    },
    buyerName: {
      type: String,
      default: "Temu Customer"
    },
    issueType: {
      type: String,
      default: "delayed_fulfillment"
    },
    country: {
      type: String,
      default: "DE"
    },
    description: {
      type: String,
      default: ""
    },
    requestedAddress: {
      type: String,
      default: ""
    },
    quantity: {
      type: Number,
      default: 1
    },
    compensationRaw: {
      type: String,
      default: ""
    },
    noticeDate: {
      type: String,
      default: ""
    },
    parcel: {
      type: String,
      default: ""
    },
    status: {
      type: String,
      default: "open"
    },
    resolutionAction: {
      type: String,
      default: ""
    },
    resolutionNotes: {
      type: String,
      default: ""
    },
    denialReason: {
      type: String,
      default: ""
    },
    evidenceCardUrl: {
      type: String,
      default: ""
    },
    trackingNumber: {
      type: String,
      default: ""
    },
    carrier: {
      type: String,
      default: "DHL Warenpost"
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

temuFulfillmentIssueSchema.index({ user: 1, createdAt: -1 });
temuFulfillmentIssueSchema.index({ user: 1, issueId: 1 }, { unique: true });
temuFulfillmentIssueSchema.index({ user: 1, country: 1 });

module.exports = mongoose.model("TemuFulfillmentIssue", temuFulfillmentIssueSchema);

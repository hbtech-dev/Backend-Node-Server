const express = require('express');
const ebayController = require('../controllers/ebay.controller');
const auth = require('../middlewares/auth');

const router = express.Router();

// OAuth 2.0 Flow — Public App / 1-Click Authorization
router.get('/oauth-url', auth, ebayController.getEbayOAuthUrl);
router.get('/oauth-callback', ebayController.handleEbayOAuthCallback);

// eBay Marketplace Account Deletion / Closure Notification (PUBLIC)
router.get('/marketplace-deletion', ebayController.handleEbayMarketplaceDeletion);
router.post('/marketplace-deletion', ebayController.handleEbayMarketplaceDeletion);

// Status, Connect, Disconnect
router.get('/status', auth, ebayController.getEbayStatus);
router.post('/connect', auth, ebayController.connectEbay);
router.post('/disconnect', auth, ebayController.disconnectEbay);

// Order Sync & Retrieval
router.post('/sync-orders', auth, ebayController.syncEbayOrders);
router.get('/orders', auth, ebayController.getUserEbayOrders);

// Tracking Upload & Token Refresh
router.post('/upload-tracking', auth, ebayController.uploadTracking);
router.post('/refresh-token', auth, ebayController.refreshToken);

module.exports = router;

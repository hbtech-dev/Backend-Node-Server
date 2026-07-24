const express = require('express');
const ebayController = require('../controllers/ebay.controller');
const auth = require('../middlewares/auth');

const router = express.Router();

// OAuth 2.0 Flow — Public App / 1-Click Authorization
router.get('/oauth-url', auth, ebayController.getEbayOAuthUrl);
router.get('/oauth-callback', ebayController.handleEbayOAuthCallback);

router.get('/status', auth, ebayController.getEbayStatus);
router.post('/connect', auth, ebayController.connectEbay);
router.post('/disconnect', auth, ebayController.disconnectEbay);
router.post('/sync-orders', auth, ebayController.syncEbayOrders);
router.get('/orders', auth, ebayController.getUserEbayOrders);

module.exports = router;


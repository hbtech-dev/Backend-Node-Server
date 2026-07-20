const express = require('express');
const ebayController = require('../controllers/ebay.controller');
const auth = require('../middlewares/auth');

const router = express.Router();

router.get('/status', auth, ebayController.getEbayStatus);
router.post('/connect', auth, ebayController.connectEbay);
router.post('/disconnect', auth, ebayController.disconnectEbay);
router.post('/sync-orders', auth, ebayController.syncEbayOrders);
router.get('/orders', auth, ebayController.getUserEbayOrders);

module.exports = router;

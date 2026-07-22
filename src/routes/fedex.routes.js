const express = require('express');
const fedexController = require('../controllers/fedex.controller');
const auth = require('../middlewares/auth');

const router = express.Router();

router.use(auth);

router.get('/status', fedexController.getFedexStatus);
router.post('/connect', fedexController.connectFedex);
router.post('/disconnect', fedexController.disconnectFedex);

// Shipment processing
router.post('/create-shipment', fedexController.createShipment);
router.post('/bulk-create-shipments', fedexController.bulkCreateShipments);

module.exports = router;

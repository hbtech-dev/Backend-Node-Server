const express = require('express');
const dhlController = require('../controllers/dhl.controller');
const auth = require('../middlewares/auth');

const router = express.Router();

router.use(auth);

router.get('/status', dhlController.getDhlStatus);
router.post('/connect', dhlController.connectDhl);
router.post('/disconnect', dhlController.disconnectDhl);
router.post('/test-connection', dhlController.testConnection);

// Shipment processing
router.post('/create-shipment', dhlController.createShipment);
router.post('/bulk-create-shipments', dhlController.bulkCreateShipments);

module.exports = router;

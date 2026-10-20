const express = require('express');
const packetaController = require('../controllers/packeta.controller');
const auth = require('../middlewares/auth');

const router = express.Router();

router.use(auth);

router.get('/status', packetaController.getPacketaStatus);
router.post('/connect', packetaController.connectPacketa);
router.post('/disconnect', packetaController.disconnectPacketa);
router.post('/test-connection', packetaController.testConnection);
router.get('/carriers', packetaController.getCarriers);

router.post('/create-shipment', packetaController.createShipment);
router.post('/bulk-create-shipments', packetaController.bulkCreateShipments);
router.get('/label-pdf/:packetId', packetaController.getLabelPdf);

module.exports = router;

const express = require('express');
const inventoryController = require('../controllers/inventory.controller');
const auth = require('../middlewares/auth');

const router = express.Router();

// Public unauthenticated route for globally scannable QR codes
router.get('/public/:code', inventoryController.getPublicItemByCode);

// Require authentication for all inventory management routes
router.use(auth);

router.get('/', inventoryController.getAllInventory);
router.post('/', inventoryController.createInventoryItem);
router.post('/scan-barcode', inventoryController.scanRfidTag);
router.post('/scan-rfid', inventoryController.scanRfidTag);
router.post('/bulk-scan', inventoryController.bulkScanRfid);
router.post('/verify-order', inventoryController.verifyOrderPick);
router.post('/reconcile-audit', inventoryController.reconcileAudit);
router.get('/:id/history', inventoryController.getItemHistory);
router.post('/bulk-import', inventoryController.bulkImportInventory);
router.put('/:id', inventoryController.updateInventoryItem);
router.patch('/:id/stock', inventoryController.adjustStock);
router.delete('/:id', inventoryController.deleteInventoryItem);

module.exports = router;

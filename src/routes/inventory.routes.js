const express = require('express');
const inventoryController = require('../controllers/inventory.controller');
const auth = require('../middlewares/auth');

const router = express.Router();

// Require authentication for all inventory routes
router.use(auth);

router.get('/', inventoryController.getAllInventory);
router.post('/', inventoryController.createInventoryItem);
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

const express = require('express');
const temuController = require('../controllers/temu.controller');
const auth = require('../middlewares/auth');

const router = express.Router();

router.get('/health', temuController.getHealth);
router.get('/products', temuController.searchProducts);
router.get('/products/:id', temuController.getProductById);
router.get('/categories', temuController.getCategories);

// Authenticated User Temu Store & Order Routes
router.get('/status', auth, temuController.getTemuStatus);
router.post('/connect', auth, temuController.connectTemu);
router.post('/disconnect', auth, temuController.disconnectTemu);
router.post('/sync-orders', auth, temuController.syncTemuOrders);
router.get('/orders', auth, temuController.getUserTemuOrders);

module.exports = router;

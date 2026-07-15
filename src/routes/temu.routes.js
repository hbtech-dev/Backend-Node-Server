const express = require('express');
const temuController = require('../controllers/temu.controller');

const router = express.Router();

router.get('/health', temuController.getHealth);
router.get('/products', temuController.searchProducts);
router.get('/products/:id', temuController.getProductById);
router.get('/categories', temuController.getCategories);

module.exports = router;

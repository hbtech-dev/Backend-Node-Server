const express = require('express');
const invoiceController = require('../controllers/invoice.controller');
const auth = require('../middlewares/auth');

const router = express.Router();

router.use(auth);

router.get('/', invoiceController.getMyInvoices);

module.exports = router;

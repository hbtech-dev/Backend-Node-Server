const express = require('express');
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const itemRoutes = require('./item.routes');
const temuRoutes = require('./temu.routes');
const ebayRoutes = require('./ebay.routes');
const invoiceRoutes = require('./invoice.routes');
const notificationRoutes = require('./notification.routes');
const dhlRoutes = require('./dhl.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/items', itemRoutes);
router.use('/temu', temuRoutes);
router.use('/ebay', ebayRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/notifications', notificationRoutes);
router.use('/dhl', dhlRoutes);

module.exports = router;

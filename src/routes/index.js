const express = require('express');
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const itemRoutes = require('./item.routes');
const temuRoutes = require('./temu.routes');
const invoiceRoutes = require('./invoice.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/items', itemRoutes);
router.use('/temu', temuRoutes);
router.use('/invoices', invoiceRoutes);

module.exports = router;

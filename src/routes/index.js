const express = require('express');
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const itemRoutes = require('./item.routes');
const temuRoutes = require('./temu.routes');
const temuTicketRoutes = require('./temuTicket.routes');
const ebayRoutes = require('./ebay.routes');
const invoiceRoutes = require('./invoice.routes');
const notificationRoutes = require('./notification.routes');
const dhlRoutes = require('./dhl.routes');
const fedexRoutes = require('./fedex.routes');
const packetaRoutes = require('./packeta.routes');
const inventoryRoutes = require('./inventory.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/items', itemRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/temu/tickets', temuTicketRoutes);
router.use('/temu', temuRoutes);
router.use('/ebay', ebayRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/notifications', notificationRoutes);
router.use('/dhl', dhlRoutes);
router.use('/fedex', fedexRoutes);
router.use('/packeta', packetaRoutes);

module.exports = router;

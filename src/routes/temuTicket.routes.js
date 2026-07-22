const express = require('express');
const temuTicketController = require('../controllers/temuTicket.controller');
const auth = require('../middlewares/auth');

const router = express.Router();

router.use(auth);

router.get('/', temuTicketController.getTickets);
router.post('/sync', temuTicketController.syncTickets);
router.post('/:ticketId/reply', temuTicketController.replyToTicket);

module.exports = router;

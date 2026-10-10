const express = require('express');
const temuTicketController = require('../controllers/temuTicket.controller');
const auth = require('../middlewares/auth');

const router = express.Router();

router.use(auth);

router.get('/', temuTicketController.getTickets);
router.post('/sync', temuTicketController.syncTickets);
router.post('/:ticketId/reply', temuTicketController.replyToTicket);
router.post('/bot/run', temuTicketController.runTicketBot);
router.post('/:ticketId/ai-reply', temuTicketController.autoReplyTicketWithAi);
router.post('/:ticketId/ai-draft', temuTicketController.draftTicketAiResponse);

module.exports = router;

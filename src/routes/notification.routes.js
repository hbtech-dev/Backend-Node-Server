const express = require('express');
const notificationController = require('../controllers/notification.controller');
const auth = require('../middlewares/auth');

const router = express.Router();

router.use(auth);

router.get('/', notificationController.getMyNotifications);
router.post('/mark-read', notificationController.markAllRead);
router.post('/clear', notificationController.clearAllNotifications);
router.delete('/clear', notificationController.clearAllNotifications);

module.exports = router;


const express = require('express');
const { body } = require('express-validator');
const userController = require('../controllers/user.controller');
const auth = require('../middlewares/auth');
const validate = require('../middlewares/validate');

const router = express.Router();

router.use(auth);

router.get('/me', userController.getMe);

router.put(
  '/me',
  [
    body('email').optional().isEmail().withMessage('Please provide a valid email'),
    body('username').optional().notEmpty().withMessage('Username cannot be empty'),
    body('fullName').optional()
  ],
  validate,
  userController.updateMe
);

router.get('/', userController.getAllUsers);

router.get('/:id', userController.getUserById);

router.delete('/:id', userController.deleteUser);

module.exports = router;

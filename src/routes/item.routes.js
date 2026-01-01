const express = require('express');
const { body } = require('express-validator');
const itemController = require('../controllers/item.controller');
const auth = require('../middlewares/auth');
const validate = require('../middlewares/validate');

const router = express.Router();

router.use(auth);

router.get('/', itemController.getAllItems);

router.post(
  '/',
  [
    body('title').notEmpty().withMessage('Title is required'),
    body('description').optional()
  ],
  validate,
  itemController.createItem
);

router.get('/:id', itemController.getItemById);

router.put(
  '/:id',
  [
    body('title').optional().notEmpty().withMessage('Title cannot be empty'),
    body('description').optional()
  ],
  validate,
  itemController.updateItem
);

router.delete('/:id', itemController.deleteItem);

module.exports = router;

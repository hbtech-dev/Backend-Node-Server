const Item = require('../models/item.model');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

exports.getAllItems = catchAsync(async (req, res, next) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const items = await Item.find({ owner: req.user.id }).skip(skip).limit(limit);
  const total = await Item.countDocuments({ owner: req.user.id });

  res.status(200).json({
    status: 'success',
    results: items.length,
    data: {
      items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});

exports.createItem = catchAsync(async (req, res, next) => {
  const { title, description } = req.body;

  const item = await Item.create({
    title,
    description,
    owner: req.user.id
  });

  res.status(201).json({
    status: 'success',
    data: {
      item
    }
  });
});

exports.getItemById = catchAsync(async (req, res, next) => {
  const item = await Item.findById(req.params.id);

  if (!item) {
    return next(new AppError('Item not found', 404));
  }

  if (item.owner.toString() !== req.user.id) {
    return next(new AppError('You do not have permission to access this item', 403));
  }

  res.status(200).json({
    status: 'success',
    data: {
      item
    }
  });
});

exports.updateItem = catchAsync(async (req, res, next) => {
  const item = await Item.findById(req.params.id);

  if (!item) {
    return next(new AppError('Item not found', 404));
  }

  if (item.owner.toString() !== req.user.id) {
    return next(new AppError('You do not have permission to update this item', 403));
  }

  const { title, description } = req.body;
  if (title) item.title = title;
  if (description !== undefined) item.description = description;

  await item.save();

  res.status(200).json({
    status: 'success',
    data: {
      item
    }
  });
});

exports.deleteItem = catchAsync(async (req, res, next) => {
  const item = await Item.findById(req.params.id);

  if (!item) {
    return next(new AppError('Item not found', 404));
  }

  if (item.owner.toString() !== req.user.id) {
    return next(new AppError('You do not have permission to delete this item', 403));
  }

  await item.deleteOne();

  res.status(204).json({
    status: 'success',
    data: null
  });
});

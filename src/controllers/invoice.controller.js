const Invoice = require('../models/invoice.model');
const catchAsync = require('../utils/catchAsync');

exports.getMyInvoices = catchAsync(async (req, res, next) => {
  const invoices = await Invoice.find({ user: req.user.id }).sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    results: invoices.length,
    data: {
      invoices
    }
  });
});

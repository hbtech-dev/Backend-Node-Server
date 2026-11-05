const logger = require('../utils/logger');
const config = require('../config/config');

const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  logger.error(`${err.statusCode} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);

  if (config.env === 'development') {
    res.status(err.statusCode).json({
      status: err.status,
      error: err,
      message: err.message,
      stack: err.stack
    });
  } else {
    // Treat known client-side errors as operational
    if (err.name === 'CastError') {
      err.statusCode = 400;
      err.status = 'fail';
      err.message = `Invalid ${err.path}: ${err.value}`;
      err.isOperational = true;
    }
    if (err.name === 'ValidationError') {
      err.statusCode = 400;
      err.status = 'fail';
      err.isOperational = true;
    }
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      err.statusCode = 401;
      err.status = 'fail';
      err.isOperational = true;
    }

    if (err.isOperational) {
      res.status(err.statusCode).json({
        status: err.status,
        message: err.message
      });
    } else {
      logger.error('ERROR 💥', err);
      res.status(500).json({
        status: 'error',
        message: 'Something went wrong!'
      });
    }
  }
};

module.exports = errorHandler;

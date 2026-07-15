const mongoose = require('mongoose');
const config = require('./config');
const logger = require('../utils/logger');

const connectDB = async () => {
  if (!config.mongodb.url) {
    logger.warn('MongoDB URI not provided. Skipping database connection.');
    return;
  }

  try {
    const conn = await mongoose.connect(config.mongodb.url, config.mongodb.options);
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    logger.error(`MongoDB connection failed: ${error.message}`);
    logger.warn('Continuing without MongoDB. Set MONGODB_URI to enable database features.');
  }
};

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB connection error: ${err}`);
});

module.exports = connectDB;

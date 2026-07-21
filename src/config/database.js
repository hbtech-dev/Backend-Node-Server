const mongoose = require('mongoose');
const config = require('./config');
const logger = require('../utils/logger');

// Disable command buffering globally so queries fail fast or handle offline mode
mongoose.set('bufferCommands', false);

const connectDB = async () => {
  if (!config.mongodb.url) {
    logger.warn('MongoDB URI not provided. Running in memory/offline mode.');
    return;
  }

  try {
    const conn = await mongoose.connect(config.mongodb.url, {
      ...config.mongodb.options,
      serverSelectionTimeoutMS: 2000,
      connectTimeoutMS: 3000
    });
    // Re-enable buffering if successfully connected
    mongoose.set('bufferCommands', true);
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    mongoose.set('bufferCommands', false);
    logger.error(`MongoDB connection failed (${error.message}). Running in fallback mode.`);
  }
};

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected. Disabling query buffering.');
  mongoose.set('bufferCommands', false);
});

mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB error: ${err.message || err}`);
  mongoose.set('bufferCommands', false);
});

module.exports = connectDB;

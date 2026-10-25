const mongoose = require('mongoose');
const config = require('./config');
const logger = require('../utils/logger');

// Disable command buffering globally until connected
mongoose.set('bufferCommands', false);

let isConnecting = false;

const connectDB = async () => {
  const mongoUri = config.mongodb.url || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    logger.warn('MongoDB URI not provided. Running in memory/offline mode.');
    return;
  }

  if (mongoose.connection.readyState === 1 || isConnecting) {
    return;
  }

  isConnecting = true;
  try {
    const conn = await mongoose.connect(mongoUri, {
      ...config.mongodb.options,
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 20000,
      socketTimeoutMS: 45000
    });
    // Re-enable buffering if successfully connected
    mongoose.set('bufferCommands', true);
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    mongoose.set('bufferCommands', false);
    logger.error(`MongoDB connection failed (${error.message}). Retrying in 5s...`);
    setTimeout(connectDB, 5000);
  } finally {
    isConnecting = false;
  }
};

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected. Disabling query buffering and attempting reconnect...');
  mongoose.set('bufferCommands', false);
  setTimeout(connectDB, 5000);
});

mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB error: ${err.message || err}`);
  mongoose.set('bufferCommands', false);
});

module.exports = connectDB;

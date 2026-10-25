require('dotenv').config();

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3000,
  
  mongodb: {
    url: process.env.MONGODB_URI || process.env.MONGO_URI || '',
    options: {
      serverSelectionTimeoutMS: parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || '15000', 10)
    }
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'ederapp_secure_jwt_secret_production_2026_x89',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'ederapp_secure_refresh_secret_production_2026_z99',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d'
  },
  
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
  },
  
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 100
  },
  
  bcrypt: {
    saltRounds: 10
  }
};

# Node.js Backend Server

A professional, production-ready Node.js backend server with Express.js and clean architecture, following best practices and industry standards.

## 🚀 Features

- **Express.js Framework**: Fast, unopinionated, minimalist web framework
- **Clean Architecture**: Well-organized folder structure with MVC pattern
- **Authentication & Authorization**: JWT-based authentication with refresh tokens
- **Database Integration**: MongoDB with Mongoose ODM
- **Security**: Helmet, CORS, rate limiting, password hashing with bcrypt
- **Validation**: Request validation with express-validator
- **Error Handling**: Centralized error handling middleware
- **Logging**: Winston logger for structured logging
- **Environment Configuration**: Environment-based configuration with dotenv
- **API Versioning**: Structured API versioning (v1)
- **Compression**: Response compression middleware
- **Testing Ready**: Jest and Supertest configuration

## 📁 Project Structure

```
Node-Server/
├── src/
│   ├── config/
│   │   ├── config.js           # Configuration settings
│   │   └── database.js         # Database connection
│   ├── controllers/
│   │   ├── auth.controller.js  # Authentication logic
│   │   ├── user.controller.js  # User management logic
│   │   └── item.controller.js  # Item CRUD logic
│   ├── middlewares/
│   │   ├── auth.js             # Authentication middleware
│   │   ├── validate.js         # Validation middleware
│   │   └── errorHandler.js     # Error handling middleware
│   ├── models/
│   │   ├── user.model.js       # User schema
│   │   └── item.model.js       # Item schema
│   ├── routes/
│   │   ├── index.js            # Route aggregator
│   │   ├── auth.routes.js      # Authentication routes
│   │   ├── user.routes.js      # User routes
│   │   └── item.routes.js      # Item routes
│   ├── utils/
│   │   ├── logger.js           # Winston logger
│   │   ├── jwt.js              # JWT utilities
│   │   ├── appError.js         # Custom error class
│   │   └── catchAsync.js       # Async error wrapper
│   ├── app.js                  # Express app setup
│   └── server.js               # Server entry point
├── logs/                       # Application logs
├── tests/                      # Test files
├── .env.example                # Example environment variables
├── .gitignore                  # Git ignore file
├── package.json                # Dependencies and scripts
└── README.md                   # This file
```

## 🛠️ Installation

### Prerequisites

- Node.js 16+ and npm 8+
- MongoDB (local or cloud instance)

### Setup

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd Node-Server
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   copy .env.example .env
   # Edit .env with your configuration
   ```

4. **Start MongoDB**
   Make sure MongoDB is running on your system or update the `MONGODB_URI` in `.env`

## 🚀 Running the Server

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

The server will start at `http://localhost:3000`

## 📚 API Documentation

### Base URL
```
http://localhost:3000/api/v1
```

### Authentication Endpoints

#### Register a new user
```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "username": "johndoe",
  "password": "securepassword123",
  "fullName": "John Doe"
}
```

#### Login
```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

Response:
```json
{
  "status": "success",
  "data": {
    "user": {
      "id": "...",
      "email": "user@example.com",
      "username": "johndoe",
      "fullName": "John Doe"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### Refresh Token
```http
POST /api/v1/auth/refresh-token
Content-Type: application/json

{
  "refreshToken": "your-refresh-token"
}
```

#### Logout
```http
POST /api/v1/auth/logout
```

### User Endpoints

All user endpoints require authentication. Include the JWT token in the Authorization header:
```
Authorization: Bearer <your-token>
```

#### Get current user
```http
GET /api/v1/users/me
```

#### Update current user
```http
PUT /api/v1/users/me
Content-Type: application/json

{
  "email": "newemail@example.com",
  "username": "newusername",
  "fullName": "New Name"
}
```

#### Get all users
```http
GET /api/v1/users?page=1&limit=10
```

#### Get user by ID
```http
GET /api/v1/users/:id
```

#### Delete user
```http
DELETE /api/v1/users/:id
```

### Item Endpoints

All item endpoints require authentication.

#### Get all items
```http
GET /api/v1/items?page=1&limit=10
```

#### Create item
```http
POST /api/v1/items
Content-Type: application/json

{
  "title": "My Item",
  "description": "Item description"
}
```

#### Get item by ID
```http
GET /api/v1/items/:id
```

#### Update item
```http
PUT /api/v1/items/:id
Content-Type: application/json

{
  "title": "Updated Title",
  "description": "Updated description"
}
```

#### Delete item
```http
DELETE /api/v1/items/:id
```

## 🧪 Testing

Run tests with Jest:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

## 🔧 Configuration

Edit `.env` file to configure:

- `NODE_ENV`: Environment (development/production)
- `PORT`: Server port
- `MONGODB_URI`: MongoDB connection string
- `JWT_SECRET`: Secret key for JWT tokens
- `JWT_EXPIRES_IN`: Token expiration time
- `JWT_REFRESH_SECRET`: Secret key for refresh tokens
- `JWT_REFRESH_EXPIRES_IN`: Refresh token expiration time
- `CORS_ORIGIN`: Allowed CORS origins

## 📝 Scripts

- `npm start`: Start production server
- `npm run dev`: Start development server with nodemon
- `npm test`: Run tests
- `npm run test:watch`: Run tests in watch mode
- `npm run lint`: Run ESLint
- `npm run lint:fix`: Fix ESLint errors

## 🔒 Security Features

- **Helmet**: Sets various HTTP headers for security
- **CORS**: Configurable Cross-Origin Resource Sharing
- **Rate Limiting**: Prevents brute-force attacks
- **Password Hashing**: Bcrypt for secure password storage
- **JWT Authentication**: Secure token-based authentication
- **Input Validation**: Express-validator for request validation

## 🐳 Docker Support (Optional)

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t node-backend-server .
docker run -p 3000:3000 node-backend-server
```

## 📝 License

This project is open source and available under the [MIT License](LICENSE).

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

## 👤 Author

**HB House**
- Email: code@hbhouse.space
- Website: www.hbhouse.space

## ⭐ Show your support

Give a ⭐️ if this project helped you!

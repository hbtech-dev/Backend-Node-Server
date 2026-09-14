# Use Node 20 LTS Alpine image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies cleanly
RUN npm install --omit=dev

# Copy application code
COPY . .

# Expose port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Start application
CMD ["npm", "start"]

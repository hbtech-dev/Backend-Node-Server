# Use Node 20 LTS Alpine image for fast, reliable builds
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy application source code
COPY . .

# Expose port (Railway sets PORT dynamically, defaults to 3000)
EXPOSE 3000

# Set Node environment to production
ENV NODE_ENV=production

# Start application
CMD ["npm", "start"]

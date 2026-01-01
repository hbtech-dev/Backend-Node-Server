FROM node:18-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --only=production

COPY . .

RUN mkdir -p logs

EXPOSE 3000

USER node

CMD ["npm", "start"]

# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app

# Install deps first (better caching)
COPY package.json ./
COPY server.mjs ./

# Copy app source
COPY . .

ENV NODE_ENV=production
EXPOSE 8099

# Adjust if your entry differs (server.mjs / index.js / src/server.js)
CMD ["node", "server.mjs"]
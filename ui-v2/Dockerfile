# Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built files
COPY --from=build /app/dist /usr/share/nginx/html

# Create nginx config for SPA
RUN printf '%s\n' \
'server {' \
'  listen 8080;' \
'  server_name _;' \
'  root /usr/share/nginx/html;' \
'  index index.html;' \
'  location / {' \
'    try_files $uri $uri/ /index.html;' \
'  }' \
'  location /v1/ {' \
'    proxy_pass http://rauskuclaw-api:3001/v1/;' \
'    proxy_http_version 1.1;' \
'    proxy_set_header Host $host;' \
'    proxy_set_header X-Real-IP $remote_addr;' \
'    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' \
'    proxy_set_header X-Forwarded-Proto $scheme;' \
'  }' \
'}' > /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
# Build Vue app
FROM node:20-alpine AS build
WORKDIR /ui
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Serve with nginx
FROM nginx:alpine
COPY --from=build /ui/dist /usr/share/nginx/html
# basic nginx config for SPA under /ui/
RUN printf '%s\n' 'server {' '  listen 8080;' '  server_name _;' '  root /usr/share/nginx/html;' '  index index.html;' '  location / {' '    try_files $uri $uri/ /index.html;' '  }' '}' > /etc/nginx/conf.d/default.conf

EXPOSE 8080

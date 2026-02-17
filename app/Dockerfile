FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && update-ca-certificates \
  && printf '%s\n' 'precedence ::ffff:0:0/96 100' >> /etc/gai.conf \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "server.js"]

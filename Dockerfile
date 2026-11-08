FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends php-cli chromium ca-certificates fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir pdfs && chown -R node:node /app
COPY --chown=node:node index.php crawler.js ./
USER node
ENV CHROME_PATH=/usr/bin/chromium REQUIRE_API_KEY=1 PORT=10000
CMD ["sh", "-c", "exec php -S 0.0.0.0:${PORT} /app/index.php"]

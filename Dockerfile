# BI_BOOT_FIX_v62_DOCKERFILE — CMD was pointing to dist/server.js, which
# exports `app` but never calls listen(). The container would start, run
# the file to completion, and exit cleanly. The actual entrypoint with
# app.listen() is dist/index.js.
FROM node:20-alpine

WORKDIR /app

# Layer caching: deps before source.
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

# Build TS -> dist/. Includes both index.js (entrypoint) and server.js
# (Express app factory).
RUN npm install --include=dev && npm run build && npm prune --omit=dev

# Match runtime: env.PORT default in src/platform/env.ts is "8080".
EXPOSE 8080

# Healthcheck hits /health, which is mounted before any auth middleware.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# THE fix: was dist/server.js, must be dist/index.js.
CMD ["node", "dist/index.js"]

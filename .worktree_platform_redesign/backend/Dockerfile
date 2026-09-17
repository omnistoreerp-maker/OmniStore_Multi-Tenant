# DigiTronics Backend — production image
# Build:  docker build -t digitronics-backend .
# Run:    docker run -p 3001:3001 -e JWT_SECRET=change-me digitronics-backend
# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Non-root runtime user
RUN addgroup -S digitronics && adduser -S digitronics -G digitronics

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY config ./config
COPY controllers ./controllers
COPY middleware ./middleware
COPY models ./models
COPY routes ./routes
COPY services ./services
COPY utils ./utils

# JSON persistence lives here; mount a volume at /app/data in production.
RUN mkdir -p /app/data && chown -R digitronics:digitronics /app/data
USER digitronics

ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/v1/health" || exit 1

CMD ["node", "server.js"]

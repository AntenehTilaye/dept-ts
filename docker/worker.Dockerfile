# syntax=docker/dockerfile:1.7
# Node 22 + Chromium (for PDF rendering). Also used by the `test` and `e2e` services.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS dev
RUN apt-get update && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory /app \
 && git config --system core.fileMode false \
 && git config --system core.autocrlf false
WORKDIR /app
ENV NODE_ENV=development
CMD ["npm","run","worker:dev"]

FROM dev AS builder
ENV DATABASE_URL_MIGRATE=postgresql://build:build@db:5432/dept
COPY package.json package-lock.json* prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate && npm run worker:build && npm prune --omit=dev

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/healthcheck.mjs ./apps/worker/healthcheck.mjs
USER pwuser
CMD ["node","apps/worker/dist/index.js"]

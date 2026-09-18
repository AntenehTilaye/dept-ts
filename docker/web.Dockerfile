# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates git \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory /app \
 && git config --system core.fileMode false \
 && git config --system core.autocrlf false \
 && git config --system init.defaultBranch main
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- dev: bind-mounted source, node_modules from the named volume, git available for in-container commits
FROM base AS dev
EXPOSE 3000
CMD ["npm","run","dev"]

# --- deps: installs with the schema present because postinstall runs `prisma generate`.
# prisma.config.ts resolves DATABASE_URL_MIGRATE at load time; generate never connects, so a
# placeholder is enough here and the runtime environment always overrides it.
FROM base AS deps
ENV DATABASE_URL_MIGRATE=postgresql://build:build@db:5432/dept PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json* prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# --- builder: standalone Next build
FROM deps AS builder
COPY . .
ENV NEXT_OUTPUT=standalone
RUN npx prisma generate && npm run build

# --- migrate: one-off `prisma migrate deploy`
FROM base AS migrate
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
CMD ["npx","prisma","migrate","deploy"]

# --- runner: production web image (no Chromium, no git, no dev deps)
FROM node:22-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node","server.js"]

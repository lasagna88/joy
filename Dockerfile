FROM node:20-alpine AS base

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Build the app
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production runner for BullMQ worker
FROM base AS worker
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

CMD ["npx", "tsx", "src/worker/index.ts"]

# Production runner for Next.js (default target — must be last)
FROM base AS app
WORKDIR /app
ENV NODE_ENV=production

# Copy drizzle config + schema for migration on startup
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src/lib/db ./src/lib/db
COPY --from=builder /app/package.json ./package.json

# Copy Next.js standalone app
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Startup script: run migration then start server
COPY --from=builder /app/scripts/start.sh ./start.sh
RUN chmod +x start.sh

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["sh", "start.sh"]

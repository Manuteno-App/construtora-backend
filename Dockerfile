# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20 AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

# ── Stage 2: production ──────────────────────────────────────────────────────
FROM node:20 AS production
WORKDIR /app

# Copy all node_modules from builder (includes native addons + devDeps for
# typeorm-ts-node-commonjs migrations)
COPY --from=builder /app/node_modules ./node_modules

# Compiled application
COPY --from=builder /app/dist ./dist

# Files required for `npm run migration:run` inside the running container
COPY --from=builder /app/data-source.ts ./data-source.ts
COPY --from=builder /app/src/migrations ./src/migrations
COPY package*.json tsconfig.json tsconfig.build.json ./

# Tesseract trained data for Portuguese OCR
COPY por.traineddata ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/main"]

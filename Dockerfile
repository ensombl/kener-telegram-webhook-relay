# Multi-stage build for kener-telegram-relay
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Build the TypeScript source
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:22-alpine AS runner
WORKDIR /app
RUN corepack enable && apk add --no-cache curl
ENV NODE_ENV=production

# Copy pruned node_modules and compiled output
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json pnpm-lock.yaml ./

EXPOSE 3000
CMD ["node", "dist/index.js"]

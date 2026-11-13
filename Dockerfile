FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080

# Migrations must not block the listen. A slow database would leave the port closed and the Worker would throw.
CMD sh -c "node scripts/migrate.mjs & exec node --experimental-strip-types server/index.ts"

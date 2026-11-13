FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080

# The port has to open before migrations. The first database request applies them, then writes the admin hash.
CMD ["node", "--experimental-strip-types", "server/index.ts"]

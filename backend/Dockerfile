FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./
RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --chown=app:app package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=app:app --from=build /app/dist ./dist
COPY --chown=app:app --from=build /app/migrations ./migrations

USER app

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -T 5 --spider "http://localhost:${PORT:-4000}/health" || exit 1

CMD ["node", "dist/index.js"]

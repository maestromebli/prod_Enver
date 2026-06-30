FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install --prefix server --omit=dev
RUN npm install --prefix client

FROM node:26-alpine AS build
WORKDIR /app
ARG APP_BUILD_SHA=dev
ENV APP_BUILD_SHA=${APP_BUILD_SHA}
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/client/node_modules ./client/node_modules
COPY server ./server
COPY client ./client
COPY shared ./shared
COPY scripts/inject-app-build.mjs ./scripts/inject-app-build.mjs
RUN node scripts/inject-app-build.mjs && npm run build --prefix client

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
RUN apk add --no-cache python3 py3-pip su-exec poppler-utils
RUN addgroup -S enver && adduser -S enver -G enver

COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/client/dist ./client/dist
COPY releases/ ./releases/
COPY tools/b3d-converter ./tools/b3d-converter
COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN pip3 install --no-cache-dir --break-system-packages ./tools/b3d-converter \
  && chmod +x /docker-entrypoint.sh

ENV B3D_CONVERTER_PYTHON=python3
ENV PYTHONPATH=/app/tools/b3d-converter

EXPOSE 3000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server/src/index.js"]

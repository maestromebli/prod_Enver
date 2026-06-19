FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install --prefix server --omit=dev
RUN npm install --prefix client

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/client/node_modules ./client/node_modules
COPY server ./server
COPY client ./client
RUN npm run build --prefix client

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
RUN addgroup -S enver && adduser -S enver -G enver

COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist
COPY releases/ ./releases/

USER enver
EXPOSE 3000
CMD ["node", "server/src/index.js"]

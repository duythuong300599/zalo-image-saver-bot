# Node 20 is EOL 2026-04-30; using 24 (current Active LTS) instead of the
# node:20-alpine originally sketched in planning. Parameterized via ARG so
# the image can be bumped with a single build-arg change.
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=3000 SAVE_DIR=/data/images
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --chown=node:node package.json ./
RUN mkdir -p /data/images && chown -R node:node /data
USER node
EXPOSE 3000
# busybox wget ships with alpine — no need to install curl just for this.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
CMD ["node", "build/server.js"]

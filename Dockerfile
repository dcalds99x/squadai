# syntax=docker/dockerfile:1.7
# One Dockerfile, two images:
#   --target web     Next.js standalone server
#   --target worker  job worker; also runs database migrations
ARG NODE_VERSION=24-alpine

FROM node:${NODE_VERSION} AS base
RUN npm install -g pnpm@10.34.9
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Package manifests only, so dependency layers are cached until they change.
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/catalog/package.json packages/catalog/
COPY packages/db/package.json packages/db/
COPY packages/engine/package.json packages/engine/
COPY packages/providers/package.json packages/providers/
COPY packages/ui/package.json packages/ui/

FROM manifests AS build
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @squadai/web build

FROM node:${NODE_VERSION} AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# The worker runs TypeScript directly with Node's type stripping (no build step),
# with production dependencies only.
FROM manifests AS worker
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@squadai/worker..."
COPY apps/worker apps/worker
COPY packages packages
ENV NODE_ENV=production
USER node
CMD ["node", "apps/worker/src/index.ts"]

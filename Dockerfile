FROM node:26.9-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.js ./
COPY apps ./apps
COPY packages ./packages
COPY services ./services

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:26.9-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable \
    && groupadd --system policygos \
    && useradd --system --gid policygos --home-dir /app policygos \
    && mkdir -p /var/lib/policygos/audit \
    && chown -R policygos:policygos /var/lib/policygos

COPY --from=build --chown=policygos:policygos /app /app

USER policygos
EXPOSE 8787
CMD ["node", "apps/policygos-openui/server-dist/index.js"]

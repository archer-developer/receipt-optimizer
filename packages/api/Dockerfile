FROM node:20-slim AS base
RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/database/package.json ./packages/database/
COPY packages/api/package.json ./packages/api/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/database ./packages/database
COPY packages/api ./packages/api

EXPOSE 3000

CMD ["pnpm", "--filter", "api", "dev"]

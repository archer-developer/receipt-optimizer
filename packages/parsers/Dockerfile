FROM node:20-slim AS base
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/database/package.json ./packages/database/
COPY packages/parsers/package.json ./packages/parsers/

RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/database ./packages/database
COPY packages/parsers ./packages/parsers

# Default entrypoint — override CMD to run a specific parser
CMD ["pnpm", "--filter", "@receipt-optimizer/parsers", "parse:green"]

FROM node:24-alpine

# Build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install deps (cached layer)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
ENV CI=true
RUN pnpm install --frozen-lockfile

# Build + copy source
COPY . .
RUN pnpm run build

# Remove devDeps for smaller image
RUN pnpm prune --prod

CMD ["node", "dist/main.js", "--mode=all"]

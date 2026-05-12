FROM node:22-slim

# Install pnpm + build tools for native modules (better-sqlite3)
RUN corepack enable && \
    apt-get update && \
    apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod=false

COPY . .
RUN pnpm run build

CMD ["node", "dist/main.js", "--mode=all"]

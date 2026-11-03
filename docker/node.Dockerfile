# api + web image
FROM node:22-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/director/package.json packages/director/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

FROM base AS api
ENV NODE_ENV=production
CMD ["npm", "run", "start", "-w", "@autoreel/api"]

FROM base AS web
ARG API_URL=http://api:4000
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV API_URL=$API_URL NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @autoreel/web
CMD ["npm", "run", "start", "-w", "@autoreel/web"]

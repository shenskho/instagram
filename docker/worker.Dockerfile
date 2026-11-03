# worker image: Node (job runner) + Python engine + ffmpeg + models
FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ffmpeg libraqm0 libfribidi0 \
 && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
WORKDIR /app
COPY packages/engine /app/packages/engine
RUN pip install --no-cache-dir "/app/packages/engine[stt-local]" \
 && bash /app/packages/engine/scripts/fetch_assets.sh /opt/autoedit-assets
ENV AUTOEDIT_ASSETS=/opt/autoedit-assets
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/director/package.json packages/director/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund --workspace @autoreel/worker --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/director packages/director
COPY apps/worker apps/worker
CMD ["npm", "run", "start", "-w", "@autoreel/worker"]

# worker image: Node (job runner) + Python engine + ffmpeg + models + local image generator

# stable-diffusion.cpp command line (CPU). The source comes from PyPI (stable-diffusion-cpp-python bundles it).
FROM node:22-bookworm AS sdcpp
ARG SDCPP_PY_VERSION=0.4.7
RUN apt-get update && apt-get install -y --no-install-recommends cmake python3-pip && rm -rf /var/lib/apt/lists/*
RUN pip3 download --break-system-packages --no-deps --no-binary :all: "stable-diffusion-cpp-python==${SDCPP_PY_VERSION}" -d /tmp/sd \
 && tar -xzf /tmp/sd/stable_diffusion_cpp_python-*.tar.gz -C /tmp/sd \
 && cd /tmp/sd/stable_diffusion_cpp_python-*/vendor/stable-diffusion.cpp \
 && cmake -B build -DCMAKE_BUILD_TYPE=Release -DSD_BUILD_EXAMPLES=ON -DSD_WEBP=OFF -DSD_WEBM=OFF \
      -DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON \
 && cmake --build build --config Release -j "$(nproc)" --target sd-cli \
 && cp build/bin/sd-cli /usr/local/bin/sd-cli && rm -rf /tmp/sd

FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ffmpeg libraqm0 libfribidi0 \
 && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
WORKDIR /app
COPY packages/engine /app/packages/engine
RUN pip install --no-cache-dir "/app/packages/engine[stt-local]" resvg-py \
 && bash /app/packages/engine/scripts/fetch_assets.sh /opt/autoedit-assets
ENV AUTOEDIT_ASSETS=/opt/autoedit-assets
COPY --from=sdcpp /usr/local/bin/sd-cli /usr/local/bin/sd-cli
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

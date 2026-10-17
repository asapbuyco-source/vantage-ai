# Vantage AI backend — Node.js + Python in one image.
# The Express server spawns the Python quant pipeline as a subprocess, so both
# runtimes must be present at RUNTIME (Nixpacks installed Python build-only).
FROM node:22-slim

# Python 3 for the quant engine
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-dev build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node deps first (better layer caching). Full install so the Vite build works.
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

# App source
COPY . .

# Python deps for the quant pipeline
RUN pip3 install --no-cache-dir --break-system-packages -r backend/quant/requirements.txt \
    || pip3 install --no-cache-dir -r backend/quant/requirements.txt

# Build the SPA so the SSR catch-all can serve dist/index.html (VITE_* vars are
# injected by Railway at build time). Non-fatal: the API still works without it.
RUN npm run build || echo "frontend build skipped (API + scheduler still run)"

ENV NODE_ENV=production
ENV PYTHON_BIN=/usr/bin/python3
EXPOSE 8080
CMD ["node", "server.js"]

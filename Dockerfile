# Vantage AI backend — Node.js + Python in one image.
# The Express server spawns the Python quant pipeline as a subprocess, so both
# runtimes must be present at RUNTIME (Nixpacks installed Python build-only).
FROM node:22-slim

# Python 3 for the quant engine
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-dev build-essential ca-certificates curl \
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

# Build-time config for the Vite SPA. Render (and Railway) inject service env
# vars as Docker build args; declare them here so `vite build` can see them.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_MEASUREMENT_ID
ARG VITE_FIREBASE_VAPID_KEY
ARG VITE_BACKEND_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_SELAR_DAILY_LINK
ARG VITE_SELAR_WEEKLY_LINK
ARG VITE_SELAR_MONTHLY_LINK
ARG VITE_SELAR_ANNUAL_LINK
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET \
    VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID \
    VITE_FIREBASE_MEASUREMENT_ID=$VITE_FIREBASE_MEASUREMENT_ID \
    VITE_FIREBASE_VAPID_KEY=$VITE_FIREBASE_VAPID_KEY \
    VITE_BACKEND_URL=$VITE_BACKEND_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_SELAR_DAILY_LINK=$VITE_SELAR_DAILY_LINK \
    VITE_SELAR_WEEKLY_LINK=$VITE_SELAR_WEEKLY_LINK \
    VITE_SELAR_MONTHLY_LINK=$VITE_SELAR_MONTHLY_LINK \
    VITE_SELAR_ANNUAL_LINK=$VITE_SELAR_ANNUAL_LINK

# Build the SPA so the SSR catch-all can serve dist/index.html. Non-fatal: the
# API and scheduler still run even if the frontend build fails.
RUN npm run build || echo "frontend build skipped (API + scheduler still run)"

ENV NODE_ENV=production
ENV PYTHON_BIN=/usr/bin/python3
EXPOSE 8080
CMD ["node", "server.js"]

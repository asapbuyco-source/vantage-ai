FROM node:20-bookworm-slim

# xvfb = virtual display so 1xbet's headed check works on a server with no screen
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb ca-certificates wget && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Playwright (not dev — scanner needs it in prod)
COPY package.json ./
RUN npm install --omit=dev
RUN npx playwright install --with-deps chromium

COPY . .

# Never stop: systemd isn't in Railway, but restartPolicyType=ON_FAILURE in railway.toml
# + the infinite --loop keeps it alive. xvfb-run gives headed Chromium a virtual display.
CMD ["xvfb-run", "-a", "node", "arb_scanner_live.js", "--loop=2"]
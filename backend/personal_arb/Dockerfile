FROM node:20-bookworm-slim

# xvfb = virtual display so 1xbet's headed check works on a server with no screen
# xauth required by xvfb-run
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb xauth ca-certificates wget && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Playwright (not dev — scanner needs it in prod)
COPY package.json ./
RUN npm install --omit=dev
RUN npx playwright install --with-deps chromium

COPY . .

RUN chmod +x start.sh

# Never stop: restartPolicyType=ON_FAILURE in railway.toml + infinite --loop keeps it alive.
# xvfb-run gives headed Chromium a virtual display.
CMD ["/bin/bash", "start.sh"]
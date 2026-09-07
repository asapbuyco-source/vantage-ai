#!/usr/bin/env bash
# Vantage Arb Scanner — one-shot server setup (Ubuntu/Debian VPS)
# Run as root or with sudo. Installs everything + starts systemd service.
# After this, the scanner runs forever (auto-restarts on crash/reboot).

set -e

echo "==> 1/6 Installing system deps (node, xvfb, chromium libs)"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get update
apt-get install -y nodejs xvfb git

echo "==> 2/6 Cloning repo (private branch personal/arb)"
if [ ! -d /opt/vantage-ai ]; then
  git clone -b personal/arb https://github.com/asapbuyco-source/vantage-ai.git /opt/vantage-ai
fi
cd /opt/vantage-ai
git checkout personal/arb && git pull

echo "==> 3/6 npm deps + Playwright chromium"
npm install
npm install -D playwright
npx playwright install --with-deps chromium

echo "==> 4/6 .env.local (Telegram secrets)"
if [ ! -f .env.local ]; then
  cat > .env.local <<'EOF'
TELEGRAM_BOT_TOKEN=YOUR_TOKEN_HERE
TELEGRAM_CHAT_ID=YOUR_CHAT_ID_HERE
EOF
fi
echo "    Edit /opt/vantage-ai/.env.local with your real token+chat, then continue."

echo "==> 5/6 Warm profiles (open books once via xvfb so cookies save)"
# Run the warm step manually first so you can verify:
#   cd /opt/vantage-ai && xvfb-run -a node backend/personal_arb/arb_scanner_live.js --warm

echo "==> 6/6 Install systemd service"
cp backend/personal_arb/arb.service /etc/systemd/system/arb.service
sed -i "s/^Environment=TELEGRAM_BOT_TOKEN=.*/Environment=TELEGRAM_BOT_TOKEN=$(grep TELEGRAM_BOT_TOKEN .env.local | cut -d= -f2)/" /etc/systemd/system/arb.service
sed -i "s/^Environment=TELEGRAM_CHAT_ID=.*/Environment=TELEGRAM_CHAT_ID=$(grep TELEGRAM_CHAT_ID .env.local | cut -d= -f2)/" /etc/systemd/system/arb.service
systemctl daemon-reload
systemctl enable arb
systemctl start arb

echo "==> Done. Check:"
echo "    systemctl status arb"
echo "    journalctl -u arb -f"
echo "    (Note: run the --warm step at step 5 once BEFORE starting the service.)"
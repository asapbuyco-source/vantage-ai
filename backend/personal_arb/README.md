# Vantage Personal Arbitrage Scanner

Private tool (branch `personal/arb`) — scans Cameroon bookmakers for cross-book arbitrage.

## Books + markets
| Book | Access | Markets |
|---|---|---|
| betfrenzy.cm | direct fetch | 1X2, DC, AH, O/U (asian) |
| premierbet.com/cm | Playwright list API | 1X2 |
| pmuc.cm | Playwright (cookies) | 1X2 |
| betpawa.cm | Playwright combo-cards | 1X2 (names only) |
| 1xbet.cm / melbet-cm.com | **disabled** — hunt-captcha, needs headed confirm | GetGameZip |

Arb methods: 2-way (O/U, AH), 3-way (1X2, DC), N-way via `arb_calc.js` (`Σ 1/odds < 1`, stake = `(1/odds_i)/Σ × bankroll`).

## Local setup
```
npm i -D playwright
npx playwright install chromium
set TELEGRAM_BOT_TOKEN=...   # from @BotFather
set TELEGRAM_CHAT_ID=...     # from @userinfobot
```

## Run
```
node backend/personal_arb/arb_scanner_live.js --warm   # once: save session cookies (headed)
node backend/personal_arb/arb_scanner_live.js --once    # single scan
node backend/personal_arb/arb_scanner_live.js --loop=3  # poll every 3 min (default)
```

## Server deploy (Linux VPS — runs forever)
1. `sudo bash backend/personal_arb/deploy_server.sh` (installs node, xvfb, chromium, clones `personal/arb`, installs systemd service)
2. Edit `/opt/vantage-ai/.env.local` → real `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`
3. Warm profiles once (1xbet/pmuc/betpawa/premierbet need cookies):
   `cd /opt/vantage-ai && xvfb-run -a node backend/personal_arb/arb_scanner_live.js --warm`
4. `sudo systemctl start arb` — runs `--loop=2` forever, auto-restarts on crash/reboot (systemd `Restart=always`)
5. Watch: `journalctl -u arb -f` | Status: `systemctl status arb`

Why xvfb: 1xbet blocks headless Chromium — xvfb provides a virtual display so headed mode works on a server with no screen. pmuc/betpawa/premierbet headless work after profiles are warmed.

For Railway/Docker instead: `xvfb-run -a node ... --loop=2` as start command, `npx playwright install --with-deps chromium` in build, and warm profiles via a one-time job before serving.

## Telegram
On arb found: `🎯 ARB <market> <pct>% <home> vs <away> [books] <odds> — stake <per-leg>`.
Semi-auto: alert only; place bets manually (books have no retail API; automation violates ToS).

## Notes
- Cross-book filter enforced — same-book line mismatches are voided by bookmakers, not arbs.
- Real arbs cluster in the last minutes before kickoff; breadth < latency.
- `.env.local` (Telegram secrets) is gitignored.
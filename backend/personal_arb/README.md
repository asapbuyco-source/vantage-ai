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

## Server deploy (Linux VPS / Railway)
1. Copy repo to server (private branch), `npm i -D playwright`, `npx playwright install --with-deps chromium`
2. Warm cookies once: run `--warm` on the server via `xvfb-run` (virtual display) or copy `.playwright_profile` from a local `--warm`
3. `pm2 start "node backend/personal_arb/arb_scanner_live.js --loop=2" --name arb`
   (or `systemd`: see `arb.service`)
4. Keep server close to books (EU/Africa) + use `--loop=1` pre-kickoff for best latency

## Telegram
On arb found: `🎯 ARB <market> <pct>% <home> vs <away> [books] <odds> — stake <per-leg>`.
Semi-auto: alert only; place bets manually (books have no retail API; automation violates ToS).

## Notes
- Cross-book filter enforced — same-book line mismatches are voided by bookmakers, not arbs.
- Real arbs cluster in the last minutes before kickoff; breadth < latency.
- `.env.local` (Telegram secrets) is gitignored.
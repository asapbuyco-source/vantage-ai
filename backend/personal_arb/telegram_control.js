/**
 * telegram_control.js — owner-only Telegram control for the arb scanner.
 * Lets you change per-book stake anchors, the ROI floor, and view status
 * WITHOUT touching the server:
 *
 *   amount betpawa 30000      set betpawa stake anchor to 30,000 XAF
 *   amount all 20000          set every book to 20,000 XAF
 *   amounts / status          show current anchors + floor
 *   minroi 2                  alert floor = 2% worst-case ROI
 *   help                      command list
 *
 * Slashes are optional; "frs"/"f"/commas in amounts are stripped.
 * ONLY the configured TELEGRAM_CHAT_ID can issue commands.
 * Config persists to bot_config.json (gitignored).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.ARB_BOT_CONFIG || path.join(__dirname, 'bot_config.json');

export const DEFAULT_BANKROLL = 10000;

const DEFAULT_CONFIG = {
  bankrolls: {},       // book -> XAF stake anchor (per leg on that book)
  min_roi: 0.01,       // alert floor: worst-case ROI must be >= this
  last_update_id: 0,   // Telegram getUpdates offset (persisted)
};

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return { ...DEFAULT_CONFIG, ...saved, bankrolls: { ...(saved.bankrolls || {}) } };
    }
  } catch (e) {
    console.log(`[BotCtl] config load error: ${e.message.slice(0, 80)}`);
  }
  return { ...DEFAULT_CONFIG, bankrolls: {} };
}

export const config = loadConfig();

export function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.log(`[BotCtl] config save error: ${e.message.slice(0, 80)}`);
  }
}

const BOOK_ALIASES = {
  betfrenzy: 'betfrenzy', bf: 'betfrenzy', 'betfrenzy.cm': 'betfrenzy',
  betpawa: 'betpawa', betpwaa: 'betpawa', betpwa: 'betpawa', bp: 'betpawa', 'bet pawa': 'betpawa',
  pmuc: 'pmuc', 'pmuc.cm': 'pmuc',
  premierbet: 'premierbet', pb: 'premierbet', 'premier bet': 'premierbet',
  '1xbet': '1xbet', '1x': '1xbet',
  betwinner: 'betwinner', bw: 'betwinner',
  paripesa: 'paripesa', pp: 'paripesa',
};
export const KNOWN_BOOKS = [...new Set(Object.values(BOOK_ALIASES))];

function resolveBook(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (t === 'all') return 'all';
  return BOOK_ALIASES[t] || null;
}

function parseAmount(raw) {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function statusLines() {
  const lines = ['💰 Stake anchors (per leg, per book):'];
  for (const b of KNOWN_BOOKS.sort()) {
    lines.push(`  ${b}: ${(config.bankrolls[b] ?? DEFAULT_BANKROLL).toLocaleString()} XAF`);
  }
  lines.push(`📉 Alert floor: ${(config.min_roi * 100).toFixed(1)}% worst-case ROI`);
  lines.push('Send "help" for commands.');
  return lines.join('\n');
}

const HELP = [
  '🎛️ Arb Bot Control',
  'amount <book> <XAF> — set per-book stake anchor',
  '    e.g. "amount betpawa 30000" (or /amount betpawa 30000)',
  'amount all <XAF> — set every book',
  'amounts — show all anchors',
  'minroi <pct> — alert floor (e.g. "minroi 2" = 2% worst-case)',
  'status — full status',
  'help — this message',
  '',
  'Alerts show real stakes scaled from the anchor book amount.',
].join('\n');

export function handleMessage(text) {
  const lower = String(text || '').trim().toLowerCase();
  if (!lower) return null;

  // amount <book|all> <n>  (slashes and "set" optional, "frs" stripped by parseAmount)
  let m = lower.match(/^(?:\/)?(?:set\s+)?amount\s+(.+?)\s+([\d\s.,]+)$/);
  if (m) {
    const book = resolveBook(m[1]);
    const amount = parseAmount(m[2]);
    if (!book || !amount) return 'Usage: amount <book|all> <XAF> — e.g. "amount betpawa 30000"';
    if (book === 'all') {
      for (const b of KNOWN_BOOKS) config.bankrolls[b] = amount;
      saveConfig();
      return `✅ All books stake anchor = ${amount.toLocaleString()} XAF`;
    }
    config.bankrolls[book] = amount;
    saveConfig();
    return `✅ ${book} stake anchor = ${amount.toLocaleString()} XAF — next ${book} alerts use it`;
  }

  m = lower.match(/^(?:\/)?(?:set\s+)?minroi\s+([\d.]+)$/);
  if (m) {
    const pct = parseFloat(m[1]);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 50) return 'Usage: minroi <pct> — e.g. "minroi 2" (2% floor)';
    config.min_roi = pct / 100;
    saveConfig();
    return `✅ Alert floor = ${pct}% worst-case ROI`;
  }

  if (lower.includes('amounts') || lower === 'status' || lower === 'status ' || lower === '/status') {
    return statusLines();
  }
  if (lower === 'help' || lower === '/help') return HELP;

  if (!lower.startsWith('/')) {
    return 'Unknown command. Try: "amount betpawa 30000" | "amounts" | "minroi 2" | "help"';
  }
  return null;
}

/**
 * Scale calcArb's 100-unit stakes to REAL stakes for the user's configured
 * bankroll. The anchor is the first leg whose book has a configured amount:
 * that book's leg gets exactly the configured XAF, the other leg is derived
 * so the payout ratio stays identical. Stakes round to the nearest 50 XAF.
 */
export function scaleStakes(legs) {
  const anchorIdx = legs.findIndex(l => config.bankrolls[l.book]);
  if (anchorIdx === -1) return legs; // no anchors configured — keep 100-unit scale
  const anchorAmount = config.bankrolls[legs[anchorIdx].book];
  const share = parseFloat(legs[anchorIdx].stake) / 100;
  if (!(share > 0)) return legs;
  const total = anchorAmount / share;
  return legs.map(l => {
    const share_i = parseFloat(l.stake) / 100;
    const stake = Math.max(50, Math.round((share_i * total) / 50) * 50);
    return { ...l, stake, payout: Math.round(stake * l.odds) };
  });
}

export function totalStake(legs) {
  return legs.reduce((s, l) => s + Number(l.stake || 0), 0);
}

/**
 * Long-poll Telegram updates and process owner commands. Runs forever —
 * call it only in loop mode (not --once/--diag, which should exit).
 */
export function startTelegramControl() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const owner = String(process.env.TELEGRAM_CHAT_ID || '');
  if (!token || !owner) {
    console.log('[BotCtl] no TELEGRAM_BOT_TOKEN/CHAT_ID — Telegram control disabled');
    return;
  }
  const API = `https://api.telegram.org/bot${token}`;
  const send = async (text) => {
    try {
      await fetch(`${API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: owner, text, disable_web_page_preview: true }),
      });
    } catch (e) {
      console.log(`[BotCtl] send failed: ${e.message.slice(0, 80)}`);
    }
  };
  const poll = async () => {
    for (;;) {
      try {
        const r = await fetch(`${API}/getUpdates?offset=${config.last_update_id + 1}&timeout=25`, {
          signal: AbortSignal.timeout(40000),
        });
        const j = await r.json();
        if (!j.ok) { await new Promise(res => setTimeout(res, 3000)); continue; }
        for (const u of j.result || []) {
          if (u.update_id > config.last_update_id) config.last_update_id = u.update_id;
          const msg = u.message || u.edited_message || u.channel_post;
          if (!msg) continue;
          const chatId = String(msg.chat?.id ?? '');
          if (chatId !== owner) continue; // owner-only
          const reply = handleMessage(msg.text);
          if (reply) await send(reply);
        }
        saveConfig(); // persist last_update_id
      } catch (e) {
        console.log(`[BotCtl] poll error: ${e.message.slice(0, 90)}`);
        await new Promise(res => setTimeout(res, 3000));
      }
    }
  };
  poll();
  console.log('[BotCtl] Telegram control listening (owner-only)…');
}
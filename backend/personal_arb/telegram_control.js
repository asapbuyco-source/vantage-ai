/**
 * telegram_control.js — owner-only Telegram control for the arb scanner,
 * driven by INLINE KEYBOARD BUTTONS (text commands still work as fallback).
 *
 * Flow:
 *   💰 Amount  → pick book (or All) → bot prompts "send the amount" → you type it
 *   📉 Min ROI → bot prompts the %  → you type it
 *   📊 Status / ❓ Help / ↩️ Menu
 *
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
  recipients: [],      // [{ id, name, addedAt }] — signal recipients (owner + these)
};

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return {
        ...DEFAULT_CONFIG, ...saved,
        bankrolls: { ...(saved.bankrolls || {}) },
        recipients: Array.isArray(saved.recipients) ? saved.recipients : [],
      };
    }
  } catch (e) {
    console.log(`[BotCtl] config load error: ${e.message.slice(0, 80)}`);
  }
  return { ...DEFAULT_CONFIG, bankrolls: {}, recipients: [] };
}

export const config = loadConfig();

export function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.log(`[BotCtl] config save error: ${e.message.slice(0, 80)}`);
  }
}

// ── Pending-input state machine ──────────────────────────────────────────────
// After a button prompt ("send the amount for betpawa"), the next plain message
// from the owner is consumed as the value. Expires so a random later message is
// never eaten by a stale prompt.
const PENDING_TTL_MS = 5 * 60 * 1000;
const pendingInput = { type: null, book: null, at: 0 };

const btn = (text, data) => ({ text, callback_data: data });

const MENU_KEYBOARD = {
  inline_keyboard: [
    [btn('💰 Amount', 'amount')],
    [btn('📉 Min ROI', 'minroi')],
    [btn('👥 Subscribers', 'subs')],
    [btn('📊 Status', 'status'), btn('❓ Help', 'help')],
  ],
};

function subsKeyboard() {
  return {
    inline_keyboard: [
      [btn('➕ Add subscriber', 'subs:add')],
      [btn('📋 List', 'subs:list'), btn('➖ Remove', 'subs:remove')],
      [btn('↩️ Menu', 'menu')],
    ],
  };
}

function removeKeyboard() {
  const rows = config.recipients.map(r => [btn(`➖ ${r.name || r.id}`, `subs:remove:${r.id}`)]);
  rows.push([btn('↩️ Menu', 'menu')]);
  return { inline_keyboard: rows };
}

function bookKeyboard() {
  return {
    inline_keyboard: [
      [btn('All books', 'amount:all')],
      [btn('BetFrenzy', 'amount:betfrenzy'), btn('BetPawa', 'amount:betpawa')],
      [btn('PMUC', 'amount:pmuc'), btn('PremierBet', 'amount:premierbet')],
      [btn('1xBet', 'amount:1xbet'), btn('BetWinner', 'amount:betwinner'), btn('PariPesa', 'amount:paripesa')],
      [btn('↩️ Menu', 'menu')],
    ],
  };
}

function backKeyboard() {
  return { inline_keyboard: [[btn('↩️ Menu / Cancel', 'menu')]] };
}

const MENU_TEXT = [
  '🎛️ Arb Bot Control',
  'Tap a button — or type commands directly:',
  '"amount betpawa 30000" | "minroi 2" | "amounts" | "list"',
].join('\n');

function statusLines() {
  const lines = ['💰 Stake anchors (per leg, per book):'];
  for (const b of KNOWN_BOOKS.sort()) {
    lines.push(`  ${b}: ${(config.bankrolls[b] ?? DEFAULT_BANKROLL).toLocaleString()} XAF`);
  }
  lines.push(`📉 Alert floor: ${(config.min_roi * 100).toFixed(1)}% worst-case ROI`);
  lines.push(`👥 Subscribers: ${config.recipients.length ? config.recipients.map(r => `${r.name || r.id} (${r.id})`).join(', ') : 'none'}`);
  return lines.join('\n');
}

const SUBS_HELP = [
  '👥 Subscribers receive every signal (share ratios, not your personal stakes).',
  '➕ Add — forward me any message from the person, or send "add <chatId> <name>".',
  '📋 List — show current subscribers.',
  '➖ Remove — pick who to drop.',
  '⚠️ Every subscriber betting the same arb raises the syndicate pattern for the books.',
].join('\n');

const HELP = [
  '🎛️ Arb Bot Control',
  'Buttons do everything; text commands also work:',
  'amount <book|all> <XAF> — set per-book stake anchor',
  '    e.g. "amount betpawa 30000"',
  'amounts — show all anchors',
  'minroi <pct> — alert floor (e.g. "minroi 2" = 2% worst-case)',
  'status — full status',
  'Alerts show real stakes scaled from the anchor book amount.',
].join('\n');

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

export function handleMessage(text) {
  const lower = String(text || '').trim().toLowerCase();
  if (!lower) return null;

  // add <chatId> <name> — manual subscriber add (owner-only path via chat filter)
  let m = String(text || '').match(/^(?:\/)?add\s+(\d+)\s+(.+)$/i);
  if (m) {
    const id = m[1];
    const name = m[2].trim();
    if (!config.recipients.some(r => r.id === id)) {
      config.recipients.push({ id, name: name.slice(0, 40), addedAt: new Date().toISOString() });
      saveConfig();
      return `✅ Added subscriber ${name} (${id}) — they now get every signal (share ratios).`;
    }
    return `ℹ️ ${name || id} is already a subscriber.`;
  }

  if (lower === 'list' || lower === '/list' || lower.includes('subscribers')) {
    if (!config.recipients.length) return '👥 No subscribers yet. Use ➕ Add (or "add <chatId> <name>").';
    return '👥 Subscribers:\n' + config.recipients.map(r => `  • ${r.name || r.id} (${r.id}) — added ${(r.addedAt || '').slice(0, 10)}`).join('\n');
  }

  let m2 = lower.match(/^(?:\/)?(?:set\s+)?amount\s+(.+?)\s+([\d\s.,]+)$/);
  if (m2) {
    const book = resolveBook(m2[1]);
    const amount = parseAmount(m2[2]);
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

  m2 = lower.match(/^(?:\/)?(?:set\s+)?minroi\s+([\d.,]+)$/);
  if (m2) {
    const pct = parseFloat(m2[1].replace(',', '.'));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 50) return 'Usage: minroi <pct> — e.g. "minroi 2" (2% floor)';
    config.min_roi = pct / 100;
    saveConfig();
    return `✅ Alert floor = ${pct}% worst-case ROI`;
  }

  if (lower.includes('amounts') || lower === 'status' || lower === '/status') return statusLines();
  if (lower === 'help' || lower === '/help') return HELP;

  if (!lower.startsWith('/')) {
    return 'Unknown command. Try: "amount betpawa 30000" | "amounts" | "minroi 2" | "list" | "help"';
  }
  return null;
}

// ── Button (callback_query) handling ─────────────────────────────────────────
export function handleCallback(data) {
  const d = String(data || '');
  if (d === 'menu') return { text: MENU_TEXT, keyboard: MENU_KEYBOARD };
  if (d === 'status') return { text: statusLines(), keyboard: MENU_KEYBOARD };
  if (d === 'help') return { text: HELP, keyboard: MENU_KEYBOARD };
  if (d === 'amount') return { text: 'Choose the book to set its stake anchor:', keyboard: bookKeyboard() };
  if (d.startsWith('amount:')) {
    const book = d.slice(7);
    pendingInput.type = 'amount';
    pendingInput.book = book;
    pendingInput.at = Date.now();
    const label = book === 'all' ? 'ALL books' : book;
    return { text: `Send the amount for ${label} (XAF):\n\n(send "cancel" to abort)`, keyboard: backKeyboard() };
  }
  if (d === 'minroi') {
    pendingInput.type = 'minroi';
    pendingInput.book = null;
    pendingInput.at = Date.now();
    return { text: 'Send the minimum ROI % (1–50):\n\n(send "cancel" to abort)', keyboard: backKeyboard() };
  }
  if (d === 'subs') return { text: SUBS_HELP, keyboard: subsKeyboard() };
  if (d === 'subs:list') {
    const txt = config.recipients.length
      ? '👥 Subscribers:\n' + config.recipients.map(r => `  • ${r.name || r.id} (${r.id}) — added ${(r.addedAt || '').slice(0, 10)}`).join('\n')
      : '👥 No subscribers yet.';
    return { text: txt, keyboard: subsKeyboard() };
  }
  if (d === 'subs:add') {
    pendingInput.type = 'adduser';
    pendingInput.book = null;
    pendingInput.at = Date.now();
    return {
      text: '➕ Add a subscriber:\nOption 1 — FORWARD me any message from them (best).\nOption 2 — send: add <chatId> <name>\n\n(send "cancel" to abort)',
      keyboard: backKeyboard(),
    };
  }
  if (d === 'subs:remove') {
    if (!config.recipients.length) return { text: '👥 No subscribers to remove.', keyboard: subsKeyboard() };
    return { text: '➖ Pick who to remove:', keyboard: removeKeyboard() };
  }
  if (d.startsWith('subs:remove:')) {
    const id = d.slice('subs:remove:'.length);
    const idx = config.recipients.findIndex(r => r.id === id);
    if (idx === -1) return { text: 'ℹ️ Not a subscriber anymore.', keyboard: subsKeyboard() };
    const [removed] = config.recipients.splice(idx, 1);
    saveConfig();
    return { text: `✅ Removed ${removed.name || removed.id} — no longer receives signals.`, keyboard: subsKeyboard() };
  }
  return null;
}

// Consume the owner's next message as the prompted value.
// `msg` may be the raw Telegram message object (for forward_from) or a string.
export function handlePendingInput(msg) {
  const raw = typeof msg === 'string' ? msg : (msg?.text ?? '');
  const lower = String(raw).trim().toLowerCase();
  if (lower === 'cancel' || lower === 'menu' || lower === 'abort') {
    pendingInput.type = null;
    return { text: MENU_TEXT, keyboard: MENU_KEYBOARD };
  }
  if (pendingInput.type === 'adduser') {
    const forward = typeof msg === 'object' ? msg?.forward_from : null;
    if (forward && forward.id) {
      const id = String(forward.id);
      if (config.recipients.some(r => r.id === id)) {
        pendingInput.type = null;
        return { text: `ℹ️ ${forward.first_name || id} is already a subscriber.`, keyboard: subsKeyboard() };
      }
      const fullName = ((forward.first_name || '') + (forward.last_name ? ' ' + forward.last_name : '')).trim();
      config.recipients.push({ id, name: fullName, addedAt: new Date().toISOString() });
      saveConfig();
      pendingInput.type = null;
      return { text: `✅ Added subscriber ${fullName || id} (${id}) — they now get every signal (share ratios).`, keyboard: subsKeyboard() };
    }
    const m = String(raw || '').match(/^(?:\/)?add\s+(\d+)\s+(.+)$/i);
    if (m) {
      const id = m[1];
      const name = m[2].trim();
      if (config.recipients.some(r => r.id === id)) {
        pendingInput.type = null;
        return { text: `ℹ️ ${name || id} is already a subscriber.`, keyboard: subsKeyboard() };
      }
      config.recipients.push({ id, name: name.slice(0, 40), addedAt: new Date().toISOString() });
      saveConfig();
      pendingInput.type = null;
      return { text: `✅ Added subscriber ${name} (${id}) — they now get every signal (share ratios).`, keyboard: subsKeyboard() };
    }
    return { text: 'That didn\'t work. FORWARD me a message from the person, or send: add <chatId> <name>\n\n(send "cancel" to abort)', keyboard: backKeyboard() };
  }
  if (pendingInput.type === 'amount') {
    const amount = parseAmount(text);
    if (!amount) return { text: 'Invalid amount — send a number (e.g. 30000):', keyboard: backKeyboard() };
    const book = pendingInput.book;
    if (book === 'all') {
      for (const b of KNOWN_BOOKS) config.bankrolls[b] = amount;
      saveConfig();
      pendingInput.type = null;
      return { text: `✅ All books stake anchor = ${amount.toLocaleString()} XAF`, keyboard: MENU_KEYBOARD };
    }
    config.bankrolls[book] = amount;
    saveConfig();
    pendingInput.type = null;
    return { text: `✅ ${book} stake anchor = ${amount.toLocaleString()} XAF — next ${book} alerts use it`, keyboard: MENU_KEYBOARD };
  }
  if (pendingInput.type === 'minroi') {
    const pct = parseFloat(String(raw || '').replace(',', '.'));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 50) {
      return { text: 'Invalid — send a % between 1 and 50:', keyboard: backKeyboard() };
    }
    config.min_roi = pct / 100;
    saveConfig();
    pendingInput.type = null;
    return { text: `✅ Alert floor = ${pct}% worst-case ROI`, keyboard: MENU_KEYBOARD };
  }
  pendingInput.type = null;
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

// ── Signal delivery (used by arb_scanner_live.js) ────────────────────────────
// Owner always receives; subscribers receive the same text (share ratios, no
// personal stakes). Screenshots are owner-only (heavy per-leg browser work).
export function getRecipients() {
  return [...config.recipients];
}

export async function sendMessageTo(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    return r.ok;
  } catch (e) {
    console.log(`[BotCtl] send to ${chatId} failed: ${e.message.slice(0, 80)}`);
    return false;
  }
}

/** Send one text to every SUBSCRIBER (owner is handled separately by the scanner). Best-effort. */
export async function broadcastSignal(text) {
  await Promise.allSettled(config.recipients.map(r => sendMessageTo(r.id, text)));
  return true;
}

/**
 * Long-poll Telegram updates and process owner commands + button taps.
 * Runs forever — call it only in loop mode (not --once/--diag, which should exit).
 */
export function startTelegramControl() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const owner = String(process.env.TELEGRAM_CHAT_ID || '');
  if (!token || !owner) {
    console.log('[BotCtl] no TELEGRAM_BOT_TOKEN/CHAT_ID — Telegram control disabled');
    return;
  }
  const API = `https://api.telegram.org/bot${token}`;
  const send = async (text, keyboard) => {
    try {
      await fetch(`${API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: owner,
          text,
          disable_web_page_preview: true,
          ...(keyboard ? { reply_markup: keyboard } : {}),
        }),
      });
    } catch (e) {
      console.log(`[BotCtl] send failed: ${e.message.slice(0, 80)}`);
    }
  };
  const answer = async (callbackQueryId) => {
    try {
      await fetch(`${API}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId }),
      });
    } catch { /* non-fatal */ }
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

          // ── Button tap ──
          if (u.callback_query) {
            const cq = u.callback_query;
            const cqOwner = String(cq.from?.id ?? cq.message?.chat?.id ?? '');
            if (cqOwner !== owner) continue;
            const res = handleCallback(cq.data);
            if (res) {
              await answer(cq.id);
              await send(res.text, res.keyboard);
            }
            continue;
          }

          // ── Plain message ──
          const msg = u.message || u.edited_message;
          if (!msg) continue;
          const chatId = String(msg.chat?.id ?? '');
          if (chatId !== owner) continue; // owner-only

          const freshPrompt = pendingInput.type && (Date.now() - pendingInput.at) < PENDING_TTL_MS;
          let res = null;
          if (freshPrompt) {
            res = handlePendingInput(msg);
          } else {
            pendingInput.type = null; // stale prompt — drop it, treat as command
            const reply = handleMessage(msg.text);
            if (reply) res = { text: reply, keyboard: MENU_KEYBOARD };
          }
          if (res?.text) await send(res.text, res.keyboard);
        }
        saveConfig(); // persist last_update_id
      } catch (e) {
        console.log(`[BotCtl] poll error: ${e.message.slice(0, 90)}`);
        await new Promise(res => setTimeout(res, 3000));
      }
    }
  };
  poll();
  console.log('[BotCtl] Telegram control listening (owner-only, buttons enabled)…');
}
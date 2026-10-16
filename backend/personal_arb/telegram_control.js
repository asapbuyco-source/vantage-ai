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
// Persist config on the Railway VOLUME. The volume is mounted at /app/.playwright_profile;
// the repo-relative path (../../.playwright_profile) only matches when running from
// backend/personal_arb. Resolve layout-proof: env override → container volume → relative.
const VOLUME_DIR = process.env.ARB_PROFILE_ROOT
  || (fs.existsSync('/app/.playwright_profile') ? '/app/.playwright_profile' : path.join(__dirname, '../../.playwright_profile'));
const VOLUME_CONFIG_PATH = path.join(VOLUME_DIR, 'bot_config.json');
const LEGACY_CONFIG_PATH = path.join(__dirname, 'bot_config.json');
const CONFIG_PATH = process.env.ARB_BOT_CONFIG || VOLUME_CONFIG_PATH;

export const DEFAULT_BANKROLL = 10000;

const DEFAULT_CONFIG = {
  bankrolls: {},       // book -> XAF stake anchor (per leg on that book)
  min_roi: 0.01,       // alert floor: worst-case ROI must be >= this
  last_update_id: 0,   // Telegram getUpdates offset (persisted)
  recipients: [],      // [{ id, name, addedAt }] — signal recipients (owner + these)
  pendingApprovals: [],// [{ id, name, at }] — non-owner who messaged the bot, awaiting owner approval
  autobet: 'off',      // 'off' | 'dry' | 'live' — auto-bet mode (betpawa+betfrenzy only)
  autobetTestPending: false, // one-shot: dry-run the next best candidate through the real click path
  autoMaxStake: 0,     // 0 = use per-book bankroll anchor (per-book cap)
  autoMaxTotal: 0,     // 0 = no global cap; else max TOTAL staked per arb
  balancePct: 10,      // % of each live balance used when sizing auto-bets
  pushMode: 'alert',   // 'alert' = 🛡️ no-lose opportunities are ALERT-ONLY; 'auto' = also auto-bet
  pushPct: 40,         // % of live balance used for 🛡️ no-lose when pushMode = auto
  autoDailyLimit: 5,   // max confirmed bets per day — hard kill-switch
  autoDay: null,       // YYYY-MM-DD of the counter
  autoPlacedToday: 0,  // confirmed bets placed today
  autoLimitWarned: false, // only warn once per day when the limit is hit
  logins: {},          // book -> { user, pass, setAt } — NO-OTP books only (betfrenzy/betpawa)
  loginPending: null,  // book name — scanner performs a credential login on next cycle
  checkPending: false, // scanner checks logged-in state + balance for betfrenzy+betpawa
  diagPending: null,   // book name — scanner dumps the login page (fields+buttons+screenshot)
  lastBalances: {},    // book -> last live balance (cached by the scanner for display)
};

export function loadConfig() {
  try {
    // Migrate: prefer the volume copy; fall back to the legacy (ephemeral) one once.
    const pathToUse = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : (fs.existsSync(LEGACY_CONFIG_PATH) ? LEGACY_CONFIG_PATH : null);
    if (pathToUse) {
      const saved = JSON.parse(fs.readFileSync(pathToUse, 'utf8'));
      // Ensure the config directory exists on the volume for future saves
      try { fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true }); if (pathToUse === LEGACY_CONFIG_PATH) fs.copyFileSync(pathToUse, CONFIG_PATH); } catch (_) {}
      return {
        ...DEFAULT_CONFIG, ...saved,
        bankrolls: { ...(saved.bankrolls || {}) },
        logins: { ...(saved.logins || {}) },
        recipients: Array.isArray(saved.recipients) ? saved.recipients : [],
        pendingApprovals: Array.isArray(saved.pendingApprovals) ? saved.pendingApprovals : [],
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
      [btn('💰 Amounts / balances', 'amounts')],
      [btn('BetFrenzy', 'amount:betfrenzy'), btn('BetPawa', 'amount:betpawa')],
      [btn('1xBet (signal stake)', 'amount:1xbet')],
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

// Books still in use. betfrenzy+betpawa = signals + auto-bet (sized from LIVE balance).
// 1xbet = signals only; its "amount" is the custom stake shown on 1xbet legs.
export const ACTIVE_BOOKS = ['betfrenzy', 'betpawa', '1xbet'];

function amountsLines() {
  const pct = config.balancePct || 10;
  const bal = config.lastBalances || {};
  const fmt = (n) => (n != null ? Math.round(n).toLocaleString() + ' XAF' : 'reading…');
  const lines = ['💰 Stake sizing'];
  lines.push(`  BetFrenzy: ${fmt(bal.betfrenzy)}  (live balance · autobet uses ${pct}%)`);
  lines.push(`  BetPawa:   ${fmt(bal.betpawa)}  (live balance · autobet uses ${pct}%)`);
  lines.push(`  1xBet:     ${(config.bankrolls['1xbet'] ?? 0).toLocaleString()} XAF  (signal stake only)`);
  lines.push('');
  lines.push(`Now: minROI ${(config.min_roi * 100).toFixed(1)}% · autobet ${config.autobet} · limit ${config.autoDailyLimit}/day`);
  lines.push('Balances refresh when the scanner runs (autobet check / test / live).');
  return lines.join('\n');
}

async function ledgerLines() {
  const db = await initLedgerDb();
  if (!db) return '🧾 Ledger: Firestore unavailable (FIREBASE_SERVICE_ACCOUNT not set).';
  try {
    const snap = await db.collection('arb_bets').orderBy('ts', 'desc').limit(8).get();
    if (snap.empty) return '🧾 Ledger empty — no auto-bet attempts yet. Send "autobet test" to force a dry-run.';
    const lines = ['🧾 Recent auto-bet attempts:'];
    snap.docs.forEach(d => {
      const b = d.data() || {};
      const tag = b.dryRun ? '🧪 DRY' : b.status === 'placed' ? '✅ PLACED' : b.status === 'dryrun_passed' ? '🧪 PASS' : '❌ FAIL';
      lines.push(`${tag} ${(b.book || '?').padEnd(9)} ${(b.event || '').slice(0, 28)} | ${b.leg?.bet || '?'} @ ${b.leg?.odds} | ${b.ok ? 'ok' : b.why || '?'}`);
    });
    return lines.join('\n');
  } catch (e) {
    return `🧾 Ledger error: ${e.message.slice(0, 80)}`;
  }
}

async function pnlLines() {
  const db = await initLedgerDb();
  if (!db) return '📈 P&L: Firestore unavailable (FIREBASE_SERVICE_ACCOUNT not set).';
  try {
    const snap = await db.collection('arb_positions').orderBy('ts', 'desc').limit(50).get();
    if (snap.empty) return '📈 P&L: no arb positions yet. They appear here after auto-bet acts.';
    let staked = 0, locked = 0, placed = 0, partial = 0, failed = 0;
    const rows = [];
    snap.docs.forEach(d => {
      const p = d.data() || {};
      if (p.status === 'placed') { placed++; staked += p.totalStake || 0; locked += p.lockedProfit || 0; }
      else if (p.status === 'partial') partial++;
      else failed++;
    });
    const roi = staked > 0 ? (locked / staked) * 100 : 0;
    const lines = [
      '📈 AUTO-BET P&L (last 50 positions)',
      `✅ placed: ${placed}   ⚠️ partial: ${partial}   ❌ failed: ${failed}`,
      `💰 total staked: ${Math.round(staked).toLocaleString()} XAF`,
      `🔒 locked profit: ${Math.round(locked).toLocaleString()} XAF (${roi.toFixed(2)}% on turnover)`,
      '',
    ];
    snap.docs.slice(0, 6).forEach(d => {
      const p = d.data() || {};
      const icon = p.status === 'placed' ? '✅' : p.status === 'partial' ? '⚠️' : '❌';
      lines.push(`${icon} ${String(p.event || '').slice(0, 24)} · ${p.kind || ''} · ${Math.round(p.totalStake || 0)} XAF → +${Math.round(p.lockedProfit || 0)}`);
    });
    return lines.join('\n');
  } catch (e) { return `📈 P&L error: ${e.message.slice(0, 80)}`; }
}

let _ledgerDb = null;
async function initLedgerDb() {
  if (_ledgerDb) return _ledgerDb;
  const { default: admin } = await import('firebase-admin');
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) return null;
    const sa = JSON.parse(raw);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
    _ledgerDb = admin.firestore();
    return _ledgerDb;
  } catch (e) { console.log(`[BotCtl] ledger db init: ${e.message.slice(0, 80)}`); return null; }
}

function statusLines() {
  const lines = [...amountsLines().split('\n')];
  lines.push(`📉 Alert floor: ${(config.min_roi * 100).toFixed(1)}% worst-case ROI`);
  lines.push(`🤖 Autobet: ${config.autobet}${config.autobetTestPending ? ' | 🧪 TEST ARMED' : ''} (betfrenzy+betpawa) | limit ${config.autoDailyLimit}/day${config.autoDay === new Date().toISOString().slice(0, 10) ? `, ${config.autoPlacedToday} placed today` : ''}`);
  lines.push(`👥 Subscribers: ${config.recipients.length ? config.recipients.map(r => `${r.name || r.id} (${r.id})`).join(', ') : 'none'}`);
  if (config.pendingApprovals.length) {
    lines.push(`⏳ Awaiting approval: ${config.pendingApprovals.map(p => `${p.name || p.id} (${p.id})`).join(', ')}`);
  }
  return lines.join('\n');
}

const SUBS_HELP = [
  '👥 Subscribers receive every signal (share ratios, not your personal stakes).',
  '➕ Add — FORWARD any message from the person, or send "add <chatId> <name>".',
  '💡 Easiest: tell the person to message this bot once — you get an Approve/Deny button.',
  '📋 List — show current subscribers.',
  '➖ Remove — pick who to drop.',
  '⚠️ Every subscriber betting the same arb raises the syndicate pattern for the books.',
].join('\n');

const HELP = [
  '🎛️  ARB BOT — COMMANDS',
  '',
  '💰  STAKES',
  'amount <book|all> <XAF>  set stake anchor',
  'amounts  show all anchors',
  'maxtotal <XAF>  max total per arb',
  'balancepct <n>  % of live balance per arb',
  'pushmode alert|auto  🛡️ no-lose: alert-only or also auto-bet',
  'pushpct <n>  sizing for 🛡️ no-lose arbs',
  '',
  '📉  ALERTS',
  'minroi <pct>  alert floor (e.g. minroi 2)',
  '',
  '🔐  LOGIN  (betfrenzy + betpawa only)',
  'setlogin <book> <phone> <pin>  store creds',
  'login <book>  log in now',
  'autobet check  login state + balances',
  'diaglogin <book>  dump the login page',
  'clearlogin <book>  forget creds',
  '',
  '🤖  AUTO-BET',
  'autobet test  dry-run the click path',
  'autobet limit <n>  max bets/day',
  'autobet live  place real bets',
  'autobet dry  back to dry-run',
  'autobet off  stop betting',
  '',
  '🧾  HISTORY',
  'ledger  last auto-bet attempts',
  'pnl  profit & loss summary',
  'status  full status',
  'help  this menu',
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
      for (const b of ACTIVE_BOOKS) config.bankrolls[b] = amount;
      saveConfig();
      return `✅ All books stake anchor = ${amount.toLocaleString()} XAF`;
    }
    config.bankrolls[book] = amount;
    saveConfig();
    return book === '1xbet'
      ? `✅ 1xBet signal stake = ${amount.toLocaleString()} XAF`
      : `✅ ${book} cap = ${amount.toLocaleString()} XAF (optional; autobet otherwise sizes from live balance)`;
  }

  m2 = lower.match(/^(?:\/)?(?:set\s+)?minroi\s+([\d.,]+)$/);
  if (m2) {
    const pct = parseFloat(m2[1].replace(',', '.'));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 50) return 'Usage: minroi <pct> — e.g. "minroi 2" (2% floor)';
    config.min_roi = pct / 100;
    saveConfig();
    return `✅ Alert floor = ${pct}% worst-case ROI`;
  }

  m2 = lower.match(/^(?:\/)?(?:maxtotal|maxstake)\s+([\d.,]+)$/);
  if (m2) {
    const amt = parseFloat(m2[1].replace(',', '.'));
    if (!Number.isFinite(amt) || amt < 0) return 'Usage: maxtotal <XAF> — max TOTAL staked per arb (0 = no cap). e.g. "maxtotal 30000"';
    config.autoMaxTotal = amt;
    saveConfig();
    return amt === 0 ? '✅ No global total cap — each arb is capped only by the per-book amounts.' : `✅ Max total per arb = ${amt.toLocaleString()} XAF (split across both legs by the arb ratio).`;
  }

  m2 = lower.match(/^(?:\/)?(?:balancepct|balpct)\s+([\d.,]+)$/);
  if (m2) {
    const pct = parseFloat(m2[1].replace(',', '.'));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return 'Usage: balancepct <1-100> — % of each live balance used per arb. e.g. "balancepct 10"';
    config.balancePct = pct;
    saveConfig();
    return `✅ Auto-bet sizing = ${pct}% of each live balance (betfrenzy + betpawa).`;
  }

  m2 = lower.match(/^(?:\/)?pushmode\s+(alert|auto)$/);
  if (m2) {
    config.pushMode = m2[1];
    saveConfig();
    return m2[1] === 'alert'
      ? '🛡️ No-lose (push-protected) opportunities = ALERT ONLY — you place them yourself.'
      : '🛡️ No-lose opportunities will ALSO be auto-bet (sized at pushpct%).';
  }
  m2 = lower.match(/^(?:\/)?pushpct\s+([\d.,]+)$/);
  if (m2) {
    const pct = parseFloat(m2[1].replace(',', '.'));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return 'Usage: pushpct <1-100> — sizing for 🛡️ no-lose arbs when pushmode=auto. e.g. "pushpct 40"';
    config.pushPct = pct;
    saveConfig();
    return `✅ 🛡️ no-lose sizing = ${pct}% of live balance (when pushmode=auto).`;
  }

  // ── Credential login commands (raw text — passwords are case-sensitive) ──
  m2 = String(text).match(/^(?:\/)?setlogin\s+(\S+)\s+(\S+)\s+(.+)$/i);
  if (m2) {
    const book = BOOK_ALIASES[m2[1].toLowerCase()] || m2[1].toLowerCase();
    if (!['betfrenzy', 'betpawa'].includes(book)) return 'setlogin supports only betfrenzy and betpawa (the no-OTP books).';
    config.logins[book] = { user: m2[2].trim(), pass: m2[3].trim(), setAt: new Date().toISOString() };
    saveConfig();
    return `🔐 Credentials stored for ${book} (user ${m2[2].trim().slice(0, 4)}****).\nSend "login ${book}" to log in now.\nThis message will be deleted from the chat.`;
  }
  m2 = lower.match(/^(?:\/)?login\s+(\S+)$/);
  if (m2) {
    const book = BOOK_ALIASES[m2[1]] || m2[1];
    if (!['betfrenzy', 'betpawa'].includes(book)) return 'login supports only betfrenzy and betpawa.';
    const hasEnv = !!(process.env[`${book.toUpperCase()}_USER`] && process.env[`${book.toUpperCase()}_PASS`]);
    if (!config.logins[book] && !hasEnv) return `No credentials stored for ${book}. Use: setlogin ${book} <phone> <password> (or set ${book.toUpperCase()}_USER/_PASS on Railway)`;
    config.loginPending = book;
    saveConfig();
    return `🔐 Login for ${book} queued (${hasEnv ? 'Railway env credentials' : 'stored credentials'}) — the scanner will run it on the next cycle and report back.`;
  }
  m2 = lower.match(/^(?:\/)?clearlogin\s+(\S+)$/);
  if (m2) {
    const book = BOOK_ALIASES[m2[1]] || m2[1];
    if (config.logins[book]) { delete config.logins[book]; saveConfig(); return `🗑️ Credentials for ${book} deleted.`; }
    return `Nothing stored for ${book}.`;
  }
  m2 = lower.match(/^(?:\/)?diaglogin\s+(\S+)$/);
  if (m2) {
    const book = BOOK_ALIASES[m2[1]] || m2[1];
    if (!['betfrenzy', 'betpawa'].includes(book)) return 'diaglogin supports only betfrenzy and betpawa.';
    config.diagPending = book;
    saveConfig();
    return `🔬 Diagnosing ${book} login page — the scanner will open it and send you a screenshot + the exact fields/buttons it sees on the next cycle.`;
  }

  m2 = lower.match(/^(?:\/)?autobet\s+(test|check|live|dry|off|on|limit)(?:\s+([\d.]+))?$/);
  if (m2) {
    const mode = m2[1];
    if (mode === 'test') {
      config.autobetTestPending = true;
      saveConfig();
      return '🧪 Autobet TEST armed — the next scanned candidate ≥ floor will be dry-run through the REAL click+stake path (no confirm). Watch for the results.';
    }
    if (mode === 'check') {
      config.checkPending = true;
      saveConfig();
      return '🔍 Session check queued — the scanner will report login state + balances for betfrenzy and betpawa on the next cycle.';
    }
    if (mode === 'limit') {
      const n = parseInt(m2[2], 10);
      if (!Number.isFinite(n) || n <= 0) return 'Usage: autobet limit <n> — max confirmed bets per day (kill-switch). e.g. "autobet limit 3"';
      config.autoDailyLimit = n;
      config.autoLimitWarned = false;
      saveConfig();
      return `⛔ Daily auto-bet limit = ${n} bets. Reached → auto-betting stops until tomorrow (or until you raise it).`;
    }
    config.autobet = mode === 'on' ? 'dry' : mode;
    if (m2[2]) config.autoMaxStake = parseFloat(m2[2]);
    saveConfig();
    return `🤖 Autobet = ${config.autobet}${m2[2] ? ` | max stake ${m2[2]} XAF` : ''} (books: betfrenzy, betpawa) | daily limit ${config.autoDailyLimit}${config.autoDay === new Date().toISOString().slice(0, 10) ? ` (${config.autoPlacedToday} placed today)` : ''}`;
  }

  if (lower === 'ledger' || lower === '/ledger') {
    return ledgerLines();
  }
  if (lower === 'pnl' || lower === '/pnl' || lower === 'profit') {
    return pnlLines();
  }
  if (lower === 'balance' || lower === '/balance') {
    return '💳 Use the ledger — balances are attached to each bet record (arb_balances collection).';
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
  if (d === 'amounts') return { text: amountsLines(), keyboard: bookKeyboard() };
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
  // Approve / deny someone who messaged the bot asking to join
  if (d.startsWith('approve:')) {
    const id = d.slice('approve:'.length);
    const idx = config.pendingApprovals.findIndex(p => p.id === id);
    if (idx === -1) return { text: 'ℹ️ No pending request with that ID.', keyboard: MENU_KEYBOARD };
    const [req] = config.pendingApprovals.splice(idx, 1);
    if (!config.recipients.some(r => r.id === id)) {
      config.recipients.push({ id, name: req.name || id, addedAt: new Date().toISOString() });
    }
    saveConfig();
    // notify the new subscriber they're in
    sendMessageTo(id, '✅ Approved — you now receive every Vantage arb signal (share ratios). Verify prices before betting.');
    return { text: `✅ Approved ${req.name || id} — they now get every signal.`, keyboard: subsKeyboard() };
  }
  if (d.startsWith('deny:')) {
    const id = d.slice('deny:'.length);
    const idx = config.pendingApprovals.findIndex(p => p.id === id);
    if (idx === -1) return { text: 'ℹ️ No pending request with that ID.', keyboard: MENU_KEYBOARD };
    const [req] = config.pendingApprovals.splice(idx, 1);
    saveConfig();
    sendMessageTo(id, '❌ Your signal access request was declined by the owner.');
    return { text: `❌ Declined ${req.name || id}.`, keyboard: subsKeyboard() };
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
    const amount = parseAmount(raw);
    if (!amount) return { text: 'Invalid amount — send a number (e.g. 30000):', keyboard: backKeyboard() };
    const book = pendingInput.book;
    if (book === 'all') {
      for (const b of ACTIVE_BOOKS) config.bankrolls[b] = amount;
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

          // ── NON-owner messaging the bot: log a pending approval request ──
          if (chatId !== owner) {
            const from = msg.from || {};
            const sid = String(from.id ?? chatId);
            if (config.recipients.some(r => r.id === sid)) continue; // already in
            const existing = config.pendingApprovals.find(p => p.id === sid);
            if (existing) existing.at = Date.now(); // refresh
            else config.pendingApprovals.push({ id: sid, name: (from.first_name || '') + (from.last_name ? ' ' + from.last_name : ''), at: Date.now() });
            config.pendingApprovals = config.pendingApprovals.filter(p => Date.now() - p.at < 24 * 60 * 60 * 1000); // prune stale
            saveConfig();
            await sendMessageTo(sid, '⏳ Signal access request received — the owner has been notified. You will get alerts once approved.');
            const req = config.pendingApprovals.find(p => p.id === sid);
            await send(`👤 ${req?.name || sid} (${sid}) wants to receive signals — approve?`, {
              inline_keyboard: [
                [btn('✅ Approve', `approve:${sid}`), btn('❌ Deny', `deny:${sid}`)],
              ],
            });
            continue;
          }

          const freshPrompt = pendingInput.type && (Date.now() - pendingInput.at) < PENDING_TTL_MS;
          let res = null;
          if (freshPrompt) {
            res = handlePendingInput(msg);
          } else {
            pendingInput.type = null; // stale prompt — drop it, treat as command
            const reply = handleMessage(msg.text);
            if (reply) res = { text: reply, keyboard: MENU_KEYBOARD };
            // Security: delete setlogin messages from the chat (they contain a password).
            if (msg.text && /^(?:\/)?setlogin\s/i.test(msg.text) && msg.message_id) {
              try { await fetch(`${API}/deleteMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, message_id: msg.message_id }) }); } catch (_) {}
            }
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
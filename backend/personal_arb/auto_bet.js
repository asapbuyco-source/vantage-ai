/**
 * auto_bet.js — programmatic bet placement for betpawa + betfrenzy using the
 * scanner's persisted Playwright sessions (SAME profiles as arb_scanner_live).
 *
 * Principles (conservative):
 *  - DRY-RUN by default: locate the exact odds button, click it into the slip,
 *    fill the stake, READ BACK the slip totals + account balance, screenshot it —
 *    but do NOT press the final confirm button. This proves the chain without risk.
 *  - LIVE mode ("autobet live") only after a dry-run passed: re-verifies the odds
 *    within tolerance, fills the stake, confirms, and records the bet.
 *  - Every attempt is written to Firestore `arb_bets` = the P&L ledger.
 *  - Supported books: betfrenzy, betpawa. (1xbet-family excluded: feed lag.)
 */
import { chromium } from 'playwright';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_ROOT = process.env.ARB_PROFILE_ROOT
  || (fs.existsSync('/app/.playwright_profile') ? '/app/.playwright_profile' : path.join(__dirname, '../../.playwright_profile'));
const ARB_PROXY = process.env.ARB_PROXY || '';

async function initFirebase() {
  if (admin.apps.length) return admin.firestore();
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) return null;
    const sa = JSON.parse(raw);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    admin.initializeApp({ credential: admin.credential.cert(sa) });
    return admin.firestore();
  } catch (e) {
    console.log(`[AutoBet] Firebase init error: ${e.message.slice(0, 120)}`);
    return null;
  }
}

async function launchBook(profileName) {
  const launchOpts = { headless: true, viewport: { width: 390, height: 844, isMobile: true } };
  if (ARB_PROXY && process.env.SCREENSHOT_PROXY === '1') {
    const u = new URL(ARB_PROXY);
    launchOpts.proxy = {
      server: `${u.protocol}//${u.host}`,
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    };
  }
  const prof = path.join(PROFILE_ROOT, profileName);
  if (!fs.existsSync(prof)) fs.mkdirSync(prof, { recursive: true });
  return chromium.launchPersistentContext(prof, launchOpts);
}

// In-page engine: locate the exact odds button (same logic the scanner's
// screenshot verification uses) and click it into the bet slip.
// Defined as a real function so Playwright can serialize it (no template escaping).
function locateAndClickInPage({ want, wantLine, index, market, titleRe, target }) {
  const lineOf = (t) => {
    if (market === 'ah') {
      const m = t.match(/([+-]\d+(?:\.\d+)?)(?:,\s*([+-]\d+(?:\.\d+)?))?/);
      if (!m) return null;
      const a = parseFloat(m[1]); const b = m[2] != null ? parseFloat(m[2]) : null;
      return b != null ? (a + b) / 2 : a;
    }
    const mo = t.match(/over\s*\/?\s*under\s*([\d.,]+)/i);
    if (mo) { const parts = mo[1].split(',').map(parseFloat).filter(v => !isNaN(v)); return parts.length ? parts.reduce((a, x) => a + x, 0) / parts.length : null; }
    const m2 = t.match(/under\s*(\d+(?:[.,]\d+)?)/i);
    return m2 ? parseFloat(m2[1].replace(',', '.')) : null;
  };
  const isQuarter = (v) => { const r = Math.abs(v) % 1; return Math.abs(r - 0.25) < 0.01 || Math.abs(r - 0.75) < 0.01; };
  const isHalf = (t) => /(1st|2nd|first|second)\s*half|half\s*time|\b1h\b|\b2h\b|minutes?/i.test(t.slice(0, 60));
  const oddsButtons = (el) => {
    const all = Array.from(el.querySelectorAll('a, button, span, div, [class*="odd"], [class*="coef"], [class*="price"]'))
      .filter(b => { const t = (b.textContent || '').trim(); if (!t || t.length > 8) return false; const v = parseFloat(t.replace(',', '.')); return !isNaN(v) && v >= 1.01 && v <= 100; })
      .filter(b => !Array.from(b.querySelectorAll('*')).some(c => { const ct = (c.textContent || '').trim(); if (!ct || ct.length > 8) return false; const cv = parseFloat(ct.replace(',', '.')); return !isNaN(cv) && cv >= 1.01 && cv <= 100; }));
    return all;
  };
  const sections = [];
  for (const el of document.querySelectorAll('div,section,article,li')) {
    const t = (el.textContent || '').trim();
    if (!t || t.length > 600) continue;
    const head = t.slice(0, 60);
    if (!titleRe.test(head)) continue;
    if (market === 'ou' && target === 'corners' && !/corner/i.test(head)) continue;
    if (market === 'ou' && target === 'goals' && /corner/i.test(head)) continue;
    if (market === '1x2' && /&|\bup\b|both/i.test(head)) continue;
    if (isHalf(t)) continue;
    const btns = oddsButtons(el);
    if (btns.length < 2) continue;
    sections.push({ t, line: lineOf(head), len: t.length, btns });
  }
  let best = null, bestD = Infinity, bestLen = Infinity;
  for (const s of sections) {
    const d = (wantLine != null) ? (s.line != null ? Math.abs(market === 'ah' ? Math.abs(s.line) - Math.abs(wantLine) : s.line - wantLine) : 999) : 0;
    if (d < bestD || (d === bestD && s.len < bestLen)) { bestD = d; bestLen = s.len; best = s; }
  }
  const tol = (wantLine != null && isQuarter(wantLine)) ? 0.05 : 0.35;
  if (!best || (wantLine != null && bestD > tol)) return { ok: false, why: best ? 'line off by ' + bestD.toFixed(2) : 'section not found', sections: sections.length };
  let hit = null, bd = Infinity;
  for (const b of best.btns) { const v = parseFloat((b.textContent || '').trim().replace(',', '.')); const d = Math.abs(v - want); if (d < bd) { bd = d; hit = b; } }
  if (bd > 0.5) hit = null;
  if (!hit && typeof index === 'number' && best.btns[index]) hit = best.btns[index];
  if (!hit) return { ok: false, why: 'no odds button near ' + want };
  hit.scrollIntoView({ block: 'center', inline: 'center' });
  hit.click();
  return { ok: true, found: parseFloat((hit.textContent || '').trim().replace(',', '.')), section: best.t.slice(0, 40) };
}

// Derive the locator params from the leg + candidate (mirrors screenshotHintForLeg).
function locatorParams(leg, c) {
  const b = leg.bet || '';
  const market = c.kind === 'MW' ? 'mw' : c.kind === 'CR' || /corner/i.test(b) ? 'ou' : c.kind === 'OU' || /over|under/i.test(b) ? 'ou' : c.kind === 'AH' ? 'ah' : c.kind === 'DC' ? 'dc' : c.kind === 'BTTS' ? 'btts' : c.kind === 'DNB' ? 'dnb' : '1x2';
  let wantLine = null, index = 0, target = 'goals';
  const lineFromBet = () => {
    const asian = b.match(/\(Asian ([^)]+)\)/);
    if (asian) { const parts = asian[1].split(',').map(parseFloat).filter(v => !isNaN(v)); return parts.length ? parts.reduce((a, x) => a + x, 0) / parts.length : null; }
    const m = b.match(/(\d+(?:\.\d+)?)\s*(?:goals|corners)/i);
    return m ? parseFloat(m[1]) : null;
  };
  if (/^Over/i.test(b)) { wantLine = lineFromBet(); index = 0; target = /corner/i.test(b) ? 'corners' : 'goals'; }
  else if (/^Under/i.test(b)) { wantLine = lineFromBet(); index = 1; target = /corner/i.test(b) ? 'corners' : 'goals'; }
  else if (/draw no bet/i.test(b)) index = new RegExp('^' + c.teams[0], 'i').test(b) ? 0 : 1;
  else if (/or Draw|No Draw/i.test(b)) index = /\(1X\)/.test(b) ? 0 : /\(X2\)/.test(b) ? 1 : 2;
  else if (/both/i.test(b)) index = /\(Yes\)/i.test(b) ? 0 : 1;
  else if (/to win \(1\)/i.test(b)) index = 0;
  else if (/Draw \(X\)/i.test(b)) index = 1;
  else if (/to win \(2\)/i.test(b)) index = c.kind === 'MW' ? 1 : 2;
  if (c.kind === 'AH') {
    const m = b.match(/([+-]\d+(?:\.\d+)?)\s*$/);
    wantLine = m ? Math.abs(parseFloat(m[1])) : null;
    index = new RegExp('^' + c.teams[0], 'i').test(b) ? 0 : 1;
  }
  const titleRe = market === 'btts' ? /both\s*teams/i : market === 'dnb' ? /draw\s*no\s*bet/i : market === 'mw' ? /match\s*winner|winner|vainqueur|to\s*win|moneyline|1x2|résultat|result/i : market === '1x2' ? /full\s*time\s*(?:result|1x2)?/i : market === 'ah' ? /asian\s*handicap/i : market === 'dc' ? /double\s*chance/i : /over\s*\/?\s*under/i;
  return { market, wantLine, index, target, titleRe, want: leg.odds };
}

// ── Slip handling per book ──────────────────────────────────────────────────
async function fillSlip(page, book, stake) {
  if (book === 'betfrenzy') {
    const filled = await page.locator('input[type="number"], input[type="tel"], input[placeholder*="mise" i], input[placeholder*="stake" i]')
      .first().fill(String(stake)).then(() => true).catch(() => false);
    return { filled, balanceSeen: await readBalanceText(page) };
  }
  if (book === 'betpawa') {
    const filled = await page.locator('input[type="number"], input[type="tel"], input[placeholder*="stake" i]')
      .first().fill(String(stake)).then(() => true).catch(() => false);
    return { filled, balanceSeen: await readBalanceText(page) };
  }
  return { filled: false, balanceSeen: null };
}

async function readBalanceText(page) {
  for (const sel of ['[class*="balance" i]', '[class*="Balance" i]', '.wallet', '[class*="wallet" i]', '.account'] ) {
    const el = page.locator(sel).first();
    try { const t = (await el.textContent({ timeout: 1500 })).trim(); if (t && t.length < 60) return t; } catch (_) {}
  }
  return null;
}

// ── The main placement action ───────────────────────────────────────────────
export async function placeLeg({ book, leg, c, stake, dryRun = true }) {
  const db = await initFirebase();
  const out = { book, dryRun, ok: false, ts: new Date().toISOString(), leg: { bet: leg.bet, odds: leg.odds } };
  try {
    await new Promise(r => setTimeout(r, 800));
    const ctx = await launchBook(book);
    const page = await ctx.newPage();
    try {
      await page.goto(leg.link || `https://www.${book === 'betfrenzy' ? 'betfrenzy.cm' : 'betpawa.cm'}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);
      const params = locatorParams(leg, c);
      const located = await page.evaluate(locateAndClickInPage, params);
      if (!located.ok) { out.why = located.why; return out; }
      out.foundOdds = located.found;
      if (Math.abs(located.found - leg.odds) > 0.5) { out.why = `odds moved ${leg.odds} -> ${located.found}`; return out; }
      await page.waitForTimeout(1500);
      const slip = await fillSlip(page, book, stake);
      if (slip.filled) {
        await page.waitForTimeout(1500);
        const shot = await page.screenshot({ fullPage: false });
        out.slipShot = shot.toString('base64').slice(0, 200);
        out.balanceSeen = slip.balanceSeen;
        if (!dryRun) {
          const confirmTxt = book === 'betfrenzy' ? ['Placer', 'Miser', 'Confirmer', 'Valider', 'Bet'] : ['Bet', 'Place', 'Confirm'];
          const clickedConfirm = await page.locator(`button:has-text("${book === 'betfrenzy' ? 'Placer' : 'Bet'}"), button:has-text("Confirmer"), button:has-text("Valider")`).first().click()
            .then(() => true).catch(() => false);
          out.confirmed = clickedConfirm;
          await page.waitForTimeout(1500);
          out.afterBalance = await readBalanceText(page);
        }
        out.ok = true;
        out.status = dryRun ? 'dryrun_passed' : (out.confirmed ? 'placed' : 'confirm_failed');
      } else {
        out.why = 'stake input not found on slip';
      }
      await db?.collection('arb_bets').add({ ...out, stake, event: `${c.teams[0]} vs ${c.teams[1]}`, kind: c.kind, pct: c.pct });
      if (out.balanceSeen || out.afterBalance) {
        await db?.collection('arb_balances').add({ book, ts: out.ts, balance: out.afterBalance || out.balanceSeen, raw: true });
      }
    } finally {
      await ctx.close().catch(() => {});
    }
  } catch (e) {
    out.why = e.message.slice(0, 160);
    await db?.collection('arb_bets').add({ ...out, stake, event: c?.teams?.join(' vs ') });
  }
  return out;
}

// Convenience for the bot / Telegram test: dry-run BOTH legs of a candidate.
export async function dryRunCandidate(c, { stakePerLeg = 100 } = {}) {
  const results = [];
  for (const leg of c.legs) {
    if (!['betfrenzy', 'betpawa'].includes(leg.book)) { results.push({ book: leg.book, skipped: 'unsupported book' }); continue; }
    results.push(await placeLeg({ book: leg.book, leg, c, stake: stakePerLeg, dryRun: true }));
  }
  return results;
}

// ── SAFE 2-LEG EXECUTION (live) ─────────────────────────────────────────────
// Two sites can never confirm atomically, but we minimise the window:
//   PHASE 1 prepare both legs in parallel (open → locate → click into slip →
//     fill stake → READ BACK accepted stake + balance on each)
//   PHASE 2 confirm both back-to-back within milliseconds (parallel clicks)
// If ANY leg fails phase 1 → ABORT: nothing is placed (no naked exposure).
function parseMoney(t) {
  if (!t) return null;
  const m = String(t).replace(/\s/g, '').match(/(\d[\d.,]*)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

async function readSlipStake(page) {
  try { const v = await page.locator('input[type="number"], input[type="tel"]').first().inputValue({ timeout: 1200 }); const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; } catch (_) { return null; }
}

async function prepareLeg({ book, ctx, leg, c, stake }) {
  const out = { book, ok: false };
  let page;
  try {
    page = await ctx.newPage();
    const fallback = `https://www.${book === 'betfrenzy' ? 'betfrenzy.cm' : 'betpawa.cm'}/`;
    await page.goto(leg.link || fallback, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    const located = await page.evaluate(locateAndClickInPage, locatorParams(leg, c));
    if (!located.ok) { out.why = located.why; return out; }
    out.foundOdds = located.found;
    if (Math.abs(located.found - leg.odds) > 0.5) { out.why = `odds moved ${leg.odds} -> ${located.found}`; return out; }
    await page.waitForTimeout(1500);
    const slip = await fillSlip(page, book, stake);
    if (!slip.filled) { out.why = 'stake input not found on slip'; return out; }
    await page.waitForTimeout(1200);
    out.accepted = await readSlipStake(page); // null = custom keypad (unverified but allowed)
    out.balance = slip.balanceSeen;
    const bal = parseMoney(out.balance);
    if (bal != null && bal + 1 < stake) { out.why = `insufficient balance (${out.balance}) for stake ${stake}`; return out; }
    out.page = page;
    out.ok = true;
    return out;
  } catch (e) { out.why = e.message.slice(0, 140); return out; }
}

async function confirmLeg(p, { dryRun }) {
  if (dryRun) return { book: p.book, ok: true, status: 'dryrun_passed' };
  try {
    const words = p.book === 'betfrenzy'
      ? [/placer/i, /confirmer/i, /valider/i, /miser/i, /^bet$/i]
      : [/^bet$/i, /place/i, /confirm/i, /placer/i, /valider/i];
    let clicked = false;
    for (const w of words) {
      try { const b = p.page.getByRole('button', { name: w }).first(); if (await b.isVisible({ timeout: 500 })) { await b.click({ timeout: 2500 }); clicked = true; break; } } catch (_) {}
    }
    if (!clicked) return { book: p.book, ok: false, status: 'confirm_button_not_found', why: 'no place/confirm button found on the slip' };
    await p.page.waitForTimeout(2500);
    const after = await readBalanceText(p.page);
    return { book: p.book, ok: true, status: 'placed', afterBalance: after };
  } catch (e) { return { book: p.book, ok: false, status: 'confirm_failed', why: e.message.slice(0, 140) }; }
}

export async function executeArb(c, { stakes = {}, dryRun = false } = {}) {
  const db = await initFirebase();
  const supported = c.legs.filter(l => ['betfrenzy', 'betpawa'].includes(l.book));
  if (supported.length < 2) {
    return { ok: false, reason: 'both legs must be on betfrenzy/betpawa for a safe auto-arb (one-leg auto-betting is refused)', results: supported.map(l => ({ book: l.book, skipped: 'unsupported' })) };
  }
  // PHASE 1 — prepare both in parallel; ABORT unless BOTH are ready.
  const prepList = await Promise.all(supported.map(async (leg) => {
    const ctx = await launchBook(leg.book);
    const p = await prepareLeg({ book: leg.book, ctx, leg, c, stake: stakes[leg.book] || 100 });
    return { ...p, ctx, leg };
  }));
  const bad = prepList.filter(p => !p.ok);
  if (bad.length) {
    await Promise.all(prepList.map(p => p.ctx?.close().catch(() => {})));
    for (const p of prepList) await db?.collection('arb_bets').add({ ts: new Date().toISOString(), dryRun, status: 'aborted', book: p.book, event: `${c.teams[0]} vs ${c.teams[1]}`, kind: c.kind, stake: stakes[p.book] || 100, leg: { bet: p.leg?.bet, odds: p.leg?.odds }, ok: p.ok, why: p.why, foundOdds: p.foundOdds });
    return { ok: false, reason: `PREPARE FAILED on ${bad.map(b => `${b.book}: ${b.why}`).join(' | ')} — ABORTED, nothing placed`, results: prepList.map(p => ({ book: p.book, ok: false, why: p.why })) };
  }
  // PHASE 2 — confirm both back-to-back (parallel clicks = tightest possible window).
  const confirms = await Promise.all(prepList.map(p => confirmLeg(p, { dryRun })));
  await Promise.all(prepList.map(p => p.ctx?.close().catch(() => {})));
  for (let i = 0; i < prepList.length; i++) {
    const p = prepList[i], cf = confirms[i];
    await db?.collection('arb_bets').add({ ts: new Date().toISOString(), dryRun, status: cf.ok ? cf.status : 'failed', book: p.book, event: `${c.teams[0]} vs ${c.teams[1]}`, kind: c.kind, pct: c.pct, stake: stakes[p.book] || 100, accepted: p.accepted, leg: { bet: p.leg?.bet, odds: p.leg?.odds }, ok: cf.ok, why: p.why || cf.why, foundOdds: p.foundOdds, balanceBefore: p.balance, balanceAfter: cf.afterBalance });
    if (cf.afterBalance || p.balance) await db?.collection('arb_balances').add({ book: p.book, ts: new Date().toISOString(), balance: cf.afterBalance || p.balance });
  }
  const allPlaced = confirms.every(cf => cf.ok);
  return { ok: allPlaced, partial: confirms.some(cf => cf.ok) && !allPlaced, results: confirms, preps: prepList.map(p => ({ book: p.book, accepted: p.accepted, balance: p.balance, foundOdds: p.foundOdds })) };
}
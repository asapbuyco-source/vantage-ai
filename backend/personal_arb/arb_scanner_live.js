/**
 * arb_scanner_live.js — widened 7-book arb scanner
 * Books: betfrenzy, betpawa, pmuc, premierbet (direct APIs via Playwright session)
 * Markets: 1X2 + O/U (asian lines) — cross-book, best odds, arb% = 1-Σ(1/odds)
 * Modes:
 *   node arb_scanner_live.js --warm        # first time: save session cookies
 *   node arb_scanner_live.js --once        # single scan
 *   node arb_scanner_live.js --loop=3      # poll every 3 min forever (default)
 * Telegram alert on arb if TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID set
 */
import { calcArb } from './arb_calc.js';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env.local for Telegram creds (same file server.js uses)
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

// Residential proxy (optional): ARB_PROXY=http://user:pass@host:port
// Applies to all browser sessions so bookmaker bot checks see a residential IP.
const ARB_PROXY = process.env.ARB_PROXY || '';

// Wrapper that injects the proxy into every Playwright launch
async function launchBook(profileName, opts = {}) {
  const launchOpts = { ...opts };
  if (ARB_PROXY) launchOpts.proxy = { server: ARB_PROXY };
  return chromium.launchPersistentContext(prof(profileName), launchOpts);
}
const PROFILE_ROOT = path.join(__dirname, '../../.playwright_profile');
const prof = name => { const p = path.join(PROFILE_ROOT, name); if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); return p; };
// Real cross-book arbs are ~1-5%. >15% means a stale/wrong line — flag but don't trust.
const MAX_PLAUSIBLE_ARB = 15;
const args = process.argv.slice(2);
const warm = args.includes('--warm');
const once = args.includes('--once');
const loopMin = parseInt(args.find(a => a.startsWith('--loop='))?.split('=')[1] || '3', 10);

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/fc$|cf$|sc$|ac$/g, '');
// Canonical league token — strips generic words so books that name the same
// competition differently ("UEFA Champions League" vs "Ligue des Champions UEFA")
// still match, while youth/senior stay distinct ("youth" vs "champions").
const canonLeague = s => {
  if (!s) return '';
  let t = String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const w of ['league','ligue','liga','uefa','europa','european','cup','coupe','copa','championship','world','club','football','competition','trophy','meisterschaft','des','de','el','la','the','e','italy','spain','england','germany','france']) t = t.split(w).join('');
  return t;
};
const youthMark = s => /u19|u20|u21|youth|reserve|junior|women/.test((s || '').toLowerCase());

// Kickoff guard: arbs need time to place BOTH legs before the match starts.
// Drop any event kicking off within 30 minutes.
const MIN_KICKOFF_LEAD_MS = 30 * 60 * 1000;
const isTooSoon = (kickoffMs) => {
  if (!kickoffMs) return false;
  return kickoffMs - Date.now() < MIN_KICKOFF_LEAD_MS;
};

async function fetchBetfrenzy() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('https://betfrenzy.cm/api/v1/sports/matchs?SportId=1&EventStatus=PRE', { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) { await new Promise(r => setTimeout(r, 3000)); continue; }
      const j = await r.json();
      const out = [];
      for (const lg of j) for (const ev of lg.events || []) {
        const o = ev.odds || {};
        if (o['1_1']) out.push({ book: 'betfrenzy', home: ev.home?.name, away: ev.away?.name, league: ev.league?.name, kickoff: ev.time ? ev.time * 1000 : null, link: ev.id ? `https://betfrenzy.cm/event/${ev.id}` : null,
          h: parseFloat(o['1_1'].home_od), d: parseFloat(o['1_1'].draw_od), a: parseFloat(o['1_1'].away_od),
          dc: o['1_8'] ? { '1x': parseFloat(o['1_8'].home_od), 'x2': parseFloat(o['1_8'].draw_od), '12': parseFloat(o['1_8'].away_od) } : null,
          ah: [o['1_2'], o['1_5']].filter(Boolean).map(x => ({ hcp: x.handicap, home: parseFloat(x.home_od), away: parseFloat(x.away_od) })),
          ou: [o['1_3'], o['1_6'], o['1_7']].filter(Boolean).map(x => ({ hcp: x.handicap, over: parseFloat(x.over_od), under: parseFloat(x.under_od) })).filter(x => x.over && x.under && parseFloat(x.hcp) <= 3.5),
          corners: o['1_4'] ? [{ hcp: o['1_4'].handicap, over: parseFloat(o['1_4'].over_od), under: parseFloat(o['1_4'].under_od) }] : [],
          cards: o['1_7'] ? [{ hcp: o['1_7'].handicap, over: parseFloat(o['1_7'].over_od), under: parseFloat(o['1_7'].under_od) }] : [] });
      }
      if (out.length > 0) return out;
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) { await new Promise(r => setTimeout(r, 3000)); }
  }
  return [];
}

async function fetchBetpawa() {
  // DISABLED: betpawa's v4 events API is protobuf (GENIUSSPORTS), combo-cards has no odds.
  // Would need the .proto schema to decode. Skipped — other 4 books cover the market.
  return [];
}

async function fetchPmuc() {
  // PMUC via raw fetch through the residential proxy (ARB_PROXY).
  // Requires Origin + Referer headers (their CDN 403s otherwise) + proxy.
  const events = [];
  try {
    const proxyUrl = new URL(ARB_PROXY);
    const auth = 'Basic ' + Buffer.from(`${proxyUrl.username}:${proxyUrl.password}`).toString('base64');
    const r = await fetch('https://hg-event-api-prod.sporty-tech.net/api/events/sports/popular?take=10&entryPointId=101&betTypeId=10001&l=fr', { headers: {
      'Proxy-Authorization': auth,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      'Origin': 'https://www.pmuc.cm',
      'Referer': 'https://www.pmuc.cm/sports',
      'Accept': 'application/json', 'Accept-Encoding': 'identity',
    } });
    if (!r.ok) { console.log(`[pmuc] HTTP ${r.status}`); return []; }
    const j = await r.json();
    for (const ev of Array.isArray(j) ? j : []) {
      for (const bt of ev.eventBetTypes || []) {
        if (bt.name === 'Résultat du match' || bt.name.includes('match')) {
          const o1 = bt.eventBetTypeItems?.find(i => i.shortName === '1')?.odds,
                ox = bt.eventBetTypeItems?.find(i => i.shortName === 'X')?.odds,
                o2 = bt.eventBetTypeItems?.find(i => i.shortName === '2')?.odds;
          if (o1) events.push({ book: 'pmuc', home: ev.homeTeamName, away: ev.awayTeamName, h: o1, d: ox, a: o2 });
        }
      }
    }
    console.log(`[pmuc] ${events.length} events via proxy`);
  } catch (e) {
    console.log(`[pmuc] fetch fail: ${e.message.slice(0, 90)}`);
  }
  return events;
}

async function fetchSportybet() {
  // DISABLED: SportyBet WAF blocks scripted fetches to the odds API (SyntaxError anti-injection).
  return [];
}

async function fetch1xbet() {
  // 1xbet via raw fetch through the residential proxy (ARB_PROXY) — no browser needed.
  // Chromium can't auth HTTP proxies reliably, but Node fetch + Proxy-Authorization works.
  const events = [];
  try {
    const proxyUrl = new URL(ARB_PROXY);
    const auth = 'Basic ' + Buffer.from(`${proxyUrl.username}:${proxyUrl.password}`).toString('base64');
    const headers = {
      'Proxy-Authorization': auth,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      'Referer': 'https://1xbet.cm/en/line',
      'Accept': 'application/json',
      'Accept-Encoding': 'identity',
    };
    const r = await fetch('https://1xbet.cm/service-api/main-line-feed/v3/games1x2?cfView=3&count=40&fcountry=84&gr=654&grMode=4&lng=en&ref=55', { headers });
    if (!r.ok) { console.log(`[1xbet] HTTP ${r.status}`); return []; }
    const buf = Buffer.from(await r.arrayBuffer());
    const j = JSON.parse(buf.toString('utf8'));
    const seen = new Set();
    let fb = 0, parsed = 0, other = 0;
    for (const ev of Array.isArray(j) ? j : []) {
      const groups = {};
      for (const g of ev.eventGroups || []) groups[g.groupId] = g.events || [];
      const cf = (arr, t) => arr?.find(x => x[0]?.type === t)?.[0]?.cf;
      const g1 = groups[1] || [];
      if (cf(g1, 1) && cf(g1, 3)) {
        parsed++;
        const evObj = { book: '1xbet', home: ev.opponent1?.fullName, away: ev.opponent2?.fullName, league: ev.liga?.name, kickoff: ev.startTs ? ev.startTs * 1000 : null,
          link: `https://1xbet.cm/en/line/${ev.sport?.name?.toLowerCase()}/${ev.liga?.id}-${ev.liga?.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/${ev.id}-${ev.opponent1?.fullName?.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${ev.opponent2?.fullName?.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          h: parseFloat(cf(g1, 1)), d: cf(g1, 2) ? parseFloat(cf(g1, 2)) : null, a: parseFloat(cf(g1, 3)) };
        if (ev.sport?.id === 1) {
          fb++;
          const ou = [];
          for (const [gid, name] of [[17, '2.5'], [15, '1.5'], [62, '0.5']]) {
            const g = groups[gid] || [];
            const over = cf(g, gid === 17 ? 9 : gid === 15 ? 11 : 13);
            const under = cf(g, gid === 17 ? 10 : gid === 15 ? 12 : 14);
            if (over && under) ou.push({ hcp: name, over: parseFloat(over), under: parseFloat(under) });
          }
          if (ou.length) evObj.ou = ou;
          const g2 = groups[2] || [];
          const dnbH = cf(g2, 7), dnbA = cf(g2, 8);
          if (dnbH && dnbA) evObj.dnb = { home: parseFloat(dnbH), away: parseFloat(dnbA) };
          const gah = groups[2854] || [];
          const ahH = cf(gah, 3829), ahA = cf(gah, 3830);
          if (ahH && ahA) evObj.ah = [{ hcp: '0.25', home: parseFloat(ahH), away: parseFloat(ahA) }];
          const g19 = groups[19] || [];
          const yes = cf(g19, 180), no = cf(g19, 181);
          if (yes && no) evObj.btts = { yes: parseFloat(yes), no: parseFloat(no) };
        } else {
          other++;
        }
        const key = `${ev.sport?.id}:${ev.opponent1?.fullName?.toLowerCase()}|${ev.opponent2?.fullName?.toLowerCase()}`;
        if (!seen.has(key)) { seen.add(key); events.push(evObj); }
      }
    }
    console.log(`[1xbet] football ${fb}, other sports ${other}, parsed ${parsed}, unique ${events.length}`);
  } catch (e) {
    console.log(`[1xbet] fetch fail: ${e.message.slice(0, 90)}`);
  }
  return events;
}

async function fetchPremierbet() {
  // PremierBet via raw fetch through the residential proxy (ARB_PROXY) — no browser/session.
  // The `upcoming` endpoint returns events with 1X2 (and more) markets inline.
  const events = [];
try {
    const proxyUrl = new URL(ARB_PROXY);
    const auth = 'Basic ' + Buffer.from(`${proxyUrl.username}:${proxyUrl.password}`).toString('base64');
    const today = new Date().toISOString().slice(0, 10);
    // Football (1), Basketball (2), Tennis (5) — 1X2 markets from each
    const sportNames = { 1: 'football', 2: 'basketball', 5: 'tennis' };
    for (const [sportId, sportName] of Object.entries(sportNames)) {
      const url = `https://sports-api.premierbet.com/cm/v1/events/upcoming?country=CM&group=g1&platform=desktop&locale=fr&timeOffset=-60&sportId=${sportId}&pageId=6465c8bfec1ecc07f3a373e9&date=${today}`;
      const r = await fetch(url, { headers: {
        'Proxy-Authorization': auth,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'Accept': 'application/json', 'Accept-Encoding': 'identity',
      } });
      if (!r.ok) { console.log(`[premierbet ${sportName}] HTTP ${r.status}`); continue; }
      const j = await r.json();
      const before = events.length;
      for (const cat of j.data?.categories || []) for (const comp of cat.competitions || []) for (const ev of comp.events || []) {
        if (!ev.eventNames?.[0]) continue;
        const o12 = (ev.markets || []).find(m => m.name === '1X2');
        const o = (mm) => { const x = {}; for (const oc of mm?.outcomes || []) x[oc.name] = parseFloat(oc.value); return x; };
        const evObj = { book: 'premierbet', home: ev.eventNames[0], away: ev.eventNames[1], league: `${sportName}:${comp.name}`, kickoff: ev.startTime,
          link: `https://www.premierbet.com/cm/event/${ev.id}` };
        if (o12) { const O = o(o12); evObj.h = O['1']; evObj.d = O['X']; evObj.a = O['2']; }
        // O/U from Total de Buts (football only — basketball/tennis totals differ)
        if (sportName === 'football') {
          const ouMkt = (ev.markets || []).find(m => m.name === 'Total de Buts');
          if (ouMkt) {
            const byHcp = {};
            for (const oc of ouMkt.outcomes || []) {
              if (!oc.handicap || !oc.value) continue;
              byHcp[oc.handicap] = byHcp[oc.handicap] || {};
              if (oc.name === 'Plus de') byHcp[oc.handicap].over = parseFloat(oc.value);
              if (oc.name === 'Moins de') byHcp[oc.handicap].under = parseFloat(oc.value);
            }
            const lines = Object.entries(byHcp).filter(([h, v]) => v.over && v.under).map(([h, v]) => ({ hcp: h, over: v.over, under: v.under }));
            if (lines.length) evObj.ou = lines;
          }
        }
        const dc = (ev.markets || []).find(m => m.name === 'Double Chance');
        if (dc) { const D = o(dc); evObj.dc = { '1x': D['1X'], 'x2': D['X2'], '12': D['12'] }; }
        const btts = (ev.markets || []).find(m => m.name === 'Les Deux Equipes Marquent' || m.name === 'Les Deux Équipes Marquent');
        if (btts) { const B = o(btts); evObj.btts = { yes: B['Oui'], no: B['Non'] }; }
        if (evObj.h) events.push(evObj);
      }
      console.log(`[premierbet ${sportName}] +${events.length - before} events via proxy`);
    }
  } catch (e) {
    console.log(`[premierbet] fetch fail: ${e.message.slice(0, 90)}`);
  }
  return events;
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) });
}

// Screenshot a book's match page and send it to Telegram — so you SEE the exact bet
async function sendBookScreenshot(book, link, caption, oddsValue) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat || !link) return;
  const SHOT_DIR = path.join(__dirname, '../../arb_screenshots');
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = path.join(SHOT_DIR, `${book}_${Date.now()}.png`);
  let ctx;
  try {
    // 1xbet runs headed (needs display); others headless
    const headed = book === '1xbet';
    ctx = await launchBook(book, { headless: !headed, viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(book === '1xbet' ? 16000 : 9000); // let markets render
    // Highlight the odds button: find element whose text matches the odds, outline + scroll to it
    if (oddsValue) {
      const found = await page.evaluate((odds) => {
        const target = String(odds);
        const els = Array.from(document.querySelectorAll('a, button, span, div, [class*="odd"], [class*="coef"], [class*="price"]'));
        let hit = null;
        for (const el of els) {
          const t = (el.textContent || '').trim();
          if (t === target) { hit = el; break; }
        }
        if (!hit) {
          // fuzzy: element whose text STARTS with the odds (book adds suffixes)
          for (const el of els) {
            const t = (el.textContent || '').trim();
            if (t.startsWith(target) && t.length <= target.length + 6) { hit = el; break; }
          }
        }
        if (!hit) return { ok: false };
        hit.scrollIntoView({ block: 'center', inline: 'center' });
        hit.style.outline = '4px solid #ff2d2d';
        hit.style.outlineOffset = '2px';
        hit.style.boxShadow = '0 0 0 6px rgba(255,45,45,0.4)';
        return { ok: true, el: hit };
      }, oddsValue);
      console.log(`[Shot] ${book} highlighted odds ${oddsValue}: ${found.ok ? 'YES' : 'no exact match (plain shot)'}`);
      await page.waitForTimeout(1500);
      // Auto-CLICK the odds button (adds to bet slip — does NOT place the bet), then re-screenshot
      if (found.ok) {
        try {
          const clicked = await page.evaluate((odds) => {
            const target = String(odds);
            const els = Array.from(document.querySelectorAll('a, button, span, div, [class*="odd"], [class*="coef"], [class*="price"]'));
            let hit = null;
            for (const el of els) {
              const t = (el.textContent || '').trim();
              if (t === target) { hit = el; break; }
            }
            if (!hit) for (const el of els) {
              const t = (el.textContent || '').trim();
              if (t.startsWith(target) && t.length <= target.length + 6) { hit = el; break; }
            }
            if (!hit) return false;
            // click the odds element, or its closest clickable ancestor
            let targetEl = hit;
            const ce = hit.closest('a, button, [class*="odd"], [class*="bet"], [class*="selection"], [class*="outcome"], [role="button"]');
            if (ce) targetEl = ce;
            targetEl.click();
            return true;
          }, oddsValue);
          console.log(`[Shot] ${book} auto-clicked odds: ${clicked ? 'YES (bet slip updated)' : 'no'}`);
          await page.waitForTimeout(3000);
        } catch (e) {
          console.log(`[Shot] ${book} click failed: ${e.message.slice(0, 60)}`);
        }
      }
    }
    await page.screenshot({ path: file, fullPage: false });
    await ctx.close();
    ctx = null;
    // Send as photo
    const form = new FormData();
    form.append('chat_id', chat);
    form.append('caption', caption);
    form.append('photo', new Blob([fs.readFileSync(file)], { type: 'image/png' }), `${book}.png`);
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
    const j = await r.json().catch(() => ({}));
    console.log(`[Shot] ${book} → ${j.ok ? 'sent' : j.description || 'failed'}`);
  } catch (e) {
    console.log(`[Shot] ${book} screenshot failed: ${e.message.slice(0, 80)}`);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

async function report(c) {
  const pct = c.pct;
  const suspicious = pct > MAX_PLAUSIBLE_ARB;
  const has1xbet = c.legs.some(l => l.book === '1xbet');
  const lines = [];
  lines.push(suspicious ? '⚠️ POSSIBLE ARB — VERIFY PRICES BEFORE BETTING' : '🎯 ARBITRAGE FOUND — BET NOW');
  lines.push(`${c.teams[0]} vs ${c.teams[1]}`);
  lines.push(`Market: ${c.kind}  |  Profit: ${pct.toFixed(2)}%`);
  lines.push(`Prices checked at ${new Date().toISOString().slice(11, 19)} UTC — verify on site NOW`);
  // Kickoff countdown — user decides if they have time to place both legs
  if (c.kickoff) {
    const mins = Math.round((c.kickoff - Date.now()) / 60000);
    if (mins > 0 && mins <= 30) lines.push(`⏰ KICKS OFF IN ${mins} MIN — place BOTH legs FAST`);
    else if (mins > 30) lines.push(`Kickoff in ${mins} min`);
    else lines.push(`⏰ KICKOFF IMMINENT (${mins} min) — likely too late, verify before betting`);
  }
  lines.push('─'.repeat(32));
  c.legs.forEach((s, i) => {
    const cap = s.book === '1xbet' ? '1xbet' : s.book === 'betfrenzy' ? 'BetFrenzy' : s.book === 'premierbet' ? 'PremierBet' : s.book === 'pmuc' ? 'PMUC' : s.book === 'betpawa' ? 'BetPawa' : s.book;
    lines.push(`${i + 1}) ON ${cap.toUpperCase()} → bet: ${s.bet}`);
    lines.push(`    Odds ${s.odds} | Stake ${s.stake} XAF → wins ${s.payout} XAF`);
    if (s.link) lines.push(`    Link: ${s.link}`);
  });
  lines.push('─'.repeat(32));
  lines.push(`Total stake 100 XAF → pays ${c.legs[0]?.payout} XAF whatever the result`);
  if (has1xbet) lines.push('⚠️ 1XBET odds come from their feed, NOT the live page. Confirm the price on 1xbet BEFORE betting — if it moved, the arb is gone.');
  if (suspicious) lines.push('⚠️ Over 15% profit = likely a stale price. Check odds are live on both sites first.');
  const full = lines.join('\n');
  console.log(full);
  await sendTelegram(full);
  // Screenshot each book's match page — only for Asian Handicap (the trickiest to identify:
  // handicap sign ± matters). Auto-click the odds button so the bet slip shows the selection.
  if (c.kind.startsWith('Asian Handicap')) {
    for (const s of c.legs) {
      if (s.link) await sendBookScreenshot(s.book, s.link, `${c.teams[0]} vs ${c.teams[1]} — ${s.bet} @ ${s.odds} (${s.book.toUpperCase()})`, s.odds);
    }
  }
}

// Alert once per book outage (not every 2-min cycle) — resets when the book recovers
const bookDown = new Set();
const bookDownSince = {};
async function alertBookFailure(counts) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  const MIN_EVENTS = { betfrenzy: 100, pmuc: 3, premierbet: 3, '1xbet': 10 };
  for (const [book, count] of Object.entries(counts)) {
    const min = MIN_EVENTS[book];
    if (min === undefined) continue;
    const isDown = count < min;
    if (isDown && !bookDown.has(book)) {
      bookDown.add(book);
      bookDownSince[book] = new Date().toISOString().slice(11, 19);
      const msg = `⚠️ ${book.toUpperCase()} is DOWN (${count} events) since ${bookDownSince[book]} UTC — check session/proxy. Recovery will be notified.`;
      console.log('[Alert]', msg);
      if (token && chat) await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text: msg }) });
    } else if (!isDown && bookDown.has(book)) {
      bookDown.delete(book);
      const msg = `✅ ${book.toUpperCase()} is BACK (${count} events)`;
      console.log('[Alert]', msg);
      if (token && chat) await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text: msg }) });
    }
  }
}

async function collectCandidates() {
  console.log(`[Arb] Fetch ${new Date().toISOString()}`);
  const bf = await fetchBetfrenzy().catch(() => []);
  const bp = await fetchBetpawa().catch(() => []);
  const pm = await fetchPmuc().catch(() => []);
  const pb = await fetchPremierbet().catch(() => []);
  const xb = await fetch1xbet().catch(() => []);
  const sb = await fetchSportybet().catch(() => []);
console.log(`[Arb] betfrenzy ${bf.length}, pmuc ${pm.length}, premierbet ${pb.length}, 1xbet ${xb.length}, sportybet ${sb.length}`);
  await alertBookFailure({ betfrenzy: bf.length, pmuc: pm.length, premierbet: pb.length, '1xbet': xb.length });
  // Keep all events — kickoff is tagged per candidate so alerts show a countdown
  // (user decides; near-kickoff arbs are valid if placed fast)
  const all = [...bf, ...bp, ...pm, ...pb, ...xb, ...sb];
  return findCandidates(all);
}

// Fetch only the involved books SIMULTANEOUSLY (aligned snapshot)
async function collectBooksParallel(books) {
  const fns = [];
  if (books.has('betfrenzy')) fns.push(fetchBetfrenzy().catch(() => []));
  if (books.has('pmuc')) fns.push(fetchPmuc().catch(() => []));
  if (books.has('premierbet')) fns.push(fetchPremierbet().catch(() => []));
  if (books.has('1xbet')) fns.push(fetch1xbet().catch(() => []));
  if (books.has('betpawa')) fns.push(fetchBetpawa().catch(() => []));
  if (books.has('sportybet')) fns.push(fetchSportybet().catch(() => []));
  const results = await Promise.all(fns);
  return results.flat();
}

// Re-run candidate detection over an event set and return the one matching `c.key`
function findCandidateIn(events, c) {
  const found = findCandidates(events);
  return found.find(x => x.key === c.key) || null;
}

// Grouping logic — pure function over events; reused by all verification passes
function findCandidates(all) {
  const found = [];
  const cand = (key, kind, teams, legs, inv, kickoff) => found.push({ key, kind, teams, legs, pct: (1 - inv) * 100, kickoff });

  // 1X2 grouping — league + youth/senior aware key so same-name matches in
  // different competitions (Champions League vs Youth League) never merge
  const g = new Map();
  for (const ev of all) { if (ev.h) { const k = `${norm(ev.home)}|${norm(ev.away)}|${canonLeague(ev.league)}${youthMark(ev.home + ev.away) ? '|youth' : ''}`; (g.get(k) || g.set(k, { matches: [] }).get(k)).matches.push(ev); } }
for (const [k, grp] of g) {
    if (grp.matches.length < 2) continue;
    const h = grp.matches.reduce((b, m) => m.h > b.odds ? { book: m.book, odds: m.h, link: m.link, home: m.home, away: m.away } : b, { book: '', odds: 0 });
    const d = grp.matches.reduce((b, m) => (m.d || 0) > b.odds ? { book: m.book, odds: m.d, link: m.link, home: m.home, away: m.away } : b, { book: '', odds: 0 });
    const a = grp.matches.reduce((b, m) => m.a > b.odds ? { book: m.book, odds: m.a, link: m.link, home: m.home, away: m.away } : b, { book: '', odds: 0 });
    const srcs = new Set([h.book, d.book, a.book].filter(Boolean));
    if (srcs.size < 2) continue; // needs >=2 distinct books across the 3 legs
    const inv = 1/h.odds + 1/d.odds + 1/a.odds;
    if (inv < 1) { const r = calcArb([{ book: h.book, odds: h.odds }, { book: d.book, odds: d.odds }, { book: a.book, odds: a.odds }]); cand(`1X2|${k}`, '1X2 — Match Winner', [h.home || grp.matches[0].home, h.away || grp.matches[0].away],
      [{ book: h.book, bet: (h.home || grp.matches[0].home) + ' to win (1)', odds: h.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout, link: h.link },
       { book: d.book, bet: 'Draw (X)', odds: d.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout, link: d.link },
       { book: a.book, bet: (a.away || grp.matches[0].away) + ' to win (2)', odds: a.odds, stake: r.stakes[2].stake, payout: r.stakes[2].payout, link: a.link }], inv, grp.matches[0].kickoff); }
  }

// ── O/U grouping (asian lines) — best over & best under must be DIFFERENT books ──
  const ou = new Map();
  for (const ev of all) { for (const o of ev.ou || []) { if (!o.hcp || !o.over || !o.under) continue; if (o.over < 1.01 || o.over > 20 || o.under < 1.01 || o.under > 20) continue; const k = `${norm(ev.home)}|${norm(ev.away)}|${canonLeague(ev.league)}${youthMark(ev.home + ev.away) ? '|youth' : ''}|${o.hcp}`; (ou.get(k) || ou.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, over: o.over, under: o.under, link: ev.link }); } }
  for (const [k, grp] of ou) {
    if (grp.matches.length < 2) continue;
    const over = grp.matches.reduce((b, m) => m.over > b.odds ? { book: m.book, odds: m.over, link: m.link } : b, { book: '', odds: 0 });
    const under = grp.matches.reduce((b, m) => m.under > b.odds ? { book: m.book, odds: m.under, link: m.link } : b, { book: '', odds: 0 });
    if (!over.book || over.book === under.book) continue; // same book both sides = voided, not arb
    const inv = 1/over.odds + 1/under.odds;
    if (inv < 1) { const r = calcArb([{ book: over.book, odds: over.odds }, { book: under.book, odds: under.odds }]); const hcp = k.split('|').pop(); cand(`OU|${k}`, `Over/Under ${hcp} Goals`, [k.split('|')[0], k.split('|')[1]],
      [{ book: over.book, bet: `Over ${hcp} goals`, odds: over.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout, link: over.link },
       { book: under.book, bet: `Under ${hcp} goals`, odds: under.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout, link: under.link }], inv, grp.matches[0].kickoff); }
  }

// ── Corners grouping (2-way over/under corners) — cross-book ──
  const cr = new Map();
  for (const ev of all) { for (const o of ev.corners || []) { if (!o.hcp || !o.over || !o.under) continue; if (o.over < 1.01 || o.over > 20 || o.under < 1.01 || o.under > 20) continue; const k = `${norm(ev.home)}|${norm(ev.away)}|${canonLeague(ev.league)}${youthMark(ev.home + ev.away) ? '|youth' : ''}|${o.hcp}`; (cr.get(k) || cr.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, over: o.over, under: o.under, link: ev.link }); } }
  for (const [k, grp] of cr) {
    if (grp.matches.length < 2) continue;
    const over = grp.matches.reduce((b, m) => m.over > b.odds ? { book: m.book, odds: m.over, link: m.link } : b, { book: '', odds: 0 });
    const under = grp.matches.reduce((b, m) => m.under > b.odds ? { book: m.book, odds: m.under, link: m.link } : b, { book: '', odds: 0 });
    if (!over.book || over.book === under.book) continue;
    const inv = 1/over.odds + 1/under.odds;
    if (inv < 1) { const r = calcArb([{ book: over.book, odds: over.odds }, { book: under.book, odds: under.odds }]); const hcp = k.split('|').pop(); cand(`CR|${k}`, `Corners Over/Under ${hcp}`, [k.split('|')[0], k.split('|')[1]],
      [{ book: over.book, bet: `Over ${hcp} corners`, odds: over.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout, link: over.link },
       { book: under.book, bet: `Under ${hcp} corners`, odds: under.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout, link: under.link }], inv, grp.matches[0].kickoff); }
  }

  // ── Cards grouping (2-way over/under cards) — cross-book ──
  const cd = new Map();
  for (const ev of all) { for (const o of ev.cards || []) { if (!o.hcp || !o.over || !o.under) continue; if (o.over < 1.01 || o.over > 20 || o.under < 1.01 || o.under > 20) continue; const k = `${norm(ev.home)}|${norm(ev.away)}|${canonLeague(ev.league)}${youthMark(ev.home + ev.away) ? '|youth' : ''}|${o.hcp}`; (cd.get(k) || cd.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, over: o.over, under: o.under, link: ev.link }); } }
  for (const [k, grp] of cd) {
    if (grp.matches.length < 2) continue;
    const over = grp.matches.reduce((b, m) => m.over > b.odds ? { book: m.book, odds: m.over, link: m.link } : b, { book: '', odds: 0 });
    const under = grp.matches.reduce((b, m) => m.under > b.odds ? { book: m.book, odds: m.under, link: m.link } : b, { book: '', odds: 0 });
    if (!over.book || over.book === under.book) continue;
    const inv = 1/over.odds + 1/under.odds;
    if (inv < 1) { const r = calcArb([{ book: over.book, odds: over.odds }, { book: under.book, odds: under.odds }]); const hcp = k.split('|').pop(); cand(`CD|${k}`, `Cards Over/Under ${hcp}`, [k.split('|')[0], k.split('|')[1]],
      [{ book: over.book, bet: `Over ${hcp} cards`, odds: over.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout, link: over.link },
       { book: under.book, bet: `Under ${hcp} cards`, odds: under.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout, link: under.link }], inv, grp.matches[0].kickoff); }
  }

// ── Double Chance grouping (3-way: 1X/X2/12) ──
  const dc = new Map();
  for (const ev of all) { if (ev.dc) { const k = `${norm(ev.home)}|${norm(ev.away)}|${canonLeague(ev.league)}${youthMark(ev.home + ev.away) ? '|youth' : ''}`; (dc.get(k) || dc.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, dc: ev.dc, link: ev.link }); } }
  for (const [k, grp] of dc) {
    if (grp.matches.length < 2) continue;
    const b1x = grp.matches.reduce((b, m) => m.dc['1x'] > b.odds ? { book: m.book, odds: m.dc['1x'], link: m.link } : b, { book: '', odds: 0 });
    const bx2 = grp.matches.reduce((b, m) => m.dc['x2'] > b.odds ? { book: m.book, odds: m.dc['x2'], link: m.link } : b, { book: '', odds: 0 });
    const b12 = grp.matches.reduce((b, m) => m.dc['12'] > b.odds ? { book: m.book, odds: m.dc['12'], link: m.link } : b, { book: '', odds: 0 });
    const srcs = new Set([b1x.book, bx2.book, b12.book].filter(Boolean));
    if (srcs.size < 2) continue;
    const inv = 1/b1x.odds + 1/bx2.odds + 1/b12.odds;
    if (inv < 1) { const r = calcArb([{ book: b1x.book, odds: b1x.odds }, { book: bx2.book, odds: bx2.odds }, { book: b12.book, odds: b12.odds }]); cand(`DC|${k}`, 'Double Chance', [k.split('|')[0], k.split('|')[1]],
      [{ book: b1x.book, bet: k.split('|')[0] + ' or Draw (1X)', odds: b1x.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout, link: b1x.link },
       { book: bx2.book, bet: k.split('|')[1] + ' or Draw (X2)', odds: bx2.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout, link: bx2.link },
       { book: b12.book, bet: 'No Draw (12)', odds: b12.odds, stake: r.stakes[2].stake, payout: r.stakes[2].payout, link: b12.link }], inv, grp.matches[0].kickoff); }
  }

// ── AH pairing (home -hcp vs away +hcp) — best sides must be DIFFERENT books ──
  const ah = new Map();
  for (const ev of all) { for (const o of ev.ah || []) { if (!o.hcp) continue; const k = `${norm(ev.home)}|${norm(ev.away)}|${canonLeague(ev.league)}${youthMark(ev.home + ev.away) ? '|youth' : ''}|${o.hcp}`; (ah.get(k) || ah.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, home: o.home, away: o.away, link: ev.link }); } }
  for (const [k, grp] of ah) {
    if (grp.matches.length < 2) continue;
    const bHome = grp.matches.reduce((b, m) => m.home > b.odds ? { book: m.book, odds: m.home, link: m.link } : b, { book: '', odds: 0 });
    const bAway = grp.matches.reduce((b, m) => m.away > b.odds ? { book: m.book, odds: m.away, link: m.link } : b, { book: '', odds: 0 });
    if (!bHome.book || bHome.book === bAway.book) continue;
    const inv = 1/bHome.odds + 1/bAway.odds;
    if (inv < 1) { const r = calcArb([{ book: bHome.book, odds: bHome.odds }, { book: bAway.book, odds: bAway.odds }]); const hcp = k.split('|').pop(); cand(`AH|${k}`, `Asian Handicap ${hcp}`, [k.split('|')[0], k.split('|')[1]],
      [{ book: bHome.book, bet: k.split('|')[0] + ' -' + hcp, odds: bHome.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout, link: bHome.link },
       { book: bAway.book, bet: k.split('|')[1] + ' +' + hcp, odds: bAway.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout, link: bAway.link }], inv, grp.matches[0].kickoff); }
  }
// ── BTTS grouping (2-way yes/no) — best sides must be DIFFERENT books ──
  const bts = new Map();
  for (const ev of all) { if (ev.btts) { const k = `${norm(ev.home)}|${norm(ev.away)}|${canonLeague(ev.league)}${youthMark(ev.home + ev.away) ? '|youth' : ''}`; (bts.get(k) || bts.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, yes: ev.btts.yes, no: ev.btts.no, link: ev.link }); } }
  for (const [k, grp] of bts) {
    if (grp.matches.length < 2) continue;
    const bYes = grp.matches.reduce((b, m) => m.yes > b.odds ? { book: m.book, odds: m.yes, link: m.link } : b, { book: '', odds: 0 });
    const bNo = grp.matches.reduce((b, m) => m.no > b.odds ? { book: m.book, odds: m.no, link: m.link } : b, { book: '', odds: 0 });
    if (!bYes.book || bYes.book === bNo.book) continue;
    const inv = 1/bYes.odds + 1/bNo.odds;
    if (inv < 1) { const r = calcArb([{ book: bYes.book, odds: bYes.odds }, { book: bNo.book, odds: bNo.odds }]); cand(`BTTS|${k}`, 'Both Teams To Score', [k.split('|')[0], k.split('|')[1]],
      [{ book: bYes.book, bet: 'Both teams score (Yes)', odds: bYes.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout, link: bYes.link },
       { book: bNo.book, bet: 'Not both score (No)', odds: bNo.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout, link: bNo.link }], inv, grp.matches[0].kickoff); }
  }
// ── DNB grouping (2-way home/away) — best sides must be DIFFERENT books ──
  const dnb = new Map();
  for (const ev of all) { if (ev.dnb) { const k = `${norm(ev.home)}|${norm(ev.away)}|${canonLeague(ev.league)}${youthMark(ev.home + ev.away) ? '|youth' : ''}`; (dnb.get(k) || dnb.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, home: ev.dnb.home, away: ev.dnb.away, link: ev.link }); } }
  for (const [k, grp] of dnb) {
    if (grp.matches.length < 2) continue;
    const bHome = grp.matches.reduce((b, m) => m.home > b.odds ? { book: m.book, odds: m.home, link: m.link } : b, { book: '', odds: 0 });
    const bAway = grp.matches.reduce((b, m) => m.away > b.odds ? { book: m.book, odds: m.away, link: m.link } : b, { book: '', odds: 0 });
    if (!bHome.book || bHome.book === bAway.book) continue;
    const inv = 1/bHome.odds + 1/bAway.odds;
    if (inv < 1) { const r = calcArb([{ book: bHome.book, odds: bHome.odds }, { book: bAway.book, odds: bAway.odds }]); cand(`DNB|${k}`, 'Draw No Bet', [k.split('|')[0], k.split('|')[1]],
      [{ book: bHome.book, bet: k.split('|')[0] + ' to win (draw refunds)', odds: bHome.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout, link: bHome.link },
       { book: bAway.book, bet: k.split('|')[1] + ' to win (draw refunds)', odds: bAway.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout, link: bAway.link }], inv, grp.matches[0].kickoff); }
  }
  console.log(`[Arb] Candidates: ${found.length} (${g.size} 1X2, ${ou.size} O/U, ${cr.size} Corners, ${cd.size} Cards, ${dc.size} DC, ${ah.size} AH, ${bts.size} BTTS, ${dnb.size} DNB).`);
  return found;
}

async function scan() {
  const first = await collectCandidates();
  if (first.length === 0) { console.log('[Verify] 0 candidates — nothing to verify.'); return; }
  // Two-pass verification: wait 20s, re-fetch, only report arbs that PERSIST with stable odds
  console.log(`[Verify] ${first.length} candidates — re-fetching in 20s to confirm...`);
  await new Promise(r => setTimeout(r, 20000));
  const second = await collectCandidates();
  const secondByKey = new Map(second.map(c => [c.key, c]));
  const confirmed = [];
  const vanished = [];
  for (const c of first) {
    const c2 = secondByKey.get(c.key);
    if (!c2) { vanished.push(c); continue; }
    // Odds must be stable within 2% between passes — bigger move = repricing, arb dead
    const odds1 = c.legs.map(l => l.odds);
    const odds2 = c2.legs.map(l => l.odds);
    const stable = odds1.length === odds2.length && odds1.every((o, i) => Math.abs(o - odds2[i]) / o < 0.02);
    if (stable) confirmed.push(c2); // report the FRESHEST pass-2 odds
    else { vanished.push(c); console.log(`[Verify] dropped repriced: ${c.kind} ${c.teams.join(' vs ')}`); }
  }
  console.log(`[Verify] confirmed ${confirmed.length}, vanished ${vanished.length} (stale/repriced dropped).`);
  // THIRD PASS — same-instant confirmation. Pass 1/2 fetch books sequentially (~60s apart),
  // so an "arb" can be built from odds that never coexisted. Re-fetch ONLY the involved
  // books simultaneously and require the arb to hold on that aligned snapshot.
  const aligned = [];
  for (const c of confirmed) {
    const books = new Set(c.legs.map(l => l.book));
    const fresh = await collectBooksParallel(books);
    const matchKey = c.key.split('|')[0] + '|' + c.key.split('|').slice(1, 3).join('|');
    const c3 = findCandidateIn(fresh, c);
    if (!c3) {
      console.log(`[Verify] dropped (not found in aligned snapshot): ${c.kind} ${c.teams.join(' vs ')}`);
      continue;
    }
    const o1 = c.legs.map(l => l.odds);
    const o3 = c3.legs.map(l => l.odds);
    const stillArb = o1.length === o3.length && o1.every((o, i) => Math.abs(o - o3[i]) / o < 0.03);
    if (stillArb) aligned.push(c3);
    else console.log(`[Verify] dropped (odds moved in aligned snapshot): ${c.kind} ${c.teams.join(' vs ')}`);
  }
  console.log(`[Verify] aligned-snapshot confirmed ${aligned.length}/${confirmed.length}.`);
  for (const c of aligned) await report(c);
  for (const c of confirmed) if (!aligned.includes(c)) console.log(`[Verify] dropped: ${c.kind} ${c.teams.join(' vs ')}`);
}

// ── Modes ──
if (warm) {
  // pmuc/premierbet share one profile; 1xbet uses its own (separate session)
  const ctx = await launchBook('warm', { headless: false, viewport: { width: 1280, height: 800 } });
  for (const url of ['https://www.pmuc.cm/sports', 'https://www.premierbet.com/cm/']) {
    const page = await ctx.newPage();
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}
    console.log(`[Warm] ${url}`); await page.waitForTimeout(12000); await page.close();
  }
  await ctx.close();
  const xb = await launchBook('1xbet', { headless: false, viewport: { width: 1280, height: 800 } });
  const xpage = await xb.newPage();
  try { await xpage.goto('https://1xbet.cm/en/line', { waitUntil: 'domcontentloaded', timeout: 40000 }); } catch {}
  console.log('[Warm] https://1xbet.cm/en/line (saving session...)');
  await xpage.waitForTimeout(20000);
  await xb.close();
  console.log('[Warm] done. Run without --warm now.');
} else if (once) {
  await scan();
} else {
  console.log(`[Arb] Loop mode: scanning every ${loopMin} min. Ctrl+C to stop.`);
  for (;;) { await scan(); await new Promise(r => setTimeout(r, loopMin * 60000)); }
}



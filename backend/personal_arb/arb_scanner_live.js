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
const PROFILE_ROOT = path.join(__dirname, '../../.playwright_profile');
const prof = name => { const p = path.join(PROFILE_ROOT, name); if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); return p; };
// Real cross-book arbs are ~1-5%. >15% means a stale/wrong line — flag but don't trust.
const MAX_PLAUSIBLE_ARB = 15;
const args = process.argv.slice(2);
const warm = args.includes('--warm');
const once = args.includes('--once');
const loopMin = parseInt(args.find(a => a.startsWith('--loop='))?.split('=')[1] || '3', 10);

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/fc$|cf$|sc$|ac$/g, '');

async function fetchBetfrenzy() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('https://betfrenzy.cm/api/v1/sports/matchs?SportId=1&EventStatus=PRE', { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) { await new Promise(r => setTimeout(r, 3000)); continue; }
      const j = await r.json();
      const out = [];
      for (const lg of j) for (const ev of lg.events || []) {
        const o = ev.odds || {};
        if (o['1_1']) out.push({ book: 'betfrenzy', home: ev.home?.name, away: ev.away?.name, league: ev.league?.name,
          h: parseFloat(o['1_1'].home_od), d: parseFloat(o['1_1'].draw_od), a: parseFloat(o['1_1'].away_od),
          dc: o['1_8'] ? { '1x': parseFloat(o['1_8'].home_od), 'x2': parseFloat(o['1_8'].draw_od), '12': parseFloat(o['1_8'].away_od) } : null,
          ah: [o['1_2'], o['1_5']].filter(Boolean).map(x => ({ hcp: x.handicap, home: parseFloat(x.home_od), away: parseFloat(x.away_od) })),
          ou: [o['1_3'], o['1_6'], o['1_7']].filter(Boolean).map(x => ({ hcp: x.handicap, over: parseFloat(x.over_od), under: parseFloat(x.under_od) })).filter(x => x.over && x.under && parseFloat(x.hcp) <= 3.5) });
      }
      if (out.length > 0) return out;
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) { await new Promise(r => setTimeout(r, 3000)); }
  }
  return [];
}

async function fetchBetpawa() {
  const ctx = await chromium.launchPersistentContext(prof('betpawa'), { headless: true, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  let items = [];
  page.on('response', async r => { const u = r.url();
    if (u.includes('/api/sportsbook/v1/combo-cards/list')) { try { const j = await r.json(); items = (j.items || []).map(it => ({ book: 'betpawa', home: it.eventInfo?.participants?.[0]?.name, away: it.eventInfo?.participants?.[1]?.name })).filter(x => x.home); } catch {} } });
  await page.goto('https://www.betpawa.cm/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(7000); await ctx.close();
  return items;
}

async function fetchPmuc() {
  const ctx = await chromium.launchPersistentContext(prof('pmuc'), { headless: true, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  let events = [];
  page.on('response', async r => { const u = r.url();
    if (u.includes('/api/events/sports/popular') && u.includes('betTypeId=10001')) { try { const j = await r.json();
      for (const ev of j) for (const bt of ev.eventBetTypes || []) if (bt.name === 'Résultat du match' || bt.name.includes('match')) {
        const o1 = bt.eventBetTypeItems?.find(i => i.shortName === '1')?.odds, ox = bt.eventBetTypeItems?.find(i => i.shortName === 'X')?.odds, o2 = bt.eventBetTypeItems?.find(i => i.shortName === '2')?.odds;
        if (o1) events.push({ book: 'pmuc', home: ev.homeTeamName, away: ev.awayTeamName, h: o1, d: ox, a: o2 });
      } } catch {} } });
  await page.goto('https://www.pmuc.cm/sports', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(7000); await ctx.close();
  return events;
}

async function fetch1xbet() {
  const ctx = await chromium.launchPersistentContext(prof('1xbet'), { headless: false, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const events = [];
page.on('response', async r => {
    const u = r.url();
    if (u.includes('/v3/games1x2')) {
      try { const j = await r.json();
        const seen = new Set();
        const snapshot = [];
        let fb = 0, parsed = 0;
        for (const ev of j) {
          if (ev.sport?.id !== 1) continue;
          fb++;
          const groups = {};
          for (const g of ev.eventGroups || []) groups[g.groupId] = g.events || [];
          const cf = (arr, t) => arr?.find(x => x[0]?.type === t)?.[0]?.cf;
          const g1 = groups[1] || [];
          if (cf(g1, 1) && cf(g1, 3)) {
            parsed++;
            const evObj = { book: '1xbet', home: ev.opponent1?.fullName, away: ev.opponent2?.fullName, league: ev.liga?.name,
              h: parseFloat(cf(g1, 1)), d: cf(g1, 2) ? parseFloat(cf(g1, 2)) : null, a: parseFloat(cf(g1, 3)) };
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
            // dedupe by normalized teams — games1x2 fires twice (poll refresh), keep latest
            const key = `${ev.opponent1?.fullName?.toLowerCase()}|${ev.opponent2?.fullName?.toLowerCase()}`;
            if (!seen.has(key)) { seen.add(key); snapshot.push(evObj); }
          }
        }
        events.length = 0; events.push(...snapshot); // latest snapshot wins
        console.log(`[1xbet] football ${fb}, parsed ${parsed}, unique ${snapshot.length}`);
      } catch (e) { console.log('[1xbet] parse fail', e.message.slice(0, 50)); }
    }
  });
  await page.goto('https://1xbet.cm/en/line', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  await ctx.close();
  return events.filter(e => e.h);
}

async function fetchPremierbet() {
  const ctx = await chromium.launchPersistentContext(prof('premierbet'), { headless: true, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const events = [];
  let eventIds = [];
  page.on('response', async r => {
    const u = r.url();
    if (u.includes('sports-api.premierbet') && u.includes('competitionId=')) {
      try { const j = await r.json();
        for (const cat of j.data?.categories || []) for (const comp of cat.competitions || []) for (const ev of comp.events || []) {
          if (ev.id && ev.eventNames?.[0]) eventIds.push({ id: ev.id, home: ev.eventNames[0], away: ev.eventNames[1] });
        } } catch {}
    }
  });
  await page.goto('https://www.premierbet.com/cm/sport/football/competition/1047522?sportRef=1&competitionId=1047522&name=Ligue%20des%20Champions%20UEFA&isGroup=false', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(6000);
  // Batch-fetch each event's full markets via same-origin fetch (cookies from session)
  for (const e of eventIds.slice(0, 10)) {
    try {
      const j = await page.evaluate(async (id) => {
        const r = await fetch(`https://sports-api.premierbet.com/cm/v1/events/${id}?country=CM&group=g1&platform=desktop&locale=fr`);
        return r.ok ? r.json() : null;
      }, e.id);
      if (!j) continue;
      const groups = j.marketGroups || [];
      const flat = [];
      for (const g of groups) for (const m of g.markets || []) flat.push(m);
const o12 = flat.find(m => m.name === '1X2');
      const ouMkt = flat.find(m => m.name === 'Total de Buts');
      const dc = flat.find(m => m.name === 'Double Chance');
      const btts = flat.find(m => m.name === 'Les Deux Equipes Marquent' || m.name === 'Les Deux Équipes Marquent');
      const o = (mm) => { const x = {}; for (const oc of mm?.outcomes || []) x[oc.name] = parseFloat(oc.value); return x; };
      const evObj = { book: 'premierbet', home: e.home, away: e.away,
        h: o12 ? parseFloat(o12.outcomes.find(x => x.name === '1')?.value) : null,
        d: o12 ? parseFloat(o12.outcomes.find(x => x.name === 'X')?.value) : null,
        a: o12 ? parseFloat(o12.outcomes.find(x => x.name === '2')?.value) : null };
      if (ouMkt) {
        // group outcomes by handicap: { '2.5': {over, under}, ... }
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
      if (dc) { const D = o(dc); evObj.dc = { '1x': D['1X'], 'x2': D['X2'], '12': D['12'] }; }
      if (btts) { const B = o(btts); evObj.btts = { yes: B['Oui'], no: B['Non'] }; }
      if (evObj.h) events.push(evObj);
} catch (e) {}
  }
  await page.waitForTimeout(1000);
  await ctx.close();
  return events;
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) });
}

async function report(c) {
  const pct = c.pct;
  const suspicious = pct > MAX_PLAUSIBLE_ARB;
  const has1xbet = c.legs.some(l => l.book === '1xbet');
  const lines = [];
  lines.push(suspicious ? '⚠️ POSSIBLE ARB — VERIFY PRICES BEFORE BETTING' : '🎯 ARBITRAGE FOUND — BET NOW');
  lines.push(`${c.teams[0]} vs ${c.teams[1]}`);
  lines.push(`Market: ${c.kind}  |  Profit: ${pct.toFixed(2)}%`);
  lines.push('─'.repeat(32));
  c.legs.forEach((s, i) => {
    const cap = s.book === '1xbet' ? '1xbet' : s.book === 'betfrenzy' ? 'BetFrenzy' : s.book === 'premierbet' ? 'PremierBet' : s.book === 'pmuc' ? 'PMUC' : s.book === 'betpawa' ? 'BetPawa' : s.book;
    lines.push(`${i + 1}) ON ${cap.toUpperCase()} → bet: ${s.bet}`);
    lines.push(`    Odds ${s.odds} | Stake ${s.stake} XAF → wins ${s.payout} XAF`);
  });
  lines.push('─'.repeat(32));
  lines.push(`Total stake 100 XAF → pays ${c.legs[0]?.payout} XAF whatever the result`);
  if (has1xbet) lines.push('⚠️ 1XBET odds come from their feed, NOT the live page. Confirm the price on 1xbet BEFORE betting — if it moved, the arb is gone.');
  if (suspicious) lines.push('⚠️ Over 15% profit = likely a stale price. Check odds are live on both sites first.');
  const full = lines.join('\n');
  console.log(full);
  await sendTelegram(full);
}

async function collectCandidates() {
  console.log(`[Arb] Fetch ${new Date().toISOString()}`);
  const bf = await fetchBetfrenzy().catch(() => []);
  const bp = await fetchBetpawa().catch(() => []);
  const pm = await fetchPmuc().catch(() => []);
  const pb = await fetchPremierbet().catch(() => []);
  const xb = await fetch1xbet().catch(() => []);
  console.log(`[Arb] betfrenzy ${bf.length}, betpawa ${bp.length}, pmuc ${pm.length}, premierbet ${pb.length}, 1xbet ${xb.length}`);
  const all = [...bf, ...bp, ...pm, ...pb, ...xb];
  const found = [];
  const cand = (key, kind, teams, legs, inv) => found.push({ key, kind, teams, legs, pct: (1 - inv) * 100 });

  // 1X2 grouping — include league in key when available (youth/senior same-name guard)
  const g = new Map();
  for (const ev of all) { if (ev.h) { const k = `${norm(ev.home)}|${norm(ev.away)}|${norm(ev.league || '')}`; (g.get(k) || g.set(k, { matches: [] }).get(k)).matches.push(ev); } }
for (const [k, grp] of g) {
    if (grp.matches.length < 2) continue;
    const h = grp.matches.reduce((b, m) => m.h > b.odds ? { book: m.book, odds: m.h } : b, { book: '', odds: 0 });
    const d = grp.matches.reduce((b, m) => (m.d || 0) > b.odds ? { book: m.book, odds: m.d } : b, { book: '', odds: 0 });
    const a = grp.matches.reduce((b, m) => m.a > b.odds ? { book: m.book, odds: m.a } : b, { book: '', odds: 0 });
    const srcs = new Set([h.book, d.book, a.book].filter(Boolean));
    if (srcs.size < 2) continue; // needs >=2 distinct books across the 3 legs
    const inv = 1/h.odds + 1/d.odds + 1/a.odds;
    if (inv < 1) { const r = calcArb([{ book: h.book, odds: h.odds }, { book: d.book, odds: d.odds }, { book: a.book, odds: a.odds }]); cand(`1X2|${k}`, '1X2 — Match Winner', [grp.matches[0].home, grp.matches[0].away],
      [{ book: h.book, bet: grp.matches[0].home + ' to win (1)', odds: h.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout },
       { book: d.book, bet: 'Draw (X)', odds: d.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout },
       { book: a.book, bet: grp.matches[0].away + ' to win (2)', odds: a.odds, stake: r.stakes[2].stake, payout: r.stakes[2].payout }], inv); }
  }

// ── O/U grouping (asian lines) — best over & best under must be DIFFERENT books ──
  const ou = new Map();
  for (const ev of all) { for (const o of ev.ou || []) { if (!o.hcp || !o.over || !o.under) continue; if (o.over < 1.01 || o.over > 20 || o.under < 1.01 || o.under > 20) continue; const k = `${norm(ev.home)}|${norm(ev.away)}|${o.hcp}`; (ou.get(k) || ou.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, over: o.over, under: o.under }); } }
  for (const [k, grp] of ou) {
    if (grp.matches.length < 2) continue;
    const over = grp.matches.reduce((b, m) => m.over > b.odds ? { book: m.book, odds: m.over } : b, { book: '', odds: 0 });
    const under = grp.matches.reduce((b, m) => m.under > b.odds ? { book: m.book, odds: m.under } : b, { book: '', odds: 0 });
    if (!over.book || over.book === under.book) continue; // same book both sides = voided, not arb
    const inv = 1/over.odds + 1/under.odds;
    if (inv < 1) { const r = calcArb([{ book: over.book, odds: over.odds }, { book: under.book, odds: under.odds }]); cand(`OU|${k}`, `Over/Under ${k.split('|')[2]} Goals`, [k.split('|')[0], k.split('|')[1]],
      [{ book: over.book, bet: `Over ${k.split('|')[2]} goals`, odds: over.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout },
       { book: under.book, bet: `Under ${k.split('|')[2]} goals`, odds: under.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout }], inv); }
  }

// ── Double Chance grouping (3-way: 1X/X2/12) ──
  const dc = new Map();
  for (const ev of all) { if (ev.dc) { const k = `${norm(ev.home)}|${norm(ev.away)}`; (dc.get(k) || dc.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, dc: ev.dc }); } }
  for (const [k, grp] of dc) {
    if (grp.matches.length < 2) continue;
    const b1x = grp.matches.reduce((b, m) => m.dc['1x'] > b.odds ? { book: m.book, odds: m.dc['1x'] } : b, { book: '', odds: 0 });
    const bx2 = grp.matches.reduce((b, m) => m.dc['x2'] > b.odds ? { book: m.book, odds: m.dc['x2'] } : b, { book: '', odds: 0 });
    const b12 = grp.matches.reduce((b, m) => m.dc['12'] > b.odds ? { book: m.book, odds: m.dc['12'] } : b, { book: '', odds: 0 });
    const srcs = new Set([b1x.book, bx2.book, b12.book].filter(Boolean));
    if (srcs.size < 2) continue;
    const inv = 1/b1x.odds + 1/bx2.odds + 1/b12.odds;
    if (inv < 1) { const r = calcArb([{ book: b1x.book, odds: b1x.odds }, { book: bx2.book, odds: bx2.odds }, { book: b12.book, odds: b12.odds }]); cand(`DC|${k}`, 'Double Chance', [k.split('|')[0], k.split('|')[1]],
      [{ book: b1x.book, bet: k.split('|')[0] + ' or Draw (1X)', odds: b1x.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout },
       { book: bx2.book, bet: k.split('|')[1] + ' or Draw (X2)', odds: bx2.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout },
       { book: b12.book, bet: 'No Draw (12)', odds: b12.odds, stake: r.stakes[2].stake, payout: r.stakes[2].payout }], inv); }
  }

// ── AH pairing (home -hcp vs away +hcp) — best sides must be DIFFERENT books ──
  const ah = new Map();
  for (const ev of all) { for (const o of ev.ah || []) { if (!o.hcp) continue; const k = `${norm(ev.home)}|${norm(ev.away)}|${o.hcp}`; (ah.get(k) || ah.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, home: o.home, away: o.away }); } }
  for (const [k, grp] of ah) {
    if (grp.matches.length < 2) continue;
    const bHome = grp.matches.reduce((b, m) => m.home > b.odds ? { book: m.book, odds: m.home } : b, { book: '', odds: 0 });
    const bAway = grp.matches.reduce((b, m) => m.away > b.odds ? { book: m.book, odds: m.away } : b, { book: '', odds: 0 });
    if (!bHome.book || bHome.book === bAway.book) continue;
    const inv = 1/bHome.odds + 1/bAway.odds;
    if (inv < 1) { const r = calcArb([{ book: bHome.book, odds: bHome.odds }, { book: bAway.book, odds: bAway.odds }]); cand(`AH|${k}`, `Asian Handicap ${k.split('|')[2]}`, [k.split('|')[0], k.split('|')[1]],
      [{ book: bHome.book, bet: k.split('|')[0] + ' -' + k.split('|')[2], odds: bHome.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout },
       { book: bAway.book, bet: k.split('|')[1] + ' +' + k.split('|')[2], odds: bAway.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout }], inv); }
  }
// ── BTTS grouping (2-way yes/no) — best sides must be DIFFERENT books ──
  const bts = new Map();
  for (const ev of all) { if (ev.btts) { const k = `${norm(ev.home)}|${norm(ev.away)}`; (bts.get(k) || bts.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, yes: ev.btts.yes, no: ev.btts.no }); } }
  for (const [k, grp] of bts) {
    if (grp.matches.length < 2) continue;
    const bYes = grp.matches.reduce((b, m) => m.yes > b.odds ? { book: m.book, odds: m.yes } : b, { book: '', odds: 0 });
    const bNo = grp.matches.reduce((b, m) => m.no > b.odds ? { book: m.book, odds: m.no } : b, { book: '', odds: 0 });
    if (!bYes.book || bYes.book === bNo.book) continue;
    const inv = 1/bYes.odds + 1/bNo.odds;
    if (inv < 1) { const r = calcArb([{ book: bYes.book, odds: bYes.odds }, { book: bNo.book, odds: bNo.odds }]); cand(`BTTS|${k}`, 'Both Teams To Score', [k.split('|')[0], k.split('|')[1]],
      [{ book: bYes.book, bet: 'Both teams score (Yes)', odds: bYes.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout },
       { book: bNo.book, bet: 'Not both score (No)', odds: bNo.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout }], inv); }
  }
// ── DNB grouping (2-way home/away) — best sides must be DIFFERENT books ──
  const dnb = new Map();
  for (const ev of all) { if (ev.dnb) { const k = `${norm(ev.home)}|${norm(ev.away)}`; (dnb.get(k) || dnb.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, home: ev.dnb.home, away: ev.dnb.away }); } }
  for (const [k, grp] of dnb) {
    if (grp.matches.length < 2) continue;
    const bHome = grp.matches.reduce((b, m) => m.home > b.odds ? { book: m.book, odds: m.home } : b, { book: '', odds: 0 });
    const bAway = grp.matches.reduce((b, m) => m.away > b.odds ? { book: m.book, odds: m.away } : b, { book: '', odds: 0 });
    if (!bHome.book || bHome.book === bAway.book) continue;
    const inv = 1/bHome.odds + 1/bAway.odds;
    if (inv < 1) { const r = calcArb([{ book: bHome.book, odds: bHome.odds }, { book: bAway.book, odds: bAway.odds }]); cand(`DNB|${k}`, 'Draw No Bet', [k.split('|')[0], k.split('|')[1]],
      [{ book: bHome.book, bet: k.split('|')[0] + ' to win (draw refunds)', odds: bHome.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout },
       { book: bAway.book, bet: k.split('|')[1] + ' to win (draw refunds)', odds: bAway.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout }], inv); }
  }
  console.log(`[Arb] Candidates: ${found.length} (${g.size} 1X2, ${ou.size} O/U, ${dc.size} DC, ${ah.size} AH, ${bts.size} BTTS, ${dnb.size} DNB).`);
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
    // Odds must be stable within 5% between passes — big moves = live repricing, not a persistent arb
    const odds1 = c.legs.map(l => l.odds);
    const odds2 = c2.legs.map(l => l.odds);
    const stable = odds1.length === odds2.length && odds1.every((o, i) => Math.abs(o - odds2[i]) / o < 0.05);
    if (stable) confirmed.push(c);
    else { vanished.push(c); console.log(`[Verify] dropped repriced: ${c.kind} ${c.teams.join(' vs ')}`); }
  }
  console.log(`[Verify] confirmed ${confirmed.length}, vanished ${vanished.length} (stale/repriced dropped).`);
  for (const c of confirmed) await report(c);
  for (const c of vanished) console.log(`[Verify] dropped: ${c.kind} ${c.teams.join(' vs ')}`);
}

// ── Modes ──
if (warm) {
  const ctx = await chromium.launchPersistentContext(prof('warm'), { headless: false, viewport: { width: 1280, height: 800 } });
  for (const url of ['https://www.betpawa.cm/', 'https://www.pmuc.cm/sports', 'https://www.premierbet.com/cm/']) {
    const page = await ctx.newPage();
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}
    console.log(`[Warm] ${url}`); await page.waitForTimeout(12000); await page.close();
  }
  await ctx.close(); console.log('[Warm] done. Run without --warm now.');
} else if (once) {
  await scan();
} else {
  console.log(`[Arb] Loop mode: scanning every ${loopMin} min. Ctrl+C to stop.`);
  for (;;) { await scan(); await new Promise(r => setTimeout(r, loopMin * 60000)); }
}


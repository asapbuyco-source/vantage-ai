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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, '../../.playwright_profile');
const args = process.argv.slice(2);
const warm = args.includes('--warm');
const once = args.includes('--once');
const loopMin = parseInt(args.find(a => a.startsWith('--loop='))?.split('=')[1] || '3', 10);

const norm = s => (s || '').toLowerCase().replace(/[^a-z]/g, '').replace(/fc$/,'').slice(0, 6);

async function fetchBetfrenzy() {
  const r = await fetch('https://betfrenzy.cm/api/v1/sports/matchs?SportId=1&EventStatus=PRE', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) return [];
  const j = await r.json();
  const out = [];
  for (const lg of j) for (const ev of lg.events || []) {
    const o = ev.odds || {};
    if (o['1_1']) out.push({ book: 'betfrenzy', home: ev.home?.name, away: ev.away?.name, league: ev.league?.name,
      h: parseFloat(o['1_1'].home_od), d: parseFloat(o['1_1'].draw_od), a: parseFloat(o['1_1'].away_od),
      dc: o['1_8'] ? { '1x': parseFloat(o['1_8'].home_od), 'x2': parseFloat(o['1_8'].draw_od), '12': parseFloat(o['1_8'].away_od) } : null,
      ah: [o['1_2'], o['1_5']].filter(Boolean).map(x => ({ hcp: x.handicap, home: parseFloat(x.home_od), away: parseFloat(x.away_od) })),
      ou: [o['1_3'], o['1_6'], o['1_7']].filter(Boolean).map(x => ({ hcp: x.handicap, over: parseFloat(x.over_od), under: parseFloat(x.under_od) })) });
  }
  return out;
}

async function fetchBetpawa() {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  let items = [];
  page.on('response', async r => { const u = r.url();
    if (u.includes('/api/sportsbook/v1/combo-cards/list')) { try { const j = await r.json(); items = (j.items || []).map(it => ({ book: 'betpawa', home: it.eventInfo?.participants?.[0]?.name, away: it.eventInfo?.participants?.[1]?.name })).filter(x => x.home); } catch {} } });
  await page.goto('https://www.betpawa.cm/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(7000); await ctx.close();
  return items;
}

async function fetchPmuc() {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1280, height: 800 } });
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

async function fetchPremierbet() {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1280, height: 800 } });
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
      const ou = flat.find(m => m.name === 'Total de Buts' || m.name === 'Plus de/Moins de Buts');
      const dc = flat.find(m => m.name === 'Double Chance');
      const btts = flat.find(m => m.name === 'Les Deux Equipes Marquent' || m.name === 'Les Deux Équipes Marquent');
      const o = (mm) => { const x = {}; for (const oc of mm?.outcomes || []) x[oc.name] = parseFloat(oc.value); return x; };
      const evObj = { book: 'premierbet', home: e.home, away: e.away,
        h: o12 ? parseFloat(o12.outcomes.find(x => x.name === '1')?.value) : null,
        d: o12 ? parseFloat(o12.outcomes.find(x => x.name === 'X')?.value) : null,
        a: o12 ? parseFloat(o12.outcomes.find(x => x.name === '2')?.value) : null };
      if (ou) { const O = o(ou); evObj.ou = [{ hcp: '2.5', over: O['Plus de'] || O['Over'], under: O['Moins de'] || O['Under'] }]; }
      if (dc) { const D = o(dc); evObj.dc = { '1x': D['1X'], 'x2': D['X2'], '12': D['12'] }; }
      if (btts) { const B = o(btts); evObj.btts = { yes: B['Oui'], no: B['Non'] }; }
      if (evObj.h) events.push(evObj);
    } catch (e) {}
  }
  await ctx.close();
  return events;
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) });
}

async function scan() {
  console.log(`[Arb] Scan ${new Date().toISOString()}`);
  const [bf, bp, pm, pb] = await Promise.all([fetchBetfrenzy().catch(() => []), fetchBetpawa().catch(() => []), fetchPmuc().catch(() => []), fetchPremierbet().catch(() => [])]);
  console.log(`[Arb] betfrenzy ${bf.length}, betpawa ${bp.length}, pmuc ${pm.length}, premierbet ${pb.length}`);
  const all = [...bf, ...bp, ...pm, ...pb];

  // 1X2 grouping
  const g = new Map();
  for (const ev of all) { if (ev.h) { const k = `${norm(ev.home)}|${norm(ev.away)}`; (g.get(k) || g.set(k, { matches: [] }).get(k)).matches.push(ev); } }
  let arbs = 0;
  for (const [k, grp] of g) {
    if (grp.matches.length < 2) continue;
    const books = new Set(grp.matches.map(m => m.book));
    if (books.size < 2) continue; // cross-book arb only
    const h = Math.max(...grp.matches.map(m => m.h)), d = Math.max(...grp.matches.map(m => m.d || 0)), a = Math.max(...grp.matches.map(m => m.a || 0));
    const inv = 1/h + 1/d + 1/a;
    if (inv < 1) { arbs++; const msg = `🎯 ARB 1X2 ${((1-inv)*100).toFixed(2)}% ${grp.matches[0].home} vs ${grp.matches[0].away} [${grp.matches.map(m => m.book).join(',')}] 1:${h} X:${d} 2:${a}`; console.log(msg); await sendTelegram(msg); }
  }

  // ── O/U grouping (asian lines) ──
  const ou = new Map();
  for (const ev of all) { for (const o of ev.ou || []) { if (!o.hcp || !o.over || !o.under) continue; const k = `${norm(ev.home)}|${norm(ev.away)}|${o.hcp}`; (ou.get(k) || ou.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, over: o.over, under: o.under }); } }
  for (const [k, grp] of ou) {
    if (grp.matches.length < 2) continue;
    const books = new Set(grp.matches.map(m => m.book));
    if (books.size < 2) continue; // cross-book arb only
    const bestOver = Math.max(...grp.matches.map(m => m.over)), bestUnder = Math.max(...grp.matches.map(m => m.under));
    const inv = 1/bestOver + 1/bestUnder;
    if (inv < 1) { arbs++; const r = calcArb([{ book: 'over', odds: bestOver }, { book: 'under', odds: bestUnder }]); const msg = `🎯 ARB O/U ${k.split('|')[2]} ${((1-inv)*100).toFixed(2)}% ${k.split('|')[0]} vs ${k.split('|')[1]} [${grp.matches.map(m => m.book).join(',')}] Over ${bestOver} Under ${bestUnder} — stake ${r.stakes.map(s => `${s.book} ${s.stake}→${s.payout}`).join(' | ')}`; console.log(msg); await sendTelegram(msg); }
  }

  // ── Double Chance grouping (3-way: 1X/X2/12) ──
  const dc = new Map();
  for (const ev of all) { if (ev.dc) { const k = `${norm(ev.home)}|${norm(ev.away)}`; (dc.get(k) || dc.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, dc: ev.dc }); } }
  for (const [k, grp] of dc) {
    if (grp.matches.length < 2) continue;
    const books = new Set(grp.matches.map(m => m.book));
    if (books.size < 2) continue; // cross-book arb only
    const b1x = Math.max(...grp.matches.map(m => m.dc['1x'])), bx2 = Math.max(...grp.matches.map(m => m.dc['x2'])), b12 = Math.max(...grp.matches.map(m => m.dc['12']));
    const inv = 1/b1x + 1/bx2 + 1/b12;
    if (inv < 1) { arbs++; const r = calcArb([{ book: '1X', odds: b1x }, { book: 'X2', odds: bx2 }, { book: '12', odds: b12 }]); const msg = `🎯 ARB DC ${((1-inv)*100).toFixed(2)}% ${k.split('|')[0]} vs ${k.split('|')[1]} [${grp.matches.map(m => m.book).join(',')}] 1X ${b1x} X2 ${bx2} 12 ${b12} — stake ${r.stakes.map(s => `${s.book} ${s.stake}→${s.payout}`).join(' | ')}`; console.log(msg); await sendTelegram(msg); }
  }

  // ── AH pairing (home -hcp vs away +hcp) — cross-book only ──
  const ah = new Map();
  for (const ev of all) { for (const o of ev.ah || []) { if (!o.hcp) continue; const k = `${norm(ev.home)}|${norm(ev.away)}|${o.hcp}`; (ah.get(k) || ah.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, home: o.home, away: o.away }); } }
  for (const [k, grp] of ah) {
    const books = new Set(grp.matches.map(m => m.book));
    if (books.size < 2) continue; // cross-book arb only
    const bHome = Math.max(...grp.matches.map(m => m.home)), bAway = Math.max(...grp.matches.map(m => m.away));
    const inv = 1/bHome + 1/bAway;
    if (inv < 1) { arbs++; const r = calcArb([{ book: 'home', odds: bHome }, { book: 'away', odds: bAway }]); const msg = `🎯 ARB AH ${k.split('|')[2]} ${((1-inv)*100).toFixed(2)}% ${k.split('|')[0]} vs ${k.split('|')[1]} [${grp.matches.map(m => m.book).join(',')}] H ${bHome} A ${bAway} — stake ${r.stakes.map(s => `${s.book} ${s.stake}→${s.payout}`).join(' | ')}`; console.log(msg); await sendTelegram(msg); }
  }
  // ── BTTS grouping (2-way yes/no, cross-book) ──
  const bts = new Map();
  for (const ev of all) { if (ev.btts) { const k = `${norm(ev.home)}|${norm(ev.away)}`; (bts.get(k) || bts.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, yes: ev.btts.yes, no: ev.btts.no }); } }
  for (const [k, grp] of bts) {
    const books = new Set(grp.matches.map(m => m.book));
    if (books.size < 2) continue;
    const bYes = Math.max(...grp.matches.map(m => m.yes)), bNo = Math.max(...grp.matches.map(m => m.no));
    const inv = 1/bYes + 1/bNo;
    if (inv < 1) { arbs++; const r = calcArb([{ book: 'BTTS-Y', odds: bYes }, { book: 'BTTS-N', odds: bNo }]); const msg = `🎯 ARB BTTS ${((1-inv)*100).toFixed(2)}% ${k.split('|')[0]} vs ${k.split('|')[1]} [${grp.matches.map(m => m.book).join(',')}] Yes ${bYes} No ${bNo} — stake ${r.stakes.map(s => `${s.book} ${s.stake}→${s.payout}`).join(' | ')}`; console.log(msg); await sendTelegram(msg); }
  }
  console.log(`[Arb] Done. ${arbs} arbs (${g.size} 1X2, ${ou.size} O/U, ${dc.size} DC, ${ah.size} AH, ${bts.size} BTTS).`);
}

// ── Modes ──
if (warm) {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: { width: 1280, height: 800 } });
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
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
  let events = [];
  page.on('response', async r => { const u = r.url();
    if (u.includes('/v1/events/upcoming')) { try { const j = await r.json();
      for (const cat of j.data?.categories || []) for (const comp of cat.competitions || []) for (const ev of comp.events || []) {
        const m = (ev.markets || []).find(x => x.name === '1X2');
        if (m) { const o = m.outcomes || []; events.push({ book: 'premierbet', home: ev.eventNames?.[0], away: ev.eventNames?.[1], league: comp.name,
          h: parseFloat(o.find(x => x.name === '1')?.value), d: parseFloat(o.find(x => x.name === 'X')?.value), a: parseFloat(o.find(x => x.name === '2')?.value) }); }
      } } catch {} } });
  await page.goto('https://www.premierbet.com/cm/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(7000); await ctx.close();
  return events.filter(e => e.h);
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
    const h = Math.max(...grp.matches.map(m => m.h)), d = Math.max(...grp.matches.map(m => m.d || 0)), a = Math.max(...grp.matches.map(m => m.a || 0));
    const inv = 1/h + 1/d + 1/a;
    if (inv < 1) { arbs++; const msg = `🎯 ARB 1X2 ${((1-inv)*100).toFixed(2)}% ${grp.matches[0].home} vs ${grp.matches[0].away} [${grp.matches.map(m => m.book).join(',')}] 1:${h} X:${d} 2:${a}`; console.log(msg); await sendTelegram(msg); }
  }

  // O/U grouping (asian lines)
  const ou = new Map();
  for (const ev of all) { for (const o of ev.ou || []) { if (!o.hcp || !o.over || !o.under) continue; const k = `${norm(ev.home)}|${norm(ev.away)}|${o.hcp}`; (ou.get(k) || ou.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, over: o.over, under: o.under }); } }
  for (const [k, grp] of ou) {
    if (grp.matches.length < 2) continue;
    const bestOver = Math.max(...grp.matches.map(m => m.over)), bestUnder = Math.max(...grp.matches.map(m => m.under));
    const inv = 1/bestOver + 1/bestUnder;
    if (inv < 1) { arbs++; const msg = `🎯 ARB O/U ${k.split('|')[2]} ${((1-inv)*100).toFixed(2)}% ${k.split('|')[0]} vs ${k.split('|')[1]} [${grp.matches.map(m => m.book).join(',')}] Over ${bestOver} Under ${bestUnder}`; console.log(msg); await sendTelegram(msg); }
  }
  console.log(`[Arb] Done. ${arbs} arbs (${g.size} 1X2 pairs, ${ou.size} O/U lines).`);
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
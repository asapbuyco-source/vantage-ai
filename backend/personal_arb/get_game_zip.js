/**
 * get_game_zip.js — parse 1xBet/Melbet GetGameZip for 1X2 odds (personal arb)
 * Call: node backend/personal_arb/get_game_zip.js --site=1xbet --id=364649430
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calcArb } from './arb_calc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, '../../.playwright_profile');
const SITES = {
  '1xbet': 'https://1xbet.cm/en/line',
  'melbet': 'https://melbet-cm.com/en/line',
};

const args = process.argv.slice(2);
const siteArg = args.find(a => a.startsWith('--site='))?.split('=')[1] || '1xbet';
const idArg = args.find(a => a.startsWith('--id='))?.split('=')[1];
const headed = args.includes('--headed');

async function run() {
  const site = SITES[siteArg];
  if (!site) { console.error(`Unknown site ${siteArg}`); process.exit(1); }
  console.log(`[1xBet] Launching ${siteArg} headed=${headed}`);
  if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: !headed, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  let gameZip = null;
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('GetGameZip')) {
      try {
        const json = await resp.json();
        gameZip = json;
        console.log(`[GetGameZip] id=${url.match(/id=(\d+)/)?.[1]} ${json?.Value?.O1E} vs ${json?.Value?.O2E}`);
      } catch (e) {}
    }
  });

  await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log(`[1xBet] Page loaded. Click a match to fetch GetGameZip (or Ctrl+C)`);
  // Wait up to 90s for user to click a match
  const t0 = Date.now();
  while (!gameZip && Date.now() - t0 < 90000) {
    await page.waitForTimeout(2000);
  }
  if (!gameZip) {
    console.log('[1xBet] No GetGameZip captured in 90s.');
    if (!headed) await context.close();
    return;
  }

  // Parse 1X2: look in Value.GE or Value.SG[].G -> events with type
  const V = gameZip.Value || {};
  const teams = `${V.O1E || ''} vs ${V.O2E || ''}`;
  console.log(`[1xBet] Match: ${teams}`);
  console.log(`[1xBet] raw keys: ${Object.keys(V).join(', ')}`);
  // GE = game events. Each has: G (group), T (type), E (event names), C (coefficients)
  const ge = V.GE || [];
  console.log(`[1xBet] GE count: ${ge.length}`);
  if (ge.length > 0) {
    console.log(`[1xBet] GE[0] sample: ${JSON.stringify(ge[0]).slice(0,400)}`);
  }
  // 1X2 = GE group G:1 → E = [[{T:1,C}],[{T:2,C}],[{T:3,C}]]
  const oneX2 = ge.filter(e => e.G === 1);
  const odds = oneX2.map(e => ({
    name: ['W1','X','W2'][0],
    odds: (e.E || []).map(inner => inner[0]?.C).filter(v => v != null),
  }));
  console.log(`[1xBet] 1X2:`, JSON.stringify(odds));

  // Live arb check vs betfrenzy (both books' 1X2 for same fixture)
  const hx = odds[0]?.odds?.[0];
  const dx = odds[0]?.odds?.[1];
  const ax = odds[0]?.odds?.[2];
  if (hx && dx && ax) {
    console.log(`[1xBet] ${teams}: W1 ${hx} X ${dx} W2 ${ax}`);
    // betfrenzy 1X2 for same match — fetch live
    try {
      const bf = await fetch('https://betfrenzy.cm/api/v1/sports/matchs?SportId=1&EventStatus=PRE', { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const j = await bf.json();
      const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
      const h1 = norm(V.O1E || ''), a1 = norm(V.O2E || '');
      let best = { h: hx, d: dx, a: ax };
      for (const lg of j) {
        for (const ev of lg.events || []) {
          if (norm(ev.home?.name).slice(0,5) === h1.slice(0,5) && norm(ev.away?.name).slice(0,5) === a1.slice(0,5)) {
            const o = ev.odds?.['1_1'];
            if (o) {
              best = {
                h: Math.max(hx, parseFloat(o.home_od)),
                d: Math.max(dx, parseFloat(o.draw_od)),
                a: Math.max(ax, parseFloat(o.away_od)),
              };
              console.log(`[betfrenzy] ${ev.home.name} vs ${ev.away.name} 1:${o.home_od} X:${o.draw_od} 2:${o.away_od}`);
            }
          }
        }
      }
      const inv = 1/best.h + 1/best.d + 1/best.a;
      console.log(`[Arb] best ${best.h}/${best.d}/${best.a} inv ${inv.toFixed(4)} ${inv < 1 ? '🎯 ARB ' + ((1-inv)*100).toFixed(2) + '%' : 'no arb'}`);
    } catch (e) { console.log('[Arb] betfrenzy fetch fail', e.message); }
  }

  // Also dump MG (market groups) sample
  const mg = V.MG || [];
  console.log(`[1xBet] MG count: ${mg.length}, SG count: ${(V.SG||[]).length}`);

  if (!headed) await context.close();
}

run().catch(e => { console.error(e); process.exit(1); });
import { chromium } from 'playwright';
import fetch from 'node-fetch';

async function getPmucOdds() {
  const ctx = await chromium.launchPersistentContext('./.playwright_profile', { headless: true });
  const page = await ctx.newPage();
  let odds = null;
  page.on('response', async r => {
    const url = r.url();
    if (url.includes('/api/events/sports/popular') && url.includes('betTypeId=10001')) {
      try {
        const j = await r.json();
        // j is array of events with 1X2
        for (const ev of j) {
          if (ev.eventBetTypes) {
            for (const bt of ev.eventBetTypes) {
              if (bt.name === 'Résultat du match') {
                const o1 = bt.eventBetTypeItems.find(i => i.shortName === '1')?.odds;
                const ox = bt.eventBetTypeItems.find(i => i.shortName === 'X')?.odds;
                const o2 = bt.eventBetTypeItems.find(i => i.shortName === '2')?.odds;
                if (o1) console.log(`[PMUC] ${ev.homeTeamName || 'home'} vs ${ev.awayTeamName || 'away'} 1:${o1} X:${ox} 2:${o2}`);
                if (!odds && o1) odds = { home: o1, draw: ox, away: o2 };
              }
            }
          }
        }
      } catch {}
    }
  });
  await page.goto('https://www.pmuc.cm/sports', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(8000);
  await ctx.close();
  return odds;
}

async function getBetfrenzyOdds() {
  const r = await fetch('https://betfrenzy.cm/api/v1/sports/matchs?SportId=1&EventStatus=PRE', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const j = await r.json();
  for (const lg of j) {
    for (const ev of lg.events || []) {
      if (ev.home?.name === 'Cagliari' && ev.away?.name === 'Lecce') {
        const o = ev.odds['1_1'];
        console.log(`[BetFrenzy] Cagliari vs Lecce 1:${o.home_od} X:${o.draw_od} 2:${o.away_od}`);
        return { home: parseFloat(o.home_od), draw: parseFloat(o.draw_od), away: parseFloat(o.away_od) };
      }
    }
  }
}

const pmuc = await getPmucOdds();
const bf = await getBetfrenzyOdds();
if (pmuc && bf) {
  const arb = (1/pmuc.home + 1/bf.away + 1/pmuc.draw) < 1 ? 'ARB' : 'no arb';
  console.log(`Compare PMUC 1:${pmuc.home} vs BetFrenzy 2:${bf.away} -> ${arb}`);
}

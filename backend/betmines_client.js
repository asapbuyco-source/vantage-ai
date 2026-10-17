/**
 * betmines_client.js — reads BetMines' public match data (robots.txt allows /).
 *
 * BetMines is a Nuxt SSR site: the data is embedded in `window.__NUXT__` as a
 * MINIFIED IIFE, so we execute it in a sandbox to recover the object, then read
 * `data[]` — each entry has `.fixture` (teams, league, date) with a full model
 * `probability` map (home/draw/away, O/U 0.5-4.5, BTTS, HT, corners, correct
 * score…) AND `.odds` (bookmaker prices).
 *
 * Use: consensus / calibration benchmark against our own quant probabilities,
 * plus an extra odds source. Not for wholesale republishing of their picks.
 */
import vm from 'vm';
import { execFile } from 'child_process';

const HDRS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
};

// Cloudflare fingerprints Node's HTTP stack (undici → 403) even with browser
// headers, so prefer curl when present (optionally through the residential
// proxy). Falls back to fetch() if curl is unavailable.
function curlGet(url, proxy) {
  return new Promise((resolve) => {
    const args = ['-s', '--compressed', '--max-time', '45', '-H', `User-Agent: ${HDRS['User-Agent']}`];
    if (proxy) args.push('--proxy', proxy);
    args.push(url);
    execFile('curl', args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : (stdout || '')));
  });
}

async function getHtml(url) {
  const proxy = process.env.BETMINES_PROXY || process.env.SOFASCORE_PROXY || '';
  const viaCurl = await curlGet(url, proxy);
  if (viaCurl && viaCurl.length > 1000) return viaCurl;
  try { const r = await fetch(url, { headers: HDRS }); if (r.ok) return await r.text(); } catch (_) {}
  return viaCurl || '';
}

/** Execute the `__NUXT__` IIFE from a BetMines page and return the state object. */
export function extractNuxt(html) {
  const i = html.indexOf('__NUXT__=');
  if (i < 0) return null;
  let expr = html.slice(i + '__NUXT__='.length);
  const end = expr.indexOf('</script>');
  if (end > 0) expr = expr.slice(0, end);
  expr = expr.trim().replace(/;\s*$/, '');
  if (!expr.startsWith('(function')) return null;
  const sb = { window: {}, document: {}, location: { href: 'https://betmines.com/' }, navigator: {} };
  sb.window = sb;
  try { return vm.runInNewContext(expr, sb, { timeout: 5000 }); } catch { return null; }
}

function normalize(entry) {
  const f = entry.fixture || {};
  return {
    id: f.id,
    home: (f.localTeam && f.localTeam.name) || '',
    away: (f.visitorTeam && f.visitorTeam.name) || '',
    league: (f.league && (f.league.name || f.league.leagueName)) || f.leagueName || '',
    country: (f.league && f.league.country && f.league.country.name) || '',
    dateTime: f.dateTime || f.date || null,
    probabilities: f.probability || {},   // percentages, e.g. over_2_5: 49
    odds: entry.odds || f.fixtureOdd || {},// bookmaker odds, e.g. oddOver25: 2.05
  };
}

/** All fixtures present on a BetMines page. Default: today's predictions. */
export async function fetchBetminesFixtures(url = 'https://betmines.com/football-predictions-today') {
  const html = await getHtml(url);
  if (!html) throw new Error('BetMines fetch failed (blocked or offline)');
  const nuxt = extractNuxt(html);
  if (!nuxt || !Array.isArray(nuxt.data)) return [];
  return nuxt.data.filter(e => e && e.fixture && e.fixture.localTeam).map(normalize);
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Resolve our fixture (team names + date) to BetMines' model/odds. */
export async function findBetminesFixture({ home, away, url } = {}) {
  const fixtures = await fetchBetminesFixtures(url);
  const hn = norm(home), an = norm(away);
  for (const f of fixtures) {
    const fh = norm(f.home), fa = norm(f.away);
    if (!fh || !fa) continue;
    if ((fh.includes(hn) || hn.includes(fh)) && (fa.includes(an) || an.includes(fa))) return f;
  }
  return null;
}

/** Map a BetMines probability/odds pair to our market names, when we want to compare. */
export function betminesMarket(fx, market) {
  const p = fx.probabilities || {}, o = fx.odds || {};
  const M = {
    over25: { p: p.over_2_5, o: o.oddOver25 }, under25: { p: p.under_2_5, o: o.oddUnder25 },
    over15: { p: p.over_1_5, o: o.oddOver15 }, btts: { p: p.btts, o: o.oddGoal },
    home: { p: p.home, o: o.odd1 }, draw: { p: p.draw, o: o.oddx }, away: { p: p.away, o: o.odd2 },
  };
  return M[market] || null;
}

export default { extractNuxt, fetchBetminesFixtures, findBetminesFixture, betminesMarket };

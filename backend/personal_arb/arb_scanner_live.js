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
import { PERIOD, SCOPE, periodLabel, periodShort, normalizePeriod, normalizeScope, scopeLabel, pairEligible, ahWorstCase, worstPayoutFor2Way } from './arb_engine.mjs';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env.local for Telegram creds (same file server.js uses)
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

// Guaranteed-ROI floor for AH arbs (worst-case settlement return must beat this).
// False positives are unacceptable — missing an arb is fine.
const MIN_GUARANTEED_ROI = 0.003; // 0.3% worst-case after split-stake settlement

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

// Event-matching key: same teams can meet twice in a season (2-legged ties).
// Bucketing by UTC day keeps same-name fixtures on different dates distinct.
const dayOf = (kickoffMs) => kickoffMs ? new Date(kickoffMs).toISOString().slice(0, 10) : '';

async function fetchBetfrenzy() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('https://betfrenzy.cm/api/v1/sports/matchs?SportId=1&EventStatus=PRE', { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) { await new Promise(r => setTimeout(r, 3000)); continue; }
      const j = await r.json();
      const out = [];
      for (const lg of j) for (const ev of lg.events || []) {
        const o = ev.odds || {};
        // ── VERIFIED feed key mapping (checked against the event page on multiple fixtures) ──
        //   1_1 = 1X2 FT              -> keep
        //   1_2 = Asian Handicap FT   -> keep (page "Asian Handicap" matched exactly: -0.5 1.98/1.88)
        //   1_3 = O/U FT main line    -> keep (balanced line 2.75-3.25 @ ~1.9/1.95 — cannot be a half)
        //   1_4 = Total Corners FT    -> keep ONLY when fresh (feed line lags the page: 8.0 vs 8)
        //   1_5 = Asian Handicap 1ST HALF -> EXCLUDED (page "Asian Handicap -0.25 (1st Half)" matched
        //         exactly: 2.02/1.77 — pairing it with another book's FT line is the 1H-vs-FT false arb)
        //   1_6 = O/U 1ST HALF        -> EXCLUDED (page "(1st Half)" matched exactly: 1.90/1.90)
        //   1_7 = Corners O/U 1ST HALF-> EXCLUDED (page "4.5 Corners (1st Half)" matched exactly)
        //   1_8 = NOT Double Chance   -> EXCLUDED (3-way 2.50/2.40/3.75; page DC is 1.28/1.80/1.25)
        const CORNERS_MAX_AGE_MS = 3 * 60 * 60 * 1000;
        const isFresh = (x) => x && (Date.now() - Number(x.add_time || 0) * 1000) < CORNERS_MAX_AGE_MS;
        // 1_2 is the only full-match AH line in the feed
        const ah = (o['1_2'] && o['1_2'].handicap != null)
          ? [{ hcp: String(Math.abs(parseFloat(o['1_2'].handicap))), home: parseFloat(o['1_2'].home_od), away: parseFloat(o['1_2'].away_od), scope: 'MATCH' }]
          : [];
        if (o['1_1']) out.push({ book: 'betfrenzy', home: ev.home?.name, away: ev.away?.name, league: ev.league?.name, kickoff: ev.time ? ev.time * 1000 : null, link: ev.id ? `https://betfrenzy.cm/event/${ev.id}` : null,
          // Period: only the verified full-match keys are used (1_1/1_2/1_3 + fresh 1_4).
          // 1H keys (1_5/1_6/1_7) and the mislabeled 1_8 are excluded at parse time.
          period: 'FULL_MATCH', scope: 'MATCH',
          periodSource: 'verified key map: 1_1/1_2/1_3/1_4 (page-matched); 1_5/1_6/1_7 = 1H, 1_8 != DC',
          h: parseFloat(o['1_1'].home_od), d: parseFloat(o['1_1'].draw_od), a: parseFloat(o['1_1'].away_od),
          dc: null, // no Double Chance in this feed (1_8 is not DC — verified against the page)
          ah: ah,
          // O/U: only 1_3 (FT match total); normalize asian split handicaps ("2.5,3.0" → "2.75")
          ou: (() => {
            if (!o['1_3']) return [];
            const parts = String(o['1_3'].handicap).split(',').map(parseFloat).filter(v => !isNaN(v));
            if (parts.length === 0) return [];
            const line = parts.reduce((a, b) => a + b, 0) / parts.length; // mid of split
            if (line > 5.5) return [];
            return [{ hcp: line.toFixed(2), over: parseFloat(o['1_3'].over_od), under: parseFloat(o['1_3'].under_od), scope: 'MATCH' }];
          })(),
          corners: (() => {
            if (!o['1_4'] || !isFresh(o['1_4'])) return []; // stale corners lines are excluded
            const parts = String(o['1_4'].handicap).split(',').map(parseFloat).filter(v => !isNaN(v));
            const line = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : NaN;
            return [{ hcp: line.toFixed(2), over: parseFloat(o['1_4'].over_od), under: parseFloat(o['1_4'].under_od), scope: 'MATCH' }];
          })() });
      }
      if (out.length > 0) return out;
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) { await new Promise(r => setTimeout(r, 3000)); }
  }
  return [];
}

async function fetchBetpawa() {
  // betpawa.cm — GeniusSports v4 backend. The site itself receives protobuf, but a raw
  // fetch with `Accept: application/json` gets plain JSON (no proxy needed — direct works).
  // Market types (reverse-engineered from the frontend bundle + brute-force probe):
  //   3743 = 1X2 - FT, 5000 = Total Score O/U - FT (line in price.handicap),
  //   3795 = BTTS - FT, 4693 = Double Chance - FT,
  //   3774 = Asian Handicap - FT (rows: home '1' hcp -x / away '2' hcp +x),
  //   4703 = Draw No Bet - FT.
  // Only -FT types are used; 1H/2H variants (3747/3756 etc.) are other periods — skipped.
  // AH safety: only rows where the HOME side carries the negative handicap are kept
  // (home -hcp / away +hcp, the scanner's pairing convention). Mirrored rows (home
  // receiving) would corrupt the AH grouping and are excluded.
  const events = [];
  try {
    // take is capped at 50 per query — 3 queries (different sorts) broaden the net to ~150 events
    const q = { queries: [
      { query: { eventType: 'UPCOMING', categories: ['2'] }, sort: { popularity: 'DESC' }, take: 50, view: { marketTypes: ['3743', '5000', '3795', '4693', '3774', '4703'] } },
      { query: { eventType: 'UPCOMING', categories: ['2'] }, sort: { startTime: 'ASC' }, take: 50, view: { marketTypes: ['3743', '5000', '3795', '4693', '3774', '4703'] } },
      { query: { eventType: 'UPCOMING', categories: ['2'] }, sort: { startTime: 'DESC' }, take: 50, view: { marketTypes: ['3743', '5000', '3795', '4693', '3774', '4703'] } },
    ], keyMap: {} };
    const r = await fetch('https://www.betpawa.cm/api/sportsbook/v4/events/lists/by-queries?q=' + encodeURIComponent(JSON.stringify(q)), { headers: {
      'x-pawa-brand': 'betpawa-cameroon', 'x-pawa-language': 'en', 'x-device-fingerprint': 'arb-scanner-1',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      'Accept': 'application/json', 'Accept-Encoding': 'identity',
      'Origin': 'https://www.betpawa.cm', 'Referer': 'https://www.betpawa.cm/',
    } });
    if (!r.ok) { console.log(`[betpawa] HTTP ${r.status}`); return []; }
    const j = await r.json();
    const seen = new Set();
    // ── Runtime label verifier ──
    // betpawa's own market names are the source of truth ("... - FT", "... - 1H").
    // Every requested market is re-verified from its name: the period must normalize to
    // FULL_MATCH and the scope must be MATCH — otherwise the market is SKIPPED (never guessed).
    // If betpawa ever renames/reuses an ID, this rejects it instead of producing false arbs.
    let rejectedLabels = 0;
    for (const resp of j.responses || []) for (const ev of resp.responses || []) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      const home = ev.participants?.find(p => p.position === 1)?.name;
      const away = ev.participants?.find(p => p.position === 2)?.name;
      // label verifier bound to THIS event (team names give scope context)
      const verified = (m) => {
        if (!m) return null; // market not present for this event — not a rejection
        const name = m.marketType?.name || '';
        const period = normalizePeriod(name);
        const scope = normalizeScope(name, { home, away });
        if (period !== 'FULL_MATCH' || scope !== 'MATCH') { rejectedLabels++; return null; }
        return m;
      };
      const mkt = (id) => verified((ev.markets || []).find(x => x.marketType?.id === id));
      const prices = (m) => m?.row?.[0]?.prices || [];
      const px = (m, name) => prices(m).find(p => p.name === name)?.odds;
      const m3743 = mkt('3743');
      const o1 = px(m3743, '1'), ox = px(m3743, 'X'), o2 = px(m3743, '2');
      if (!o1 || !o2) continue; // 1X2 is the spine — skip events without it
      if (!home || !away) continue;
      const dcM = mkt('4693');
      const bttsM = mkt('3795');
      const ouM = mkt('5000');
      const ahM = mkt('3774');
      const dnbM = mkt('4703');
      const ou = (ouM?.row || []).map(row => {
        const over = row.prices?.find(p => p.name === 'Over');
        const under = row.prices?.find(p => p.name === 'Under');
        if (!over || !under || over.handicap == null) return null;
        const line = parseFloat(over.handicap);
        if (isNaN(line) || line > 5.5) return null;
        return { hcp: String(line), over: over.odds, under: under.odds, scope: 'MATCH' };
      }).filter(Boolean);
      const ah = (ahM?.row || []).map(row => {
        const homeP = row.prices?.find(p => p.name === '1');
        const awayP = row.prices?.find(p => p.name === '2');
        if (!homeP || !awayP || homeP.handicap == null) return null;
        // keep only home-negative rows (home -hcp / away +hcp)
        if (!String(homeP.handicap).startsWith('-')) return null;
        const hcp = Math.abs(parseFloat(homeP.handicap));
        if (isNaN(hcp)) return null;
        return { hcp: String(hcp), home: homeP.odds, away: awayP.odds, scope: 'MATCH' };
      }).filter(Boolean);
      events.push({ book: 'betpawa', home, away, league: ev.competition?.name,
        kickoff: ev.startTime ? new Date(ev.startTime).getTime() : null,
        link: `https://www.betpawa.cm/events/${ev.id}`,
        // label-verified: all six market types are "... - FT" and whole-match (MATCH scope)
        period: 'FULL_MATCH', scope: 'MATCH',
        periodSource: 'runtime label verifier: marketType.name ends "- FT", scope MATCH',
        h: o1, d: ox, a: o2,
        dc: dcM ? { '1x': px(dcM, '1X'), 'x2': px(dcM, 'X2'), '12': px(dcM, '12'), scope: 'MATCH' } : null,
        btts: bttsM && px(bttsM, 'Yes') ? { yes: px(bttsM, 'Yes'), no: px(bttsM, 'No'), scope: 'MATCH' } : null,
        ou: ou,
        ah: ah,
        dnb: dnbM && px(dnbM, '1') ? { home: px(dnbM, '1'), away: px(dnbM, '2'), scope: 'MATCH' } : null });
    }
    console.log(`[betpawa] ${events.length} events (1X2+DC+BTTS+O/U+AH+DNB, label-verified${rejectedLabels ? `, ${rejectedLabels} labels rejected` : ''})`);
  } catch (e) {
    console.log(`[betpawa] fetch fail: ${e.message.slice(0, 90)}`);
  }
  return events;
}

async function fetchPmuc() {
  // PMUC via raw fetch through the residential proxy (ARB_PROXY).
  // Requires Origin + Referer headers (their CDN 403s otherwise) + proxy.
  const events = [];
  try {
    const proxyUrl = new URL(ARB_PROXY);
    const auth = 'Basic ' + Buffer.from(`${proxyUrl.username}:${proxyUrl.password}`).toString('base64');
    const r = await fetch('https://hg-event-api-prod.sporty-tech.net/api/events/sports/popular?take=50&entryPointId=101&betTypeId=10001&l=fr', { headers: {
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
          if (o1) events.push({ book: 'pmuc', home: ev.homeTeamName, away: ev.awayTeamName, h: o1, d: ox, a: o2,
            // 'Résultat du match' = full-match 1X2 by contract (whole match)
            period: 'FULL_MATCH', scope: 'MATCH', periodSource: 'endpoint_contract: Résultat du match (full match)' });
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

// 1xbet-family books share the same platform API (main-line-feed). betwinner.cm and
// paripesa.cm are the same software family with their OWN brand odds — each brand is a
// separate arb source. Raw fetch through the residential proxy; direct works too.
async function fetch1xFamily(book, host) {
  const events = [];
  try {
    const proxyUrl = new URL(ARB_PROXY);
    const auth = 'Basic ' + Buffer.from(`${proxyUrl.username}:${proxyUrl.password}`).toString('base64');
    const headers = {
      'Proxy-Authorization': auth,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      'Referer': `https://${host}/en/line`,
      'Accept': 'application/json',
      'Accept-Encoding': 'identity',
    };
    const r = await fetch(`https://${host}/service-api/main-line-feed/v3/games1x2?cfView=3&count=40&fcountry=84&gr=654&grMode=4&lng=en&ref=55`, { headers });
    if (!r.ok) { console.log(`[${book}] HTTP ${r.status}`); return []; }
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
        const evObj = { book, home: ev.opponent1?.fullName, away: ev.opponent2?.fullName, league: ev.liga?.name, kickoff: ev.startTs ? ev.startTs * 1000 : null,
          // Period: games1x2 is the main (full-time) line by endpoint contract. If the feed ever
          // exposes a periodName (e.g. "1st Half"), it is normalized explicitly — never guessed.
          period: ev.periodName ? normalizePeriod(ev.periodName, { fullMatchContext: true }) : 'FULL_MATCH',
          // Scope: 1X2 (group 1) is a whole-match market.
          scope: 'MATCH',
          periodSource: ev.periodName ? `feed periodName="${ev.periodName}"` : 'endpoint_contract: games1x2 (main full-time line)',
          link: `https://${host}/en/line/${ev.sport?.name?.toLowerCase()}/${ev.liga?.id}-${ev.liga?.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/${ev.id}-${ev.opponent1?.fullName?.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${ev.opponent2?.fullName?.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          h: parseFloat(cf(g1, 1)), d: cf(g1, 2) ? parseFloat(cf(g1, 2)) : null, a: parseFloat(cf(g1, 3)) };
        if (ev.sport?.id === 1) {
          fb++;
          // ── O/U groups with EXPLICIT SCOPE (verified vs the site on 4 fixtures + Poisson math) ──
          //   group 17 (types 9/10)      = "Total"       -> MATCH total  (e.g. 2.5)
          //   group 99 (types 3827/3828) = "Asian Total" -> MATCH total  (quarter lines, e.g. 2.75)
          //   group 15 (types 11/12)     = "Total 1"     -> TEAM 1 total (e.g. Villarreal over 1.5)
          //   group 62 (types 13/14)     = "Total 2"     -> TEAM 2 total (e.g. Betis over 1.5)
          // Scope is tagged per line, so team totals can only pair with other books' TEAM totals
          // of the same team — never with match totals. (1xbet/betwinner/paripesa price the team
          // lines independently, so same-team cross-brand team-total arbs are valid candidates.)
          const ou = [];
          for (const [gid, overType, underType, scope] of [[17, 9, 10, 'MATCH'], [99, 3827, 3828, 'MATCH'], [15, 11, 12, 'TEAM_1'], [62, 13, 14, 'TEAM_2']]) {
            const g = groups[gid] || [];
            const over = cf(g, overType);
            const under = cf(g, underType);
            const overEvent = g.find(x => x[0]?.type === overType)?.[0];
            if (over && under && overEvent?.parameter != null) {
              ou.push({ hcp: String(overEvent.parameter), over: parseFloat(over), under: parseFloat(under), scope });
            }
          }
          if (ou.length) evObj.ou = ou;
          // Handicap markets: group 2854 (types 3829/3830) is the full-match Asian Handicap
          // line; its `parameter` varies per match (0, ±0.25, ±2.5, ±2.75...).
          // Group 2 (types 7/8) has NO parameter and inconsistent home/away assignment across
          // events (verified) — it is NOT a safe AH/DNB source and is excluded.
          // hcp === 0 within group 2854 is effectively Draw-No-Bet; otherwise it's AH.
          const allAH = [];
          for (const [gid, hType, aType] of [[2854, 3829, 3830]]) {
            const g = groups[gid] || [];
            const hOdds = cf(g, hType), aOdds = cf(g, aType);
            const hcpVal = g.find(x => x[0]?.type === hType)?.[0]?.parameter;
            if (hOdds && aOdds && hcpVal != null) {
              allAH.push({ hcp: String(hcpVal), home: parseFloat(hOdds), away: parseFloat(aOdds) });
            }
          }
          // Split into DNB (hcp 0) and AH (any other line) — all MATCH scope
          const dnbs = allAH.filter(x => parseFloat(x.hcp) === 0);
          const ahs = allAH.filter(x => parseFloat(x.hcp) !== 0);
          if (dnbs.length) evObj.dnb = { home: dnbs[0].home, away: dnbs[0].away, hcp: dnbs[0].hcp, scope: 'MATCH' };
          if (ahs.length) evObj.ah = ahs.map(x => ({ hcp: String(Math.abs(parseFloat(x.hcp))), home: x.home, away: x.away, scope: 'MATCH' }));
          // Double Chance — group 8 (types 4/5/6 = 1X/12/X2, verified by 1X2-implied probability
          // math on 4 fixtures within book margin). MATCH scope, FT.
          const g8 = groups[8] || [];
          const dc1x = cf(g8, 4), dc12 = cf(g8, 5), dcx2 = cf(g8, 6);
          if (dc1x && dcx2 && dc12) evObj.dc = { '1x': parseFloat(dc1x), '12': parseFloat(dc12), 'x2': parseFloat(dcx2), scope: 'MATCH' };
          const g19 = groups[19] || [];
          const yes = cf(g19, 180), no = cf(g19, 181);
          if (yes && no) evObj.btts = { yes: parseFloat(yes), no: parseFloat(no), scope: 'MATCH' };
        } else {
          other++;
        }
        const key = `${ev.sport?.id}:${ev.opponent1?.fullName?.toLowerCase()}|${ev.opponent2?.fullName?.toLowerCase()}`;
        if (!seen.has(key)) { seen.add(key); events.push(evObj); }
      }
    }
    console.log(`[${book}] football ${fb}, other sports ${other}, parsed ${parsed}, unique ${events.length}`);
  } catch (e) {
    console.log(`[${book}] fetch fail: ${e.message.slice(0, 90)}`);
  }
  return events;
}

const fetch1xbet = () => fetch1xFamily('1xbet', '1xbet.cm');
const fetchBetwinner = () => fetch1xFamily('betwinner', 'betwinner.cm');
const fetchParipesa = () => fetch1xFamily('paripesa', 'paripesa.cm');

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
        const home = ev.eventNames[0], away = ev.eventNames[1];
        // Runtime label verifier (French): only accept market names that are unambiguously
        // whole-match AND full-time. Any name containing half/team indicators is rejected.
        const labelOk = (name) => {
          if (!name) return false;
          const period = normalizePeriod(name);
          const scope = normalizeScope(name, { home, away });
          // French full-match labels often omit "FT" ("Total de Buts") — accept only when the
          // name carries NO half marker and NO team marker, i.e. period is FT or unknown-blank,
          // scope is MATCH, and the label is not a team market.
          if (period === 'FIRST_HALF' || period === 'SECOND_HALF') return false;
          if (scope !== 'MATCH') return false;
          return true;
        };
        const o12 = (ev.markets || []).find(m => m.name === '1X2');
        const o = (mm) => { const x = {}; for (const oc of mm?.outcomes || []) x[oc.name] = parseFloat(oc.value); return x; };
        const evObj = { book: 'premierbet', home, away, league: `${sportName}:${comp.name}`, kickoff: ev.startTime,
          // upcoming events endpoint = full-match whole-match markets, label-verified
          period: 'FULL_MATCH', scope: 'MATCH', periodSource: 'runtime label verifier (no half/team markers)',
          link: `https://www.premierbet.com/cm/event/${ev.id}` };
        if (o12) { const O = o(o12); evObj.h = O['1']; evObj.d = O['X']; evObj.a = O['2']; }
        // O/U from Total de Buts (football only — basketball/tennis totals differ)
        if (sportName === 'football') {
          const ouMkt = (ev.markets || []).find(m => m.name === 'Total de Buts' && labelOk(m.name));
          if (ouMkt) {
            const byHcp = {};
            for (const oc of ouMkt.outcomes || []) {
              if (!oc.handicap || !oc.value) continue;
              byHcp[oc.handicap] = byHcp[oc.handicap] || {};
              if (oc.name === 'Plus de') byHcp[oc.handicap].over = parseFloat(oc.value);
              if (oc.name === 'Moins de') byHcp[oc.handicap].under = parseFloat(oc.value);
            }
            const lines = Object.entries(byHcp).filter(([h, v]) => v.over && v.under).map(([h, v]) => ({ hcp: h, over: v.over, under: v.under, scope: 'MATCH' }));
            if (lines.length) evObj.ou = lines;
          }
        }
        const dc = (ev.markets || []).find(m => m.name === 'Double Chance' && labelOk(m.name));
        if (dc) { const D = o(dc); evObj.dc = { '1x': D['1X'], 'x2': D['X2'], '12': D['12'], scope: 'MATCH' }; }
        const btts = (ev.markets || []).find(m => (m.name === 'Les Deux Equipes Marquent' || m.name === 'Les Deux Équipes Marquent') && labelOk(m.name));
        if (btts) { const B = o(btts); evObj.btts = { yes: B['Oui'], no: B['Non'], scope: 'MATCH' }; }
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

// WhatsApp via CallMeBot (personal notification relay — no business account needed).
// One-time setup (done by you, from your own WhatsApp):
//   1) Save +34 644 51 95 23 as a contact
//   2) Send it: "I allow callmebot to send me messages"
//   3) You receive an API key in reply
//   4) Set CALLMEBOT_PHONE=+237XXXXXXXXX (your WhatsApp number, with country code)
//      and CALLMEBOT_APIKEY=<the key> in .env.local (and in Railway env for the server)
// Without both env vars this is a no-op, so it is safe to deploy before setup.
const WHATSAPP_MAX_CHARS = 1000; // CallMeBot rejects/truncates longer payloads
async function sendWhatsApp(text) {
  const phone = process.env.CALLMEBOT_PHONE, apikey = process.env.CALLMEBOT_APIKEY;
  if (!phone || !apikey) return;
  try {
    let body = String(text);
    if (body.length > WHATSAPP_MAX_CHARS - 10) body = body.slice(0, WHATSAPP_MAX_CHARS - 10) + '…';
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(body)}&apikey=${encodeURIComponent(apikey)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const t = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 140);
    if (!r.ok || /error|invalid|not allowed|limit/i.test(t)) console.log(`[WhatsApp] ${r.status}: ${t}`);
    else console.log('[WhatsApp] sent');
  } catch (e) {
    console.log(`[WhatsApp] fail: ${e.message.slice(0, 80)}`);
  }
}

// Send to every configured channel (Telegram + WhatsApp). Missing config = skipped.
async function notify(text) {
  await Promise.allSettled([sendTelegram(text), sendWhatsApp(text)]);
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
    // 1xbet-family runs headed (needs display); others headless
    const headed = ['1xbet', 'betwinner', 'paripesa'].includes(book);
    ctx = await launchBook(book, { headless: !headed, viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(['1xbet', 'betwinner', 'paripesa'].includes(book) ? 16000 : 9000); // let markets render
    // Highlight the odds button: find element whose text matches the odds, outline + scroll to it.
    // CRITICAL: skip elements inside half-time / special-period markets — the scanner only ever
    // reports FULL-MATCH arbs, so highlighting a "1st Half" button would be a false visual.
    if (oddsValue) {
      const found = await page.evaluate((odds) => {
        const target = String(odds);
        // An element belongs to a half-time/special market if a nearby market-title ancestor
        // mentions a period (1st/2nd half, 1H/2H, minutes). Scanner arbs are always FULL MATCH.
        const isHalfPeriod = (el) => {
          let n = el, depth = 0;
          while (n && depth < 7) {
            const t = (n.textContent || '').trim();
            if (t && t.length < 80 && /(handicap|over|under|total|but|score)/i.test(t) && /(1st|2nd|first|second|1h|2h|half|period|minute)/i.test(t)) return true;
            n = n.parentElement; depth++;
          }
          return false;
        };
        const els = Array.from(document.querySelectorAll('a, button, span, div, [class*="odd"], [class*="coef"], [class*="price"]'));
        let hit = null;
        for (const el of els) {
          const t = (el.textContent || '').trim();
          if (t === target && !isHalfPeriod(el)) { hit = el; break; }
        }
        if (!hit) {
          // fuzzy: element whose text STARTS with the odds (book adds suffixes)
          for (const el of els) {
            const t = (el.textContent || '').trim();
            if (t.startsWith(target) && t.length <= target.length + 6 && !isHalfPeriod(el)) { hit = el; break; }
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
            const isHalfPeriod = (el) => {
              let n = el, depth = 0;
              while (n && depth < 7) {
                const t = (n.textContent || '').trim();
                if (t && t.length < 80 && /(handicap|over|under|total|but|score)/i.test(t) && /(1st|2nd|first|second|1h|2h|half|period|minute)/i.test(t)) return true;
                n = n.parentElement; depth++;
              }
              return false;
            };
            const els = Array.from(document.querySelectorAll('a, button, span, div, [class*="odd"], [class*="coef"], [class*="price"]'));
            let hit = null;
            for (const el of els) {
              const t = (el.textContent || '').trim();
              if (t === target && !isHalfPeriod(el)) { hit = el; break; }
            }
            if (!hit) for (const el of els) {
              const t = (el.textContent || '').trim();
              if (t.startsWith(target) && t.length <= target.length + 6 && !isHalfPeriod(el)) { hit = el; break; }
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
  // 1xbet-family feeds (1xbet/betwinner/paripesa) lag their live pages — flag them
  const hasFeedLag = c.legs.some(l => ['1xbet', 'betwinner', 'paripesa'].includes(l.book));
  const tag = periodShort(c.period) ? ` (${periodShort(c.period)})` : '';
  const lines = [];
  lines.push(suspicious ? '⚠️ POSSIBLE ARB — VERIFY PRICES BEFORE BETTING' : '🎯 ARBITRAGE FOUND — BET NOW');
  lines.push(`${c.teams[0]} vs ${c.teams[1]}`);
  const scopeStr = c.scope && c.scope !== 'MATCH' ? `  |  Scope: ${scopeLabel(c.scope)}` : '';
  lines.push(`Market: ${c.kind}  |  Period: ${periodLabel(c.period || PERIOD.UNKNOWN)}${scopeStr}`);
  lines.push(`Guaranteed ROI: ${pct.toFixed(2)}%`);
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
    const cap = s.book === '1xbet' ? '1xbet' : s.book === 'betwinner' ? 'BetWinner' : s.book === 'paripesa' ? 'PariPesa' : s.book === 'betfrenzy' ? 'BetFrenzy' : s.book === 'premierbet' ? 'PremierBet' : s.book === 'pmuc' ? 'PMUC' : s.book === 'betpawa' ? 'BetPawa' : s.book;
    lines.push(`${i + 1}) ON ${cap.toUpperCase()} → bet: ${s.bet}${tag}`);
    lines.push(`    Odds ${s.odds} | Stake ${s.stake} XAF → wins ${s.payout} XAF`);
    if (s.link) lines.push(`    Link: ${s.link}`);
  });
  lines.push('─'.repeat(32));
  lines.push(`Total stake 100 XAF → worst case pays ${c.worst?.toFixed(2) ?? c.legs[0]?.payout} XAF (guaranteed regardless of result)`);
  if (hasFeedLag) lines.push('⚠️ 1XBET-FAMILY odds come from their feed, NOT the live page. Confirm the price on the site BEFORE betting — if it moved, the arb is gone.');
  if (suspicious) lines.push('⚠️ Over 15% profit = likely a stale price. Check odds are live on both sites first.');
  const full = lines.join('\n');
  console.log(full);
  await notify(full);
  // Screenshot each book's match page — only for Asian Handicap (the trickiest to identify:
  // handicap sign ± matters). Auto-click the odds button so the bet slip shows the selection.
  if (c.kind.startsWith('Asian Handicap')) {
    for (const s of c.legs) {
      if (s.link) await sendBookScreenshot(s.book, s.link, `${c.teams[0]} vs ${c.teams[1]} — ${s.bet}${tag} @ ${s.odds} (${s.book.toUpperCase()})`, s.odds);
    }
  }
}

// Alert once per book outage (not every 2-min cycle) — resets when the book recovers
const bookDown = new Set();
const bookDownSince = {};
async function alertBookFailure(counts) {
  const MIN_EVENTS = { betfrenzy: 100, pmuc: 3, premierbet: 3, '1xbet': 10, betpawa: 20, betwinner: 10, paripesa: 10 };
  for (const [book, count] of Object.entries(counts)) {
    const min = MIN_EVENTS[book];
    if (min === undefined) continue;
    const isDown = count < min;
    if (isDown && !bookDown.has(book)) {
      bookDown.add(book);
      bookDownSince[book] = new Date().toISOString().slice(11, 19);
      const msg = `⚠️ ${book.toUpperCase()} is DOWN (${count} events) since ${bookDownSince[book]} UTC — check session/proxy. Recovery will be notified.`;
      console.log('[Alert]', msg);
      await notify(msg);
    } else if (!isDown && bookDown.has(book)) {
      bookDown.delete(book);
      const msg = `✅ ${book.toUpperCase()} is BACK (${count} events)`;
      console.log('[Alert]', msg);
      await notify(msg);
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
  const bw = await fetchBetwinner().catch(() => []);
  const pp = await fetchParipesa().catch(() => []);
  const sb = await fetchSportybet().catch(() => []);
console.log(`[Arb] betfrenzy ${bf.length}, betpawa ${bp.length}, pmuc ${pm.length}, premierbet ${pb.length}, 1xbet ${xb.length}, betwinner ${bw.length}, paripesa ${pp.length}, sportybet ${sb.length}`);
  await alertBookFailure({ betfrenzy: bf.length, betpawa: bp.length, pmuc: pm.length, premierbet: pb.length, '1xbet': xb.length, betwinner: bw.length, paripesa: pp.length });
  // Keep all events — kickoff is tagged per candidate so alerts show a countdown
  // (user decides; near-kickoff arbs are valid if placed fast)
  const all = [...bf, ...bp, ...pm, ...pb, ...xb, ...bw, ...pp, ...sb];
  return findCandidates(all);
}

// Fetch only the involved books SIMULTANEOUSLY (aligned snapshot)
async function collectBooksParallel(books) {
  const fns = [];
  if (books.has('betfrenzy')) fns.push(fetchBetfrenzy().catch(() => []));
  if (books.has('betpawa')) fns.push(fetchBetpawa().catch(() => []));
  if (books.has('pmuc')) fns.push(fetchPmuc().catch(() => []));
  if (books.has('premierbet')) fns.push(fetchPremierbet().catch(() => []));
  if (books.has('1xbet')) fns.push(fetch1xbet().catch(() => []));
  if (books.has('betwinner')) fns.push(fetchBetwinner().catch(() => []));
  if (books.has('paripesa')) fns.push(fetchParipesa().catch(() => []));
  if (books.has('sportybet')) fns.push(fetchSportybet().catch(() => []));
  const results = await Promise.all(fns);
  return results.flat();
}

// Re-run candidate detection over an event set and return the one matching `c.key`
function findCandidateIn(events, c) {
  const found = findCandidates(events);
  return found.find(x => x.key === c.key) || null;
}

// Rejection audit log — every rejected candidate records the exact reason.
// Never silently discard: false arbs cost real money, so the reason must be traceable.
function rejectLog(kind, legA, legB, reason, detail = '') {
  const line = `ARB REJECTED ${new Date().toISOString()} | ${kind} | ${reason}${detail ? ' | ' + detail : ''} | ${legA.book} ${legA.odds} vs ${legB.book} ${legB.odds} | periods ${legA.period || '?'}/${legB.period || '?'}`;
  console.log('[Reject]', line);
  try { fs.appendFileSync(path.join(__dirname, 'rejected_arbs.log'), line + '\n'); } catch (e) { /* non-fatal */ }
}

// Grouping logic — pure function over events; reused by all verification passes
function findCandidates(all) {
  const found = [];
  // pct is ALWAYS worst-case-based: pct = (worst/100 - 1) * 100. For binary markets
  // worst = 100/inv (exact); for quarter-line markets worst = 50 + 50/inv or the AH sim.
  const cand = (key, kind, teams, legs, inv, kickoff, period, worst, scope) => found.push({ key, kind, teams, legs, pct: (1 - inv) * 100, kickoff, period, worst, scope });
  const invDisplay = (worst) => 2 - worst / 100;

  // 1X2 grouping — league + youth/senior aware key so same-name matches in
  // different competitions (Champions League vs Youth League) never merge
  const g = new Map();
  for (const ev of all) { if (ev.h) { const k = `${norm(ev.home)}|${norm(ev.away)}|${canonLeague(ev.league)}${youthMark(ev.home + ev.away) ? '|youth' : ''}|${ev.period || PERIOD.UNKNOWN}|${ev.scope || 'MATCH'}|${dayOf(ev.kickoff)}`; (g.get(k) || g.set(k, { matches: [] }).get(k)).matches.push(ev); } }
for (const [k, grp] of g) {
    if (grp.matches.length < 2) continue;
    const h = grp.matches.reduce((b, m) => m.h > b.odds ? { book: m.book, odds: m.h, link: m.link, home: m.home, away: m.away, period: m.period, scope: m.scope } : b, { book: '', odds: 0 });
    const d = grp.matches.reduce((b, m) => (m.d || 0) > b.odds ? { book: m.book, odds: m.d, link: m.link, home: m.home, away: m.away, period: m.period, scope: m.scope } : b, { book: '', odds: 0 });
    const a = grp.matches.reduce((b, m) => m.a > b.odds ? { book: m.book, odds: m.a, link: m.link, home: m.home, away: m.away, period: m.period, scope: m.scope } : b, { book: '', odds: 0 });
    const srcs = new Set([h.book, d.book, a.book].filter(Boolean));
    if (srcs.size < 2) continue; // needs >=2 distinct books across the 3 legs
    const pair = pairEligible(h, d);
    if (!pair.ok) { rejectLog(`1X2|${k}`, h, d, pair.reason, pair.detail); continue; }
    const inv = 1/h.odds + 1/d.odds + 1/a.odds;
    if (inv < 1) { const r = calcArb([{ book: h.book, odds: h.odds }, { book: d.book, odds: d.odds }, { book: a.book, odds: a.odds }]); const worst = 100 / inv; cand(`1X2|${k}`, '1X2 — Match Winner', [h.home || grp.matches[0].home, h.away || grp.matches[0].away],
      [{ book: h.book, bet: (h.home || grp.matches[0].home) + ' to win (1)', odds: h.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout, link: h.link },
       { book: d.book, bet: 'Draw (X)', odds: d.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout, link: d.link },
       { book: a.book, bet: (a.away || grp.matches[0].away) + ' to win (2)', odds: a.odds, stake: r.stakes[2].stake, payout: r.stakes[2].payout, link: a.link }], invDisplay(worst), grp.matches[0].kickoff, pair.period, worst, pair.scope); }
  }

// ── O/U grouping (asian lines) — best over & best under must be DIFFERENT books ──
  const ou = new Map();
  for (const ev of all) { for (const o of ev.ou || []) { if (!o.hcp || !o.over || !o.under) continue; if (o.over < 1.01 || o.over > 20 || o.under < 1.01 || o.under > 20) continue; const k = `${norm(ev.home)}|${norm(ev.away)}|${canonLeague(ev.league)}${youthMark(ev.home + ev.away) ? '|youth' : ''}|${o.hcp}|${ev.period || PERIOD.UNKNOWN}|${o.scope || ev.scope || SCOPE.UNKNOWN}|${dayOf(ev.kickoff)}`; (ou.get(k) || ou.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, over: o.over, under: o.under, link: ev.link, period: ev.period, scope: o.scope || ev.scope, hcp: o.hcp, kickoff: ev.kickoff }); } }
  for (const [k, grp] of ou) {
    if (grp.matches.length < 2) continue;
    const over = grp.matches.reduce((b, m) => m.over > b.odds ? { book: m.book, odds: m.over, link: m.link, period: m.period, scope: m.scope } : b, { book: '', odds: 0 });
    const under = grp.matches.reduce((b, m) => m.under > b.odds ? { book: m.book, odds: m.under, link: m.link, period: m.period, scope: m.scope } : b, { book: '', odds: 0 });
    if (!over.book || over.book === under.book) continue; // same book both sides = voided, not arb
    const pair = pairEligible(over, under);
    if (!pair.ok) { rejectLog(`OU|${k}`, over, under, pair.reason, pair.detail); continue; }
    const inv = 1/over.odds + 1/under.odds;
    if (inv < 1) { const r = calcArb([{ book: over.book, odds: over.odds }, { book: under.book, odds: under.odds }]); const hcp = grp.matches[0].hcp; const worst = worstPayoutFor2Way(hcp, inv); cand(`OU|${k}`, `Over/Under ${hcp} Goals`, [k.split('|')[0], k.split('|')[1]],
      [{ book: over.book, bet: `Over ${hcp} goals`, odds: over.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout, link: over.link },
       { book: under.book, bet: `Under ${hcp} goals`, odds: under.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout, link: under.link }], invDisplay(worst), grp.matches[0].kickoff, pair.period, worst, pair.scope); }
  }

// ── Corners grouping (2-way over/under corners) — cross-book ──
  const cr = new Map();
  for (const ev of all) { for (const o of ev.corners || []) { if (!o.hcp || !o.over || !o.under) continue; if (o.over < 1.01 || o.over > 20 || o.under < 1.01 || o.under > 20) continue; const k = `${norm(ev.home)}|${norm(ev.away)}|${canonLeague(ev.league)}${youthMark(ev.home + ev.away) ? '|youth' : ''}|${o.hcp}|${ev.period || PERIOD.UNKNOWN}|${o.scope || ev.scope || SCOPE.UNKNOWN}|${dayOf(ev.kickoff)}`; (cr.get(k) || cr.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, over: o.over, under: o.under, link: ev.link, period: ev.period, scope: o.scope || ev.scope, hcp: o.hcp, kickoff: ev.kickoff }); } }
  for (const [k, grp] of cr) {
    if (grp.matches.length < 2) continue;
    const over = grp.matches.reduce((b, m) => m.over > b.odds ? { book: m.book, odds: m.over, link: m.link, period: m.period, scope: m.scope } : b, { book: '', odds: 0 });
    const under = grp.matches.reduce((b, m) => m.under > b.odds ? { book: m.book, odds: m.under, link: m.link, period: m.period, scope: m.scope } : b, { book: '', odds: 0 });
    if (!over.book || over.book === under.book) continue;
    const pair = pairEligible(over, under);
    if (!pair.ok) { rejectLog(`CR|${k}`, over, under, pair.reason, pair.detail); continue; }
    const inv = 1/over.odds + 1/under.odds;
    if (inv < 1) { const r = calcArb([{ book: over.book, odds: over.odds }, { book: under.book, odds: under.odds }]); const hcp = grp.matches[0].hcp; const worst = worstPayoutFor2Way(hcp, inv); cand(`CR|${k}`, `Corners Over/Under ${hcp}`, [k.split('|')[0], k.split('|')[1]],
      [{ book: over.book, bet: `Over ${hcp} corners`, odds: over.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout, link: over.link },
       { book: under.book, bet: `Under ${hcp} corners`, odds: under.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout, link: under.link }], invDisplay(worst), grp.matches[0].kickoff, pair.period, worst, pair.scope); }
  }

// ── Double Chance grouping (3-way: 1X/X2/12) ──
  const dc = new Map();
  for (const ev of all) { if (ev.dc) { const k = `${norm(ev.home)}|${norm(ev.away)}|${canonLeague(ev.league)}${youthMark(ev.home + ev.away) ? '|youth' : ''}|${ev.period || PERIOD.UNKNOWN}|${ev.dc.scope || ev.scope || SCOPE.UNKNOWN}|${dayOf(ev.kickoff)}`; (dc.get(k) || dc.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, dc: ev.dc, link: ev.link, period: ev.period, scope: ev.dc.scope || ev.scope }); } }
  for (const [k, grp] of dc) {
    if (grp.matches.length < 2) continue;
    const b1x = grp.matches.reduce((b, m) => m.dc['1x'] > b.odds ? { book: m.book, odds: m.dc['1x'], link: m.link, period: m.period, scope: m.scope } : b, { book: '', odds: 0 });
    const bx2 = grp.matches.reduce((b, m) => m.dc['x2'] > b.odds ? { book: m.book, odds: m.dc['x2'], link: m.link, period: m.period, scope: m.scope } : b, { book: '', odds: 0 });
    const b12 = grp.matches.reduce((b, m) => m.dc['12'] > b.odds ? { book: m.book, odds: m.dc['12'], link: m.link, period: m.period, scope: m.scope } : b, { book: '', odds: 0 });
    const srcs = new Set([b1x.book, bx2.book, b12.book].filter(Boolean));
    if (srcs.size < 2) continue;
    const pair = pairEligible(b1x, bx2);
    if (!pair.ok) { rejectLog(`DC|${k}`, b1x, bx2, pair.reason, pair.detail); continue; }
    const inv = 1/b1x.odds + 1/bx2.odds + 1/b12.odds;
    if (inv < 1) { const r = calcArb([{ book: b1x.book, odds: b1x.odds }, { book: bx2.book, odds: bx2.odds }, { book: b12.book, odds: b12.odds }]); const worst = 100 / inv; cand(`DC|${k}`, 'Double Chance', [k.split('|')[0], k.split('|')[1]],
      [{ book: b1x.book, bet: k.split('|')[0] + ' or Draw (1X)', odds: b1x.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout, link: b1x.link },
       { book: bx2.book, bet: k.split('|')[1] + ' or Draw (X2)', odds: bx2.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout, link: bx2.link },
       { book: b12.book, bet: 'No Draw (12)', odds: b12.odds, stake: r.stakes[2].stake, payout: r.stakes[2].payout, link: b12.link }], invDisplay(worst), grp.matches[0].kickoff, pair.period, worst, pair.scope); }
  }

// ── AH pairing (home -hcp vs away +hcp) — best sides must be DIFFERENT books ──
// Quarter handicaps are split-stake markets: the naive 1/oddsA + 1/oddsB < 1 check is NOT
// sufficient. Every AH candidate is validated by an outcome-based settlement simulation
// (see ahWorstCase in arb_engine.mjs): we enumerate every settlement breakpoint and require
// the WORST-CASE combined return to exceed the total stake by at least MIN_GUARANTEED_ROI.
  const ah = new Map();
  for (const ev of all) { for (const o of ev.ah || []) { if (!o.hcp) continue; const k = `${norm(ev.home)}|${norm(ev.away)}|${canonLeague(ev.league)}${youthMark(ev.home + ev.away) ? '|youth' : ''}|${o.hcp}|${ev.period || PERIOD.UNKNOWN}|${o.scope || ev.scope || SCOPE.UNKNOWN}|${dayOf(ev.kickoff)}`; (ah.get(k) || ah.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, home: o.home, away: o.away, link: ev.link, period: ev.period, scope: o.scope || ev.scope, hcp: o.hcp, kickoff: ev.kickoff }); } }
  for (const [k, grp] of ah) {
    if (grp.matches.length < 2) continue;
    const bHome = grp.matches.reduce((b, m) => m.home > b.odds ? { book: m.book, odds: m.home, link: m.link, period: m.period, scope: m.scope } : b, { book: '', odds: 0 });
    const bAway = grp.matches.reduce((b, m) => m.away > b.odds ? { book: m.book, odds: m.away, link: m.link, period: m.period, scope: m.scope } : b, { book: '', odds: 0 });
    if (!bHome.book || bHome.book === bAway.book) continue;
    const pair = pairEligible(bHome, bAway);
    if (!pair.ok) { rejectLog(`AH|${k}`, bHome, bAway, pair.reason, pair.detail); continue; }
    const inv = 1/bHome.odds + 1/bAway.odds;
    if (inv >= 1) continue; // naive pre-filter
    const r = calcArb([{ book: bHome.book, odds: bHome.odds }, { book: bAway.book, odds: bAway.odds }]);
    const hcp = parseFloat(grp.matches[0].hcp); // positive magnitude
    // Outcome-based validation: worst-case return across every settlement scenario
    const wc = ahWorstCase(
      { handicap: -hcp, odds: bHome.odds }, { handicap: +hcp, odds: bAway.odds },
      parseFloat(r.stakes[0].stake), parseFloat(r.stakes[1].stake));
    const worstRoi = wc.worstReturn / 100 - 1;
    if (worstRoi <= MIN_GUARANTEED_ROI) {
      rejectLog(`AH|${k}`, bHome, bAway, 'AH_WORST_CASE_BELOW_FLOOR', `naive ${(1 - inv).toFixed(4)} worst ${worstRoi.toFixed(4)} floor ${MIN_GUARANTEED_ROI}`);
      continue;
    }
    cand(`AH|${k}`, `Asian Handicap ${hcp}`, [k.split('|')[0], k.split('|')[1]],
      [{ book: bHome.book, bet: k.split('|')[0] + ' -' + hcp, odds: bHome.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout, link: bHome.link },
       { book: bAway.book, bet: k.split('|')[1] + ' +' + hcp, odds: bAway.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout, link: bAway.link }], invDisplay(wc.worstReturn), grp.matches[0].kickoff, pair.period, wc.worstReturn, pair.scope);
  }
// ── BTTS grouping (2-way yes/no) — best sides must be DIFFERENT books ──
  const bts = new Map();
  for (const ev of all) { if (ev.btts) { const k = `${norm(ev.home)}|${norm(ev.away)}|${canonLeague(ev.league)}${youthMark(ev.home + ev.away) ? '|youth' : ''}|${ev.period || PERIOD.UNKNOWN}|${ev.btts.scope || ev.scope || SCOPE.UNKNOWN}|${dayOf(ev.kickoff)}`; (bts.get(k) || bts.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, yes: ev.btts.yes, no: ev.btts.no, link: ev.link, period: ev.period, scope: ev.btts.scope || ev.scope }); } }
  for (const [k, grp] of bts) {
    if (grp.matches.length < 2) continue;
    const bYes = grp.matches.reduce((b, m) => m.yes > b.odds ? { book: m.book, odds: m.yes, link: m.link, period: m.period, scope: m.scope } : b, { book: '', odds: 0 });
    const bNo = grp.matches.reduce((b, m) => m.no > b.odds ? { book: m.book, odds: m.no, link: m.link, period: m.period, scope: m.scope } : b, { book: '', odds: 0 });
    if (!bYes.book || bYes.book === bNo.book) continue;
    const pair = pairEligible(bYes, bNo);
    if (!pair.ok) { rejectLog(`BTTS|${k}`, bYes, bNo, pair.reason, pair.detail); continue; }
    const inv = 1/bYes.odds + 1/bNo.odds;
    if (inv < 1) { const r = calcArb([{ book: bYes.book, odds: bYes.odds }, { book: bNo.book, odds: bNo.odds }]); const worst = 100 / inv; cand(`BTTS|${k}`, 'Both Teams To Score', [k.split('|')[0], k.split('|')[1]],
      [{ book: bYes.book, bet: 'Both teams score (Yes)', odds: bYes.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout, link: bYes.link },
       { book: bNo.book, bet: 'Not both score (No)', odds: bNo.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout, link: bNo.link }], invDisplay(worst), grp.matches[0].kickoff, pair.period, worst, pair.scope); }
  }
// ── DNB grouping (2-way home/away) — best sides must be DIFFERENT books ──
  const dnb = new Map();
  for (const ev of all) { if (ev.dnb) { const k = `${norm(ev.home)}|${norm(ev.away)}|${canonLeague(ev.league)}${youthMark(ev.home + ev.away) ? '|youth' : ''}|${ev.period || PERIOD.UNKNOWN}|${ev.dnb.scope || ev.scope || SCOPE.UNKNOWN}|${dayOf(ev.kickoff)}`; (dnb.get(k) || dnb.set(k, { matches: [] }).get(k)).matches.push({ book: ev.book, home: ev.dnb.home, away: ev.dnb.away, link: ev.link, period: ev.period, scope: ev.dnb.scope || ev.scope }); } }
  for (const [k, grp] of dnb) {
    if (grp.matches.length < 2) continue;
    const bHome = grp.matches.reduce((b, m) => m.home > b.odds ? { book: m.book, odds: m.home, link: m.link, period: m.period, scope: m.scope } : b, { book: '', odds: 0 });
    const bAway = grp.matches.reduce((b, m) => m.away > b.odds ? { book: m.book, odds: m.away, link: m.link, period: m.period, scope: m.scope } : b, { book: '', odds: 0 });
    if (!bHome.book || bHome.book === bAway.book) continue;
    const pair = pairEligible(bHome, bAway);
    if (!pair.ok) { rejectLog(`DNB|${k}`, bHome, bAway, pair.reason, pair.detail); continue; }
    const inv = 1/bHome.odds + 1/bAway.odds;
    if (inv < 1) { const r = calcArb([{ book: bHome.book, odds: bHome.odds }, { book: bAway.book, odds: bAway.odds }]); const worst = 100 / inv; cand(`DNB|${k}`, 'Draw No Bet', [k.split('|')[0], k.split('|')[1]],
      [{ book: bHome.book, bet: k.split('|')[0] + ' to win (draw refunds)', odds: bHome.odds, stake: r.stakes[0].stake, payout: r.stakes[0].payout, link: bHome.link },
       { book: bAway.book, bet: k.split('|')[1] + ' to win (draw refunds)', odds: bAway.odds, stake: r.stakes[1].stake, payout: r.stakes[1].payout, link: bAway.link }], invDisplay(worst), grp.matches[0].kickoff, pair.period, worst, pair.scope); }
  }
  console.log(`[Arb] Candidates: ${found.length} (${g.size} 1X2, ${ou.size} O/U, ${cr.size} Corners, ${dc.size} DC, ${ah.size} AH, ${bts.size} BTTS, ${dnb.size} DNB).`);
  return found;
}

// Report cooldown: the same arb re-appears every 2-min cycle while it persists.
// Alert once, then re-alert only if a leg moved >1% or 15 min elapsed — no Telegram spam.
const REPORT_COOLDOWN_MS = 15 * 60 * 1000;
const REPORT_ODDS_MOVE = 0.01;
const lastReported = new Map(); // key -> { at, odds }
function shouldReport(c) {
  const prev = lastReported.get(c.key);
  const now = Date.now();
  if (!prev) { lastReported.set(c.key, { at: now, odds: c.legs.map(l => l.odds) }); return true; }
  const moved = c.legs.some((l, i) => Math.abs(l.odds - (prev.odds[i] || 0)) / l.odds > REPORT_ODDS_MOVE);
  const cooled = now - prev.at >= REPORT_COOLDOWN_MS;
  if (moved || cooled) { lastReported.set(c.key, { at: now, odds: c.legs.map(l => l.odds) }); return true; }
  console.log(`[Report] skip (stable, within cooldown): ${c.kind} ${c.teams.join(' vs ')}`);
  return false;
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
  for (const c of aligned) if (shouldReport(c)) await report(c);
  for (const c of confirmed) if (!aligned.some(x => x.key === c.key)) console.log(`[Verify] dropped: ${c.kind} ${c.teams.join(' vs ')}`);
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



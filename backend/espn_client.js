/**
 * espn_client.js — free, open ESPN data (no API key, no browser, no Cloudflare).
 *
 * ESPN exposes a public JSON API used by their own site:
 *   GET /apis/site/v2/sports/soccer/{league}/scoreboard   -> fixtures + live scores
 *   GET /apis/site/v2/sports/soccer/{league}/summary?event={id} -> lineups, stats, events
 *   GET /apis/v2/scoreboard/header?sport=soccer           -> header (all leagues)
 *
 * Use as a SUPPLEMENT to API-Football: extra leagues/sports, lineups, and a
 * robust fallback when the paid source is rate-limited or missing a fixture.
 */
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const HDRS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

// Common league slugs (ESPN codes). Extend freely.
export const ESPN_LEAGUES = {
  epl: 'eng.1', championship: 'eng.2', laliga: 'esp.1', seriea: 'ita.1', bundesliga: 'ger.1',
  ligue1: 'fra.1', eredivisie: 'ned.1', primeira: 'por.1', ucl: 'uefa.champions',
  uel: 'uefa.europa', mls: 'usa.1', ligamx: 'mex.1', brasileirao: 'bra.1', copa: 'conmebol.libertadores',
  worldcup: 'fifa.world', caf: 'caf.champions',
};

function normalize(ev, league) {
  const c = (ev.competitions && ev.competitions[0]) || {};
  const comp = c.competitors || [];
  const home = comp.find(x => x.homeAway === 'home') || comp[0] || {};
  const away = comp.find(x => x.homeAway === 'away') || comp[1] || {};
  const st = c.status || ev.status || {};
  return {
    id: ev.id,
    league,
    name: ev.name || ev.shortName || '',
    date: ev.date || c.date || null,
    home: home.team ? (home.team.displayName || home.team.name) : '',
    away: away.team ? (away.team.displayName || away.team.name) : '',
    homeScore: home.score != null ? Number(home.score) : null,
    awayScore: away.score != null ? Number(away.score) : null,
    status: (st.type && (st.type.description || st.type.name)) || '',
    statusState: (st.type && st.type.state) || '',
    clock: st.displayClock || '',
    venue: c.venue ? (c.venue.fullName || '') : '',
    espnUrl: ev.links && ev.links[0] ? ev.links[0].href : null,
  };
}

/** Fixtures + live scores. league = ESPN slug (e.g. 'eng.1'). date = 'YYYY-MM-DD' (optional). */
export async function fetchScoreboard(league = 'eng.1', { date } = {}) {
  const q = date ? `?dates=${String(date).replace(/-/g, '')}` : '';
  const r = await fetch(`${BASE}/${league}/scoreboard${q}`, { headers: HDRS });
  if (!r.ok) throw new Error(`ESPN scoreboard ${r.status}`);
  const j = await r.json();
  return (j.events || []).map(ev => normalize(ev, league));
}

/** All-soccer header (leagues + counts) — one call, broad coverage. */
export async function fetchSoccerHeader() {
  const r = await fetch('https://site.api.espn.com/apis/v2/scoreboard/header?sport=soccer', { headers: HDRS });
  if (!r.ok) throw new Error(`ESPN header ${r.status}`);
  return r.json();
}

/** Match summary: lineups, team stats, key events. */
export async function fetchSummary(league, eventId) {
  const r = await fetch(`${BASE}/${league}/summary?event=${eventId}`, { headers: HDRS });
  if (!r.ok) throw new Error(`ESPN summary ${r.status}`);
  const j = await r.json();
  const rosters = j.rosters || [];
  const lineups = rosters.map(t => ({
    team: t.team ? (t.team.displayName || t.team.name) : '',
    starters: (t.roster || []).filter(p => p.starter).map(p => p.athlete && p.athlete.displayName).filter(Boolean),
    subs: (t.roster || []).filter(p => !p.starter).map(p => p.athlete && p.athlete.displayName).filter(Boolean),
  }));
  return { lineups, boxscore: j.boxscore || null, header: j.header || null, keyEvents: j.keyEvents || [] };
}

const _norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Resolve our prediction (team names + date) to an ESPN event. Tries the given
 * leagues, else all known leagues. Used to pull lineups/stats for a fixture.
 */
export async function findEvent({ home, away, date, leagues } = {}) {
  const hn = _norm(home), an = _norm(away);
  if (!hn || !an) return null;
  const codes = (leagues && leagues.length) ? leagues : Object.values(ESPN_LEAGUES);
  for (const code of codes) {
    let evs = [];
    try { evs = await fetchScoreboard(code, { date }); } catch (_) { continue; }
    for (const e of evs) {
      const eh = _norm(e.home), ea = _norm(e.away);
      if (!eh || !ea) continue;
      if ((eh.includes(hn) || hn.includes(eh)) && (ea.includes(an) || an.includes(ea))) {
        return { league: code, event: e };
      }
    }
  }
  return null;
}

export default { fetchScoreboard, fetchSoccerHeader, fetchSummary, findEvent, ESPN_LEAGUES };

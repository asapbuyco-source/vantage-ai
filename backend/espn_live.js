/**
 * espn_live.js — ESPN live matches normalized into the `live_scores` shape.
 * Merged into live_scores/current by the scheduler so the LiveScores page gains
 * ESPN's extra coverage (more leagues, no API key, no browser).
 */
import { fetchScoreboard, ESPN_LEAGUES } from './espn_client.js';

function toLive(e, leagueName) {
  return {
    id: `espn-${e.id}`,
    homeTeam: e.home || '',
    awayTeam: e.away || '',
    homeLogo: '', awayLogo: '',
    homeScore: e.homeScore,
    awayScore: e.awayScore,
    league: leagueName,
    leagueLogo: '',
    stateShort: 'LIVE',
    stateLong: e.status || 'In Play',
    minute: e.clock || '',
    events: [],
    source: 'espn',
  };
}

/** In-play ESPN matches across all configured leagues. */
export async function fetchEspnLive() {
  const out = [];
  for (const [name, code] of Object.entries(ESPN_LEAGUES)) {
    try {
      const events = await fetchScoreboard(code);
      for (const e of events) if (e.statusState === 'in') out.push(toLive(e, name));
    } catch (_) { /* one league failing never blocks the rest */ }
  }
  return out;
}

export default { fetchEspnLive };

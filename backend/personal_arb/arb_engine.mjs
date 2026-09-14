/**
 * arb_engine.mjs — pure arbitrage market logic (no browser, no network).
 * Period identity, strict cross-book pairing, Asian Handicap settlement simulation.
 *
 * Core safety principle: FALSE-POSITIVE PREVENTION > FINDING MORE ARBS.
 * A market with unknown period is NEVER eligible for arbitrage.
 */

export const PERIOD = Object.freeze({
  FULL_MATCH: 'FULL_MATCH',
  FIRST_HALF: 'FIRST_HALF',
  SECOND_HALF: 'SECOND_HALF',
  FIRST_10_MINUTES: 'FIRST_10_MINUTES',
  FIRST_15_MINUTES: 'FIRST_15_MINUTES',
  UNKNOWN: 'UNKNOWN',
});

/**
 * SCOPE — who the market is about: the whole match, or one team.
 * "Total 1" (team 1 goals) and "Total" (match goals) are DIFFERENT markets with
 * different probabilities — they must never be paired as opposite sides of an arb.
 */
export const SCOPE = Object.freeze({
  MATCH: 'MATCH',
  TEAM_1: 'TEAM_1',
  TEAM_2: 'TEAM_2',
  UNKNOWN: 'UNKNOWN',
});

export function scopeLabel(s) {
  switch (s) {
    case SCOPE.MATCH: return 'MATCH';
    case SCOPE.TEAM_1: return 'TEAM 1';
    case SCOPE.TEAM_2: return 'TEAM 2';
    default: return 'UNKNOWN';
  }
}

/**
 * normalizeScope — classify a market label as whole-match vs team-specific.
 * Every platform writes it differently ("Total 1", "Team 1 Total", "Individual 1",
 * "Over/Under | <Team> | Full Time", "Équipe 1"...). Team indicators are checked
 * BEFORE generic total/match words because "Total 1" means team 1, not a match total.
 * When `home`/`away` team names are provided, labels containing a team name are
 * classified as that team's market. Ambiguous labels → UNKNOWN (never guesses).
 */
export function normalizeScope(raw, { home, away } = {}) {
  if (raw == null) return SCOPE.UNKNOWN;
  const t = String(raw).toLowerCase().trim();
  if (!t) return SCOPE.UNKNOWN;
  // team indicators with a digit: "team 1", "total 1", "individual 1", "équipe 1", "time 1"
  if (/(team|individual|total|équipe|equipe|equipo|time|handicap|goals?)\s*[-_:#]?\s*1\b/.test(t) || /\b1st\s*team\b/.test(t)) return SCOPE.TEAM_1;
  if (/(team|individual|total|équipe|equipe|equipo|time|handicap|goals?)\s*[-_:#]?\s*2\b/.test(t) || /\b2nd\s*team\b/.test(t)) return SCOPE.TEAM_2;
  // explicit team-name match (e.g. "Over/Under | Deportivo Alaves | Full Time")
  if (home && t.includes(String(home).toLowerCase())) return SCOPE.TEAM_1;
  if (away && t.includes(String(away).toLowerCase())) return SCOPE.TEAM_2;
  if (/\b(home)\b/.test(t)) return SCOPE.TEAM_1;
  if (/\b(away)\b/.test(t)) return SCOPE.TEAM_2;
  // Segment check: labels like "Over/Under | <Team> | Full Time" carry an extra qualifier
  // that is neither a match keyword nor a period marker. Without home/away context that
  // qualifier could be a team name → treat the label as UNKNOWN (never guess).
  const segments = String(raw).split('|').map(s => s.trim()).filter(Boolean);
  if (segments.length > 1) {
    const known = /(over|under|total|handicap|full|time|match|both|teams?|score|double|chance|draw|no|bet|1x2|goals?|asian|home|away|individual|ft|1h|2h|first|second|half)/i;
    for (const seg of segments) {
      if (!known.test(seg)) return SCOPE.UNKNOWN;
    }
  }
  // whole-match indicators
  if (/\b(match|full|global|all|overall|total|both teams|double chance|draw no bet|1x2|winner|handicap|over\/under|goals|score)\b/.test(t)) return SCOPE.MATCH;
  return SCOPE.UNKNOWN;
}

export function periodLabel(p) {
  switch (p) {
    case PERIOD.FULL_MATCH: return 'FULL MATCH';
    case PERIOD.FIRST_HALF: return 'FIRST HALF';
    case PERIOD.SECOND_HALF: return 'SECOND HALF';
    case PERIOD.FIRST_10_MINUTES: return 'FIRST 10 MINUTES';
    case PERIOD.FIRST_15_MINUTES: return 'FIRST 15 MINUTES';
    default: return p || 'UNKNOWN';
  }
}

export function periodShort(p) {
  switch (p) {
    case PERIOD.FULL_MATCH: return 'FT';
    case PERIOD.FIRST_HALF: return '1H';
    case PERIOD.SECOND_HALF: return '2H';
    default: return '';
  }
}

/**
 * normalizePeriod — NEVER guesses.
 * Returns an explicit period only when the label clearly says so; otherwise UNKNOWN.
 * A missing/blank label → UNKNOWN. Bare labels without an explicit period ("AH",
 * "Handicap", "Asian Handicap") → UNKNOWN too, UNLESS the caller proves the market is
 * full-match via fullMatchContext (e.g. a documented endpoint contract).
 */
export function normalizePeriod(raw, { fullMatchContext = false } = {}) {
  if (raw == null) return PERIOD.UNKNOWN;
  const t = String(raw).toLowerCase().trim();
  if (!t) return PERIOD.UNKNOWN;
  if (/(1st|first|1er|1ère|première|premier)\s*(half|mi-temps|h)?|(^|\s)1h\b|half\s*1|1st\s*half/.test(t)) return PERIOD.FIRST_HALF;
  if (/(2nd|second|2e|2ème|deuxième|deuxièm)\s*(half|mi-temps|h)?|(^|\s)2h\b|half\s*2|2nd\s*half/.test(t)) return PERIOD.SECOND_HALF;
  if (/\b(full|match|entier|principal|main|regular|90|ft)\b/.test(t) || t === '1x2') return PERIOD.FULL_MATCH;
  if (fullMatchContext) return PERIOD.FULL_MATCH; // bare label + confirmed full-match context
  return PERIOD.UNKNOWN;
}

/**
 * pairEligible — strict cross-book pairing gate.
 * Both legs MUST carry the SAME explicit period AND the SAME scope (match vs team 1/2).
 * UNKNOWN period or scope never matches anything. This is the single gate that makes
 * "1st half vs full time" and "team total vs match total" false arbs impossible.
 * Returns { ok, reason, detail? } — reasons: MARKET_PERIOD_MISMATCH, MARKET_PERIOD_UNKNOWN,
 * MARKET_SCOPE_MISMATCH, MARKET_SCOPE_UNKNOWN, MISSING_LEG, OK.
 */
export function pairEligible(a, b) {
  if (!a || !b || !a.period || !b.period) return { ok: false, reason: 'MISSING_LEG' };
  if (a.period === PERIOD.UNKNOWN || b.period === PERIOD.UNKNOWN) {
    return { ok: false, reason: 'MARKET_PERIOD_UNKNOWN', detail: `${a.period} vs ${b.period}` };
  }
  if (a.period !== b.period) {
    return { ok: false, reason: 'MARKET_PERIOD_MISMATCH', detail: `${a.period} vs ${b.period}` };
  }
  const sa = a.scope || SCOPE.UNKNOWN;
  const sb = b.scope || SCOPE.UNKNOWN;
  if (sa === SCOPE.UNKNOWN || sb === SCOPE.UNKNOWN) {
    return { ok: false, reason: 'MARKET_SCOPE_UNKNOWN', detail: `${sa} vs ${sb}` };
  }
  if (sa !== sb) {
    return { ok: false, reason: 'MARKET_SCOPE_MISMATCH', detail: `${sa} vs ${sb}` };
  }
  return { ok: true, reason: 'OK', period: a.period, scope: sa };
}

/**
 * splitAsianLine — quarter handicaps are split-stake markets.
 * -0.25 → [0, -0.5]   +0.25 → [0, +0.5]
 * -0.75 → [-0.5, -1]  +0.75 → [+0.5, +1]
 * integer/half lines → single stake.
 * `h` is the SIGNED handicap from the bettor's perspective.
 */
export function splitAsianLine(h) {
  const v = Math.abs(h);
  const sign = h < 0 ? -1 : 1;
  const rem = v - Math.floor(v);
  if (rem === 0.25 || rem === 0.75) {
    const a = sign * (v - 0.25);
    const b = sign * (v + 0.25);
    return [Object.is(a, -0) ? 0 : a, Object.is(b, -0) ? 0 : b];
  }
  return [h];
}

/**
 * settleAsianHandicap — settlement simulation for one bet.
 * margin = (home - away) goal difference, in the SAME convention as `handicap`
 * (i.e. a home -0.25 bet uses margin = home-away; an away +0.25 bet uses margin = away-home).
 * Each split sub-stake: margin + sub > 0 → win (stake*odds), == 0 → refund (stake), < 0 → lose (0).
 */
export function settleAsianHandicap({ margin, handicap, odds, stake }) {
  const subs = splitAsianLine(handicap);
  const per = stake / subs.length;
  let ret = 0;
  for (const s of subs) {
    const d = margin + s;
    if (d > 0) ret += per * odds;
    else if (d === 0) ret += per;
  }
  return ret;
}

/**
 * ahWorstCase — outcome-based validation for a 2-way AH arb pair.
 * legA = home side (handicap -h, e.g. -0.25), legB = away side (handicap +h).
 * Margin m = home - away. Enumerates every settlement breakpoint (where any
 * sub-handicap crosses zero) plus extremes, and returns the WORST-CASE and
 * BEST-CASE combined return for the given stakes.
 * Return values are in stake units (stakeA + stakeB = total stake).
 */
export function ahWorstCase(legA, legB, stakeA, stakeB) {
  const margins = new Set([-10, 10]);
  for (const leg of [legA, legB]) {
    for (const s of splitAsianLine(leg.handicap)) {
      margins.add(-s); // legA breakpoint (margin + s = 0 → margin = -s)
      margins.add(s);  // legB uses -margin, so its breakpoint is margin = s
    }
  }
  let worst = Infinity;
  let best = -Infinity;
  for (const m of margins) {
    const ra = settleAsianHandicap({ margin: m, handicap: legA.handicap, odds: legA.odds, stake: stakeA });
    const rb = settleAsianHandicap({ margin: -m, handicap: legB.handicap, odds: legB.odds, stake: stakeB });
    const tot = ra + rb;
    if (tot < worst) worst = tot;
    if (tot > best) best = tot;
  }
  return { worstReturn: worst, bestReturn: best };
}

/**
 * isQuarterLine — a line is split-stake when its fraction is .25 or .75
 * (e.g. 2.25, 2.75, 10.25). Integer/half lines settle as a single stake.
 */
export function isQuarterLine(line) {
  const v = Math.abs(parseFloat(line));
  const rem = v - Math.floor(v);
  return rem === 0.25 || rem === 0.75;
}

/**
 * worstPayoutFor2Way — worst-case combined return (in 100-stake units) for a
 * complementary 2-way pair (over/under or AH home/away on the SAME line).
 *
 * Binary/half lines (0, 0.5, 1, ...): every outcome settles fully →
 * worst = 100/inv (exact guaranteed payout).
 *
 * Quarter lines (0.25, 0.75, ...): the boundary outcome (exactly on the line)
 * splits stakes — each side gets half refund / half settled. For a complementary
 * pair the worst case is always 50 + 50/inv (derivation: half the stake on each
 * leg returns, the other half settles at full odds) → this is the HONEST
 * guaranteed figure, below the naive 100/inv.
 *
 * Returns the worst-case payout for a 100 XAF total stake.
 */
export function worstPayoutFor2Way(line, inv) {
  if (!isQuarterLine(line)) return 100 / inv;
  return 50 + 50 / inv;
}
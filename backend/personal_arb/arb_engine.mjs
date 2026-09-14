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
  if (/(full|match|entier|principal|main|regular|90)/.test(t) || t === 'ft' || t === '1x2') return PERIOD.FULL_MATCH;
  if (fullMatchContext) return PERIOD.FULL_MATCH; // bare label + confirmed full-match context
  return PERIOD.UNKNOWN;
}

/**
 * pairEligible — strict cross-book pairing gate.
 * Both legs MUST carry the SAME explicit period; UNKNOWN never matches anything.
 * Returns { ok, reason } — reason is one of MARKET_PERIOD_MISMATCH,
 * MARKET_PERIOD_UNKNOWN, MISSING_LEG, or OK.
 */
export function pairEligible(a, b) {
  if (!a || !b || !a.period || !b.period) return { ok: false, reason: 'MISSING_LEG' };
  if (a.period === PERIOD.UNKNOWN || b.period === PERIOD.UNKNOWN) {
    return { ok: false, reason: 'MARKET_PERIOD_UNKNOWN', period: a.period === PERIOD.UNKNOWN ? a.period : b.period };
  }
  if (a.period !== b.period) {
    return { ok: false, reason: 'MARKET_PERIOD_MISMATCH', detail: `${a.period} vs ${b.period}` };
  }
  return { ok: true, reason: 'OK', period: a.period };
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
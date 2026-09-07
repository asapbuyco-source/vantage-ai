/**
 * arb_calc.js — pure arb math, no browser needed.
 * Usage: import { calcArb } from './arb_calc.js'
 */
export function calcArb(oddsList) {
  // oddsList: [{book, market, odds}, ...] for same outcome
  // For 1X2: need 3 odds, for O/U: 2 odds
  const invSum = oddsList.reduce((s, o) => s + 1 / o.odds, 0);
  const arbPct = (1 - invSum) * 100;
  const isArb = invSum < 1;
  // Stake calc for totalStake = 100 (XAF)
  const stakes = isArb ? oddsList.map(o => ({
    ...o,
    stake: (1 / o.odds / invSum * 100).toFixed(2),
    payout: (1 / o.odds / invSum * 100 * o.odds).toFixed(2),
  })) : [];
  return { invSum: invSum.toFixed(4), arbPct: arbPct.toFixed(2), isArb, stakes };
}

// Example:
// const r = calcArb([{book:'1xbet', odds:2.10}, {book:'melbet', odds:2.15}]);
// console.log(r); // { invSum: '0.94', arbPct: '5.81', isArb: true, stakes: [...] }

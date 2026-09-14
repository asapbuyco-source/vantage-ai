/**
 * arb_engine.test.mjs — automated tests for the market-period matching + AH settlement logic.
 * Run: node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERIOD, periodLabel, periodShort, normalizePeriod,
  pairEligible, splitAsianLine, settleAsianHandicap, ahWorstCase,
  isQuarterLine, worstPayoutFor2Way,
} from '../arb_engine.mjs';

const FULL = PERIOD.FULL_MATCH, H1 = PERIOD.FIRST_HALF, H2 = PERIOD.SECOND_HALF, UNK = PERIOD.UNKNOWN;

// ── TEST 1 + 2: same-period pairs are eligible ──
test('TEST 1: FIRST_HALF -0.25 + FIRST_HALF +0.25 => eligible', () => {
  const r = pairEligible({ period: H1 }, { period: H1 });
  assert.equal(r.ok, true);
  assert.equal(r.period, H1);
});

test('TEST 2: FULL_MATCH -0.25 + FULL_MATCH +0.25 => eligible', () => {
  const r = pairEligible({ period: FULL }, { period: FULL });
  assert.equal(r.ok, true);
  assert.equal(r.period, FULL);
});

// ── TEST 3 + 4: cross-period pairs MUST be rejected ──
test('TEST 3: FIRST_HALF -0.25 + FULL_MATCH +0.25 => MUST REJECT', () => {
  const r = pairEligible({ period: H1 }, { period: FULL });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'MARKET_PERIOD_MISMATCH');
  assert.equal(r.detail, 'FIRST_HALF vs FULL_MATCH');
});

test('TEST 4: FULL_MATCH -0.25 + SECOND_HALF +0.25 => MUST REJECT', () => {
  const r = pairEligible({ period: FULL }, { period: H2 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'MARKET_PERIOD_MISMATCH');
});

// ── TEST 5 + 6: UNKNOWN never matches anything ──
test('TEST 5: UNKNOWN -0.25 + FULL_MATCH +0.25 => MUST REJECT', () => {
  const r = pairEligible({ period: UNK }, { period: FULL });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'MARKET_PERIOD_UNKNOWN');
});

test('TEST 6: FIRST_HALF -0.25 + UNKNOWN +0.25 => MUST REJECT', () => {
  const r = pairEligible({ period: H1 }, { period: UNK });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'MARKET_PERIOD_UNKNOWN');
});

// ── TEST 7: same event, different periods => never an arb (matching keys must differ) ──
test('TEST 7: same event different periods => matching keys differ, cannot pair', () => {
  const keyA = `villarreal|real betis|la liga|0.25|${H1}`;
  const keyB = `villarreal|real betis|la liga|0.25|${FULL}`;
  assert.notEqual(keyA, keyB);
  assert.equal(pairEligible({ period: H1 }, { period: FULL }).ok, false);
});

// ── normalizePeriod: explicit labels only, never guesses ──
test('normalizePeriod: explicit half labels => FIRST_HALF / SECOND_HALF', () => {
  assert.equal(normalizePeriod('Asian Handicap -0.25 (1st Half)'), H1);
  assert.equal(normalizePeriod('1st Half Asian Handicap'), H1);
  assert.equal(normalizePeriod('Asian Handicap 1H'), H1);
  assert.equal(normalizePeriod('Asian Handicap -0.25 (2nd Half)'), H2);
  assert.equal(normalizePeriod('2nd Half Asian Handicap'), H2);
});

test('normalizePeriod: bare labels are UNKNOWN unless full-match context is proven', () => {
  assert.equal(normalizePeriod('Asian Handicap'), UNK);
  assert.equal(normalizePeriod('Asian Handicap -0.25'), UNK);
  assert.equal(normalizePeriod('AH'), UNK);
  assert.equal(normalizePeriod('Handicap'), UNK);
  assert.equal(normalizePeriod('Asian Handicap', { fullMatchContext: true }), FULL);
  assert.equal(normalizePeriod('AH', { fullMatchContext: true }), FULL);
  assert.equal(normalizePeriod('Full Time 1X2'), FULL);
});

test('normalizePeriod: missing/ambiguous => UNKNOWN (never guesses)', () => {
  assert.equal(normalizePeriod(''), UNK);
  assert.equal(normalizePeriod(null), UNK);
  assert.equal(normalizePeriod(undefined), UNK);
  assert.equal(normalizePeriod('odds jackpot'), UNK);
});

// ── quarter handicap split stakes ──
test('splitAsianLine: quarter lines split 50/50', () => {
  assert.deepEqual(splitAsianLine(-0.25), [0, -0.5]);
  assert.deepEqual(splitAsianLine(0.25), [0, 0.5]);
  assert.deepEqual(splitAsianLine(-0.75), [-0.5, -1]);
  assert.deepEqual(splitAsianLine(0.75), [0.5, 1]);
});

test('splitAsianLine: integer/half lines are single stake', () => {
  assert.deepEqual(splitAsianLine(-1), [-1]);
  assert.deepEqual(splitAsianLine(0), [0]);
  assert.deepEqual(splitAsianLine(0.5), [0.5]);
});

// ── settlement simulation ──
test('settleAsianHandicap: -0.25 at margin 0 (draw) => half refund, half loss', () => {
  assert.equal(settleAsianHandicap({ margin: 0, handicap: -0.25, odds: 2.0, stake: 100 }), 50);
});

test('settleAsianHandicap: +0.25 at margin 0 (draw) => half refund, half win', () => {
  assert.equal(settleAsianHandicap({ margin: 0, handicap: 0.25, odds: 2.274, stake: 100 }), 50 + 50 * 2.274);
});

test('settleAsianHandicap: -0.25 at margin +1 => full win', () => {
  assert.equal(settleAsianHandicap({ margin: 1, handicap: -0.25, odds: 2.0, stake: 100 }), 200);
});

test('settleAsianHandicap: +0.25 at margin +1 (bettor side won by 1) => full win', () => {
  assert.equal(settleAsianHandicap({ margin: 1, handicap: 0.25, odds: 2.274, stake: 100 }), 227.4);
});

// ── the exact reported case: betfrenzy -0.25 @ 2.00 vs 1xbet +0.25 @ 2.274 ──
// Naive inv = 0.9398 => "6.02%". Settlement simulation shows the TRUE worst case is ~3.2%
// (margin 0: half-refund/half-win on each side). This is the guaranteed profit.
test('AH worst-case: 2.00 vs 2.274 (0.25 line) => worst-case ROI > 0 (real arb passes)', () => {
  const inv = 1 / 2.00 + 1 / 2.274;
  assert.ok(inv < 1, 'naive pre-filter passes');
  const stakeA = (1 / 2.00 / inv) * 100;
  const stakeB = (1 / 2.274 / inv) * 100;
  const wc = ahWorstCase(
    { handicap: -0.25, odds: 2.00 }, { handicap: 0.25, odds: 2.274 },
    stakeA, stakeB);
  const worstRoi = wc.worstReturn / 100 - 1;
  // worst case is the draw (margin 0): partial settle on both legs
  assert.ok(worstRoi > 0.01, `worst-case ROI ${worstRoi.toFixed(4)} should be > 1%`);
  assert.ok(worstRoi < 0.04, `worst-case ROI ${worstRoi.toFixed(4)} should be BELOW naive 6.02%`);
});

// ── the SAME odds with mismatched periods must never be an arb ──
test('AH worst-case: 2.00 (FIRST_HALF) vs 2.274 (FULL_MATCH) => pair rejected', () => {
  const r = pairEligible({ period: H1 }, { period: FULL });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'MARKET_PERIOD_MISMATCH');
});

// ── complementary integer line: worst case == naive margin ──
test('AH worst-case: integer lines (2.0/2.0) => worst case ROI 0, NOT an arb', () => {
  const inv = 1 / 2.0 + 1 / 2.0;
  assert.equal(inv, 1);
  const wc = ahWorstCase(
    { handicap: -1, odds: 2.0 }, { handicap: 1, odds: 2.0 },
    50, 50);
  assert.equal(wc.worstReturn, 100); // every margin settles to exactly the stake
  assert.equal(wc.worstReturn / 100 - 1, 0);
});

// ── display helpers ──
test('periodLabel/periodShort formatting', () => {
  assert.equal(periodLabel(FULL), 'FULL MATCH');
  assert.equal(periodLabel(H1), 'FIRST HALF');
  assert.equal(periodShort(FULL), 'FT');
  assert.equal(periodShort(H1), '1H');
  assert.equal(periodShort(UNK), '');
});

// ── worst-case payout for 2-way markets (reported Guaranteed ROI basis) ──
test('isQuarterLine detection', () => {
  assert.equal(isQuarterLine('2.25'), true);
  assert.equal(isQuarterLine('2.75'), true);
  assert.equal(isQuarterLine('0.25'), true);
  assert.equal(isQuarterLine('2.5'), false);
  assert.equal(isQuarterLine('2'), false);
  assert.equal(isQuarterLine('0'), false);
  assert.equal(isQuarterLine('10.25'), true);
});

test('worstPayoutFor2Way: binary/half lines => exact 100/inv', () => {
  const inv = 1 / 2.0 + 1 / 2.1; // 0.9762
  assert.equal(worstPayoutFor2Way('2.5', inv), 100 / inv);
  assert.equal(worstPayoutFor2Way('1', inv), 100 / inv);
  assert.equal(worstPayoutFor2Way('0', inv), 100 / inv);
});

test('worstPayoutFor2Way: quarter lines => honest 50 + 50/inv (below naive)', () => {
  const inv = 1 / 2.0 + 1 / 2.1; // 0.9762
  const naive = 100 / inv;
  const worst = worstPayoutFor2Way('2.25', inv);
  assert.equal(worst, 50 + 50 / inv);
  assert.ok(worst < naive, 'worst must be below the naive payout');
  assert.ok(worst > 100, 'but still profitable when inv < 1');
});

test('worstPayoutFor2Way: quarter line with inv >= 1 is never profitable', () => {
  const inv = 1 / 2.0 + 1 / 2.0; // exactly 1 → no arb
  const worst = worstPayoutFor2Way('2.25', inv);
  assert.equal(worst, 100); // break-even at best, never positive
});
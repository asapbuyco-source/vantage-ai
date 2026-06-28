/**
 * backend/dateUtils.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared Africa/Lagos date-key utility.
 * Single source of truth — all backend modules MUST import from here.
 */

export const getLagosDateKey = (daysOffset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
};

export const getLagosTodayKey = () => getLagosDateKey(0);
export const getLagosYesterdayKey = () => getLagosDateKey(-1);
export const getLagosTomorrowKey = () => getLagosDateKey(1);

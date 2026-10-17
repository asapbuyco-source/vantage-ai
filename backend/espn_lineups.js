/**
 * espn_lineups.js — fills the `lineups/{fixtureId}` docs from ESPN when the paid
 * source (API-Football LineupSyncer) has none. Same shape the frontend reads.
 */
import admin from 'firebase-admin';
import { findEvent, fetchSummary } from './espn_client.js';

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const mk = (arr, team, isHome) => (arr || []).map(name => ({ name, teamName: team, isHome }));

export async function syncEspnLineups(dateStr) {
  const db = admin.firestore();
  const snap = await db.collection('quant_predictions').doc(dateStr).get();
  if (!snap.exists) return { updated: 0, checked: 0 };
  const preds = (snap.data() || {}).predictions || [];
  let updated = 0, checked = 0;
  for (const p of preds) {
    const fid = String(p.fixture_id || '');
    const home = p.home_team || p.homeTeam;
    const away = p.away_team || p.awayTeam;
    if (!fid || !home || !away) continue;
    checked++;
    try {
      const existing = await db.collection('lineups').doc(fid).get();
      if (existing.exists) {
        const d = existing.data() || {};
        if ((d.home || []).length || (d.away || []).length) continue; // already have lineups
      }
      const found = await findEvent({ home, away, date: dateStr });
      if (!found) continue;
      const s = await fetchSummary(found.league, found.event.id);
      const pick = (want) => s.lineups.find(l => norm(l.team) === norm(want)) || null;
      const homeL = pick(home) || s.lineups[0] || { starters: [], subs: [] };
      const awayL = pick(away) || s.lineups[1] || { starters: [], subs: [] };
      if (!homeL.starters.length && !awayL.starters.length) continue; // ESPN not published yet
      await db.collection('lineups').doc(fid).set({
        home: [...mk(homeL.starters, home, true), ...mk(homeL.subs, home, true)],
        away: [...mk(awayL.starters, away, false), ...mk(awayL.subs, away, false)],
        source: 'espn',
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      updated++;
    } catch (_) { /* one fixture failing never blocks the rest */ }
  }
  return { updated, checked };
}

export default { syncEspnLineups };

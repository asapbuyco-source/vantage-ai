/**
 * backend/telegramMessaging.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Vantage AI Telegram daily-picks messaging system — analytics-first redesign.
 *
 * Three daily messages with distinct purposes:
 *   A) FREE PICKS    — featured model selections (short, scannable)
 *   B) MEMBER PICKS  — concise value proposition (no desperation)
 *   C) RESULTS       — actual recorded outcomes (no cherry-picking)
 *
 * All factual data (teams, competition, odds, confidence, xG, kickoff) comes
 * ONLY from the trusted prediction records. The LLM formats; it never invents.
 * Every published free pick is persisted to Firestore `public_picks` for a
 * real public track record.
 *
 * Imported by scheduler.js; reuses getTelegramSettings/sendMessage from
 * telegramService.js so no duplicate Telegram plumbing.
 */

import admin from 'firebase-admin';
import { getLagosTodayKey } from './dateUtils.js';
import { getTelegramSettings, sendMessage } from './telegramService.js';

const PLAYSTORE_URL = 'https://play.google.com/store/apps/details?id=com.vantageai.app';
const DIVIDER = '────────────';

// ── Helpers ───────────────────────────────────────────────────────────────────

const roundConfidence = (c) => (c == null ? null : Math.round(c));

/** "84.5%" → "84%"; "0.845" → "84%" */
const confidencePct = (m) => {
  if (m.confidence != null) return `${roundConfidence(m.confidence)}%`;
  if (m.probability != null) return `${Math.round(m.probability * 100)}%`;
  return null;
};

const oddsText = (m) => {
  const o = Number(m.odds ?? m.odds_at_publication);
  return o > 0 ? o.toFixed(2) : null;
};

const kickoffText = (m) => m.kickoff_local || m.time || '';

const displayDateStr = (dateStr) => {
  const d = new Date(dateStr + 'T12:00:00');
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()} · ${d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()}`;
};

// ── 7. Data validation (STRICT) ───────────────────────────────────────────────
// The competition/league MUST come from the authoritative fixture record.
// If any required field is missing or obviously wrong → reject, log, mark review.
export const validatePrediction = (m) => {
  const errors = [];
  if (!m.home_team && !m.homeTeam) errors.push('home_team');
  if (!m.away_team && !m.awayTeam) errors.push('away_team');
  if (!m.league) errors.push('competition');
  if (!m.fixture_id && !m.id) errors.push('match_id');
  const market = m.bet_type || m.prediction || m.prediction_en;
  if (!market) errors.push('market');
  if (oddsText(m) == null) errors.push('odds');
  if (confidencePct(m) == null) errors.push('confidence');
  if (errors.length) {
    return { ok: false, errors, reason: `Missing/invalid fields: ${errors.join(', ')}` };
  }
  return { ok: true, errors: [] };
};

// ── Normalise a stored prediction (snake_case → camelCase + defensive defaults) ──
export const normalizePick = (p) => ({
  ...p,
  homeTeam: p.homeTeam ?? p.home_team ?? '',
  awayTeam: p.awayTeam ?? p.away_team ?? '',
  league: p.league ?? '',
  league_id: p.league_id ?? p.leagueId ?? null,
  fixture_id: String(p.fixture_id ?? p.id ?? ''),
  kickoff_local: p.kickoff_local ?? p.time ?? '',
  market: p.bet_type ?? p.prediction ?? p.prediction_en ?? '',
  confidence: p.confidence ?? (p.probability != null ? Math.round(p.probability * 100) : null),
  probability: p.probability ?? (p.confidence != null ? p.confidence / 100 : null),
  odds: p.odds ?? p.pick_time_odds ?? null,
  status: p.status ?? 'pending',
  score: p.score ?? '',
  category: p.category ?? 'value',
  analysis_en: p.analysis_en ?? '',
  home_xg: p.expected_goals_home ?? p.home_xg ?? null,
  away_xg: p.expected_goals_away ?? p.away_xg ?? null,
});

// ── Load today's picks from quant_predictions (authoritative) ────────────────
const loadAuthoritativePicks = async (dateStr) => {
  const db = admin.firestore();
  const snap = await db.collection('quant_predictions').doc(dateStr).get();
  if (!snap.exists) return [];
  return (snap.data()?.predictions || []).map(normalizePick);
};

// ── 6. Track record persistence ───────────────────────────────────────────────

/** Persist every publicly published free pick for later result tracking. */
const recordPublishedPick = async (pick, dateStr) => {
  if (!pick.fixture_id) return;
  const db = admin.firestore();
  const docId = `${dateStr}_${pick.fixture_id}`;
  await db.collection('public_picks').doc(docId).set({
    date: dateStr,
    fixture_id: pick.fixture_id,
    match: `${pick.homeTeam} vs ${pick.awayTeam}`,
    home_team: pick.homeTeam,
    away_team: pick.awayTeam,
    competition: pick.league,
    league_id: pick.league_id ?? null,
    market: pick.market,
    selection: pick.market,
    odds: pick.odds ?? null,
    confidence: pick.confidence ?? null,
    kickoff_utc: pick.kickoff_utc ?? pick.kickoff_local ?? '',
    status: 'pending',
    published_at: admin.firestore.FieldValue.serverTimestamp(),
    result_at: null,
  }, { merge: true });
};

// ── A. FREE PICKS message ─────────────────────────────────────────────────────

/**
 * Build the main morning free-picks post.
 * 3 featured selections, compact lines, one optional reasoning line for the
 * strongest pick only. ~100-180 words. Analytics tone, no hype.
 */
export const formatFreePicksMessage = (picks, dateStr, analysedCount) => {
  const header = `🧠 VANTAGE DAILY PICKS\n${displayDateStr(dateStr)}\n\n`;
  const top = '🎯 TOP PICKS\n\n';

  const lines = [];
  picks.forEach((m, i) => {
    const conf = confidencePct(m);
    const odds = oddsText(m);
    const time = kickoffText(m);
    lines.push(`🟢 ${m.homeTeam} vs ${m.awayTeam}`);
    lines.push(`${m.market} · ${odds}${time ? ` · 🕐 ${time}` : ''}`);
    lines.push(`📈 ${conf} model confidence`);
    // ONE reasoning line, strongest pick only
    if (i === 0 && m.analysis_en) {
      const reason = String(m.analysis_en).split(/[|·\n]/).map(s => s.trim()).filter(s => s.length > 10)[0] || '';
      if (reason.length > 0) {
        lines.push(`💡 ${reason.length > 90 ? reason.substring(0, 90).replace(/\s+\S*$/, '') + '…' : reason}`);
      }
    }
    if (i < picks.length - 1) lines.push('');
  });

  const footer = `\n📊 ${analysedCount} matches analysed\n🎯 ${picks.length} selections released\n\n🔒 More picks + Smart Tickets in Vantage AI\n\nBet responsibly. Past performance does not guarantee future results.`;

  return `${header}${top}${lines.join('\n')}${footer}`;
};

// ── B. MEMBER/VIP message ─────────────────────────────────────────────────────

export const formatVipMessage = (analysedCount, extraCount) => {
  return `🔒 VANTAGE MEMBER PICKS\n\n📊 ${analysedCount} matches analysed\n🎯 Additional selections available\n\nMembers get:\n• Full model selections\n• Smart Tickets\n• Live stats\n• xG & match data\n\nYour free feed shows today's featured selections.\n\n🔓 Full analysis → Vantage AI\n\nBet responsibly.`;
};

// ── C. RESULTS message ────────────────────────────────────────────────────────

/**
 * Build the results post from ACTUAL recorded statuses only.
 * No cherry-picking: every published pick is eligible and shown.
 */
export const formatResultsMessage = (picks, dateStr) => {
  const header = `📊 VANTAGE RESULTS\n${displayDateStr(dateStr)}\n\n`;
  const settled = picks.filter(p => ['won', 'lost', 'void'].includes(p.status));
  const pending = picks.filter(p => p.status === 'pending');
  const won = settled.filter(p => p.status === 'won').length;
  const lost = settled.filter(p => p.status === 'lost').length;

  const lines = [];
  picks.forEach((m) => {
    const icon = m.status === 'won' ? '🟢' : m.status === 'lost' ? '🔴' : m.status === 'void' ? '⚪' : '🕐';
    const label = m.status === 'won' ? 'WON' : m.status === 'lost' ? 'LOST' : m.status === 'void' ? 'VOID' : 'PENDING';
    lines.push(`${icon} ${m.market} — ${label}`);
  });

  if (settled.length === 0) {
    lines.push('\nNo settled selections yet.');
  }

  const footer = settled.length
    ? `\nFREE PICKS\n${won} / ${settled.length} WON${lost ? ` · ${lost} LOST` : ''}${pending.length ? `\n${pending.length} pending` : ''}`
    : '';

  return `${header}${lines.join('\n')}${footer}\n\n📈 Model record built from published picks only.`;
};

// ── Orchestrators ─────────────────────────────────────────────────────────────

/** MESSAGE A — send the daily free picks (morning). */
export const sendDailyFreePicks = async () => {
  console.log('[Telegram] Sending daily free picks (A)...');
  try {
    const settings = await getTelegramSettings();
    if (!settings?.enabled || !settings?.token || !settings?.chatId) return { status: 'skipped', reason: 'incomplete_settings' };

    const dateStr = getLagosTodayKey();
    const all = (await loadAuthoritativePicks(dateStr)).filter(p => p.sport !== 'basketball');

    if (all.length === 0) return { status: 'skipped', reason: 'no_predictions' };

    // Filter for publishable picks: must pass strict validation + positive value
    const publishable = all.filter(p => {
      const v = validatePrediction(p);
      if (!v.ok) {
        console.warn(`[Telegram] BLOCKED pick ${p.homeTeam} vs ${p.awayTeam}: ${v.reason}`);
        return false;
      }
      if (p.category !== 'safe' && p.category !== 'value') return false;
      if (p.confidence == null || p.confidence < 55) return false;
      // Kickoff must be in the future
      const kt = kickoffText(p);
      if (/^\d{2}:\d{2}$/.test(kt)) {
        const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Lagos' });
        if (kt <= now) return false;
      }
      return true;
    });

    if (publishable.length === 0) return { status: 'skipped', reason: 'no_valid_picks' };

    const picks = [...publishable].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)).slice(0, 3);

    const text = formatFreePicksMessage(picks, dateStr, all.length);
    await sendMessage(settings.token, settings.chatId, text, 'HTML', {
      inline_keyboard: [[{ text: '📲 Download on Google Play', url: PLAYSTORE_URL }]],
    });

    // Persist every published pick for the track record
    for (const p of picks) await recordPublishedPick(p, dateStr);

    console.log(`[Telegram] ✅ Free picks sent (${picks.length} published, ${all.length} analysed).`);
    return { status: 'success', sent: picks.length, analysed: all.length };
  } catch (e) {
    console.error('[Telegram] Free picks error:', e.message);
    return { status: 'error', error: e.message };
  }
};

/** MESSAGE B — concise member/VIP value message. */
export const sendMemberPicksMessage = async () => {
  console.log('[Telegram] Sending member picks (B)...');
  try {
    const settings = await getTelegramSettings();
    if (!settings?.enabled || !settings?.token || !settings?.chatId) return { status: 'skipped', reason: 'incomplete_settings' };

    const dateStr = getLagosTodayKey();
    const all = (await loadAuthoritativePicks(dateStr)).filter(p => p.sport !== 'basketball');
    if (all.length === 0) return { status: 'skipped', reason: 'no_predictions' };

    const freeCount = all.filter(p => p.category === 'safe' || p.category === 'value').length;
    const extraCount = Math.max(0, all.length - freeCount);

    const text = formatVipMessage(all.length, extraCount);
    await sendMessage(settings.token, settings.chatId, text, 'HTML', {
      inline_keyboard: [[{ text: '🔓 See Full Model Feed', url: PLAYSTORE_URL }]],
    });

    console.log(`[Telegram] ✅ Member message sent (${all.length} analysed, ${extraCount} extra).`);
    return { status: 'success', analysed: all.length, extra: extraCount };
  } catch (e) {
    console.error('[Telegram] Member message error:', e.message);
    return { status: 'error', error: e.message };
  }
};

/** Update pending public picks with actual results from quant grading. */
export const updatePickResults = async (dateStr = null) => {
  try {
    const db = admin.firestore();
    const target = dateStr || getLagosTodayKey();

    const published = await db.collection('public_picks').where('date', '==', target).get();
    if (published.empty) return { status: 'skipped', reason: 'no_published_picks' };

    // Get authoritative graded statuses from quant_predictions
    const quantSnap = await db.collection('quant_predictions').doc(target).get();
    if (!quantSnap.exists) return { status: 'skipped', reason: 'no_graded_data' };
    const statusMap = {};
    for (const p of quantSnap.data()?.predictions || []) {
      const fid = String(p.fixture_id ?? p.id ?? '');
      if (fid) statusMap[fid] = { status: p.status ?? 'pending', score: p.score ?? '' };
    }

    const batch = db.batch();
    let updated = 0;
    published.forEach(doc => {
      const pick = doc.data();
      if (pick.status !== 'pending') return;
      const graded = statusMap[pick.fixture_id];
      if (graded && graded.status && graded.status !== 'pending') {
        batch.update(doc.ref, { status: graded.status, score: graded.score || '', result_at: admin.firestore.FieldValue.serverTimestamp() });
        updated++;
      }
    });
    if (updated > 0) await batch.commit();
    return { status: 'success', updated };
  } catch (e) {
    console.error('[Telegram] updatePickResults error:', e.message);
    return { status: 'error', error: e.message };
  }
};

/** MESSAGE C — send the daily results post from actual recorded outcomes. */
export const sendDailyResultsMessage = async () => {
  console.log('[Telegram] Sending daily results (C)...');
  try {
    const settings = await getTelegramSettings();
    if (!settings?.enabled || !settings?.token || !settings?.chatId) return { status: 'skipped', reason: 'incomplete_settings' };

    const dateStr = getLagosTodayKey();
    await updatePickResults(dateStr);

    const db = admin.firestore();
    const snap = await db.collection('public_picks').where('date', '==', dateStr).get();
    if (snap.empty) return { status: 'skipped', reason: 'no_published_picks' };

    const picks = snap.docs.map(d => d.data()).filter(p => p.status !== 'pending' || true);
    const text = formatResultsMessage(picks, dateStr);
    await sendMessage(settings.token, settings.chatId, text, 'HTML');

    console.log(`[Telegram] ✅ Results sent (${picks.length} picks).`);
    return { status: 'success', picks: picks.length };
  } catch (e) {
    console.error('[Telegram] Results message error:', e.message);
    return { status: 'error', error: e.message };
  }
};

// ── Legacy-compatible aliases (scheduler/admin references) ────────────────────

/** Replaces the old "Banker of the Day" with a single featured Top Selection. */
export const sendBankerOfTheDay = async () => {
  console.log('[Telegram] Sending Top Selection (was Banker)...');
  try {
    const settings = await getTelegramSettings();
    if (!settings?.enabled || !settings?.token || !settings?.chatId) return { status: 'skipped', reason: 'incomplete_settings' };

    const dateStr = getLagosTodayKey();
    const all = (await loadAuthoritativePicks(dateStr)).filter(p => p.sport !== 'basketball');
    const candidate = all
      .filter(p => (p.category === 'safe' || p.category === 'value') && (p.confidence ?? 0) >= 65 && validatePrediction(p).ok)
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
    if (!candidate) return { status: 'skipped', reason: 'no_top_pick' };

    const text = `🧠 VANTAGE TOP PICK\n${displayDateStr(dateStr)}\n\n⚽ ${candidate.homeTeam} vs ${candidate.awayTeam}\n🏆 ${candidate.league}\n\n🎯 ${candidate.market} · ${oddsText(candidate)}\n📈 ${confidencePct(candidate)} model confidence\n\nHighest-rated selection from ${all.length} matches analysed.\n\n🔒 Full model feed in Vantage AI\n\nBet responsibly.`;

    await sendMessage(settings.token, settings.chatId, text, 'HTML', {
      inline_keyboard: [[{ text: '📲 Get More Picks on the App', url: PLAYSTORE_URL }]],
    });
    console.log(`[Telegram] ✅ Top Pick sent: ${candidate.homeTeam} vs ${candidate.awayTeam}`);
    return { status: 'success', pick: `${candidate.homeTeam} vs ${candidate.awayTeam}` };
  } catch (e) {
    console.error('[Telegram] Top Pick error:', e.message);
    return { status: 'error', error: e.message };
  }
};

/** Replaces the old VIP teaser with the concise member message. */
export const sendVipTeaser = sendMemberPicksMessage;

/** Keeps the old broadcast entrypoint working (delegates to free picks). */
export const sendDailyPredictionsToTelegram = sendDailyFreePicks;

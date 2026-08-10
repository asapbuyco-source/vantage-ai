/**
 * backend/telegramService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Sends today's AI-generated football predictions to a Telegram group/channel.
 *
 * Configuration (stored in Firestore settings/app):
 *   telegramBotToken  : Bot API token from @BotFather
 *   telegramChannelId : Group/Channel ID (e.g. -1001234567890 or @channelname)
 *   telegramEnabled   : boolean master switch
 *   telegramSendTime  : HH:MM time the scheduler triggers this (e.g. "08:30")
 *
 * The message is sent using the Telegram Bot API via plain `fetch` —
 * no additional npm dependency required.
 */

import admin from 'firebase-admin';
import { getLagosTodayKey } from './dateUtils.js';

const TELEGRAM_API  = 'https://api.telegram.org/bot';
const PLAYSTORE_URL = 'https://play.google.com/store/apps/details?id=com.vantageai.app';

// ── Settings ──────────────────────────────────────────────────────────────────

/** Reads Telegram settings from Firestore settings/internal (secrets) and settings/app (config) */
const getTelegramSettings = async () => {
    const db = admin.firestore();
    const [internalSnap, appSnap] = await Promise.all([
        db.collection('settings').doc('internal').get(),
        db.collection('settings').doc('app').get(),
    ]);
    const internal = internalSnap.data() || {};
    const app      = appSnap.data()      || {};
    return {
        token:   internal?.telegramBotToken  || '',
        chatId:  internal?.telegramChannelId || '',
        enabled: app?.telegramEnabled === true,
    };
};

// ── API Wrapper ────────────────────────────────────────────────────────────────

/**
 * Calls the Telegram sendMessage API with a 30-second timeout.
 * Supports an optional `replyMarkup` object for inline keyboards.
 */
const sendMessage = async (token, chatId, text, parseMode = 'HTML', replyMarkup = null) => {
    const url        = `${TELEGRAM_API}${token}/sendMessage`;
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 30000);
    try {
        const body = {
            chat_id:                  chatId,
            text,
            parse_mode:               parseMode,
            disable_web_page_preview: true,
        };
        if (replyMarkup) body.reply_markup = JSON.stringify(replyMarkup);

        const response = await fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
            signal:  controller.signal,
        });
        clearTimeout(timeout);
        const result = await response.json();
        if (!result.ok) {
            throw new Error(`Telegram API error: ${result.description || JSON.stringify(result)}`);
        }
        return result;
    } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
            throw new Error('Telegram API request timed out after 30 seconds');
        }
        throw err;
    }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Category → colored dot */
const categoryDot = (category) => {
    if (category === 'safe')  return '🟢';
    if (category === 'value') return '🟡';
    if (category === 'risky') return '🔴';
    return '⚪';
};

/** Confidence level → badge label */
const confidenceBadge = (confidence) => {
    if (confidence >= 70) return '🔥 HIGH CONFIDENCE';
    if (confidence >= 60) return '✅ GOOD VALUE';
    return '⚡ WORTH WATCHING';
};

/**
 * Extract a short punchy one-liner from the full analysis text.
 * Grabs the first meaningful segment (before a separator) and caps at 80 chars.
 */
const shortReason = (analysisText) => {
    if (!analysisText) return null;
    const parts = analysisText.split(/[|·,]/).map(s => s.trim()).filter(s => s.length > 10);
    if (parts.length === 0) return null;
    let reason = parts[0];
    if (reason.length > 80) {
        reason = reason.substring(0, 80).replace(/\s+\S*$/, '') + '…';
    }
    return reason;
};

// ── Message Formatter ─────────────────────────────────────────────────────────

/**
 * Builds the Telegram HTML message and the inline keyboard markup.
 * Returns { text, replyMarkup } or null if no picks found.
 */
const buildPredictionsMessage = (matches, dateStr) => {
    const displayDate = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long',
    });

    // Best picks by confidence, max 3 shown
    const picks = [...matches]
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
        .slice(0, 3);

    if (picks.length === 0) return null;

    const DIVIDER  = '━━━━━━━━━━━━━━━━━━━━━━━━';
    const DIVIDER2 = '─────────────────────────';

    let msg = `${DIVIDER}\n`;
    msg    += `🧠 <b>VANTAGE AI · Free Daily Picks</b>\n`;
    msg    += `📅 <i>${displayDate}</i>\n`;
    msg    += `${DIVIDER}\n\n`;

    picks.forEach((m, i) => {
        const dot    = categoryDot(m.category);
        const badge  = confidenceBadge(m.confidence ?? 0);
        const conf   = m.confidence ? `${m.confidence}%` : '—';
        const odds   = m.odds       ? `${Number(m.odds).toFixed(2)}` : '—';
        const pred   = m.prediction_en || m.prediction || 'N/A';
        const time   = m.kickoff_local  || m.time       || '';
        const reason = shortReason(m.analysis_en);

        msg += `${dot} <b>PICK ${i + 1}</b> — <b>${badge}</b>\n\n`;
        msg += `🏟 <b>${m.homeTeam} vs ${m.awayTeam}</b>\n`;
        msg += `🏆 ${m.league}`;
        if (time) msg += ` · 🕐 ${time}`;
        msg += '\n\n';
        msg += `📌 <b>${pred}</b>\n`;
        msg += `💰 Odds: <code>${odds}</code>  ·  📈 Confidence: <code>${conf}</code>\n`;
        if (reason) msg += `\n💡 <i>${reason}</i>\n`;

        if (i < picks.length - 1) msg += `\n${DIVIDER2}\n\n`;
    });

    msg += `\n${DIVIDER}\n`;
    msg += `🔒 <b>10+ more picks, Smart Ticket & full stats in the app</b>\n`;
    msg += `${DIVIDER}\n`;
    msg += `\n💡 <i>Bet responsibly. Past performance ≠ future results.</i>`;

    // Inline keyboard — a real tappable button pointing to the Play Store
    const replyMarkup = {
        inline_keyboard: [
            [
                {
                    text: '📲 Download on Google Play',
                    url:  PLAYSTORE_URL,
                },
            ],
        ],
    };

    return { text: msg, replyMarkup };
};

// ── Main Export ───────────────────────────────────────────────────────────────

/**
 * Reads today's football predictions from Firestore and sends them
 * to the configured Telegram group/channel.
 *
 * Returns: { status, sent, error? }
 */
export const sendDailyPredictionsToTelegram = async () => {
    console.log('[Telegram] Starting daily predictions broadcast...');
    try {
        // 1. Load settings
        const settings = await getTelegramSettings();
        if (!settings) {
            console.warn('[Telegram] No settings found in Firestore. Skipping.');
            return { status: 'skipped', reason: 'no_settings' };
        }
        if (!settings.enabled) {
            console.info('[Telegram] Telegram is disabled in settings. Skipping.');
            return { status: 'skipped', reason: 'disabled' };
        }
        if (!settings.token) {
            console.warn('[Telegram] Bot token is empty. Skipping.');
            return { status: 'skipped', reason: 'no_token' };
        }
        if (!settings.chatId) {
            console.warn('[Telegram] Channel ID is empty. Skipping.');
            return { status: 'skipped', reason: 'no_chat_id' };
        }

        // 2. Load today's predictions from BOTH collections:
        //    - quant_predictions  : primary (Python quant_pipeline.py writes here)
        //    - daily_predictions  : legacy / AI-generated picks
        const todayStr = getLagosTodayKey();
        const db       = admin.firestore();

        let allMatches = [];

        // 2a. Read quant_predictions (primary — Python pipeline writes here)
        const quantSnap = await db.collection('quant_predictions').doc(todayStr).get();
        if (quantSnap.exists) {
            const rawPreds = quantSnap.data()?.predictions || [];
            // Normalize snake_case → camelCase so filter logic works uniformly
            const normalized = rawPreds.map(p => ({
                ...p,
                homeTeam:      p.homeTeam      ?? p.home_team  ?? '',
                awayTeam:      p.awayTeam      ?? p.away_team  ?? '',
                league:        p.league        ?? '',
                prediction_en: p.prediction_en ?? p.prediction ?? p.bet_type ?? '',
                confidence:    p.confidence    ?? (p.probability ? Math.round(p.probability * 100) : 0),
                category:      p.category      ?? 'value',
                odds:          p.odds          ?? null,
                analysis_en:   p.analysis_en   ?? (p.ev_pct != null ? `EV: +${p.ev_pct}% | Quant Engine` : null),
                kickoff_local: p.kickoff_local  ?? p.time ?? '',
            }));
            allMatches = normalized;
        }

        // 2b. Merge daily_predictions (legacy AI picks that may also exist)
        const legacySnap = await db.collection('daily_predictions').doc(todayStr).get();
        if (legacySnap.exists) {
            const legacyMatches  = legacySnap.data()?.matches || [];
            const quantFixtureIds = new Set(allMatches.map(m => String(m.fixture_id ?? m.id ?? '')));
            const uniqueLegacy   = legacyMatches.filter(m => {
                const fid = String(m.fixture_id ?? m.id ?? '');
                return fid && !quantFixtureIds.has(fid);
            });
            allMatches = [...allMatches, ...uniqueLegacy];
        }

        if (allMatches.length === 0) {
            console.warn('[Telegram] No predictions found for today in either collection. Skipping.');
            return { status: 'skipped', reason: 'no_predictions' };
        }

        // --- PROTECT VIP VALUE ---
        const strictPicks = allMatches.filter(m => m.category === 'safe' || m.category === 'value');

        if (strictPicks.length === 0) {
            console.warn('[Telegram] No strict (safe/value) predictions found today. Skipping.');
            return { status: 'skipped', reason: 'no_strict_predictions' };
        }

        if (strictPicks.length <= 3) {
            console.info(`[Telegram] Only ${strictPicks.length} strict predictions today. Skipping free broadcast to protect VIP value.`);
            return { status: 'skipped', reason: 'too_few_strict_predictions_protect_vip' };
        }

        // Filter out past matches
        const nowLagos = (() => {
            const now        = new Date();
            const lagosOffset = 60; // Africa/Lagos is always UTC+1
            const lagosMs    = now.getTime() + (lagosOffset - now.getTimezoneOffset()) * 60000;
            const d          = new Date(lagosMs);
            return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
        })();

        const ready = strictPicks.filter(m => {
            if (!(m.prediction_en || m.prediction || m.bet_type)) return false;
            if (m.confidence < 55) return false;
            if (m.sport === 'basketball') return false;

            const kickoffTime = m.kickoff_local || m.time || '';
            if (kickoffTime && /^\d{2}:\d{2}$/.test(kickoffTime)) {
                if (kickoffTime <= nowLagos) {
                    console.log(`[Telegram] ⏩ Skipping past match: ${m.homeTeam} vs ${m.awayTeam} (kickoff ${kickoffTime}, now ${nowLagos})`);
                    return false;
                }
            }
            return true;
        });

        if (ready.length === 0) {
            console.warn('[Telegram] No ready free predictions for today. Skipping.');
            return { status: 'skipped', reason: 'no_ready_predictions' };
        }

        // 3. Build and send message
        const built = buildPredictionsMessage(ready, todayStr);
        if (!built) {
            return { status: 'skipped', reason: 'empty_message' };
        }

        await sendMessage(settings.token, settings.chatId, built.text, 'HTML', built.replyMarkup);
        console.log(`[Telegram] ✅ Free predictions sent to ${settings.chatId} — ${ready.length} picks available, up to 3 shown.`);

        // 4. Record last send time in Firestore (for admin visibility)
        await db.collection('settings').doc('app').set({
            telegramLastSentAt:    new Date().toISOString(),
            telegramLastSentCount: Math.min(ready.length, 3),
        }, { merge: true });

        return { status: 'success', sent: Math.min(ready.length, 3), total: ready.length };

    } catch (e) {
        console.error('[Telegram] Error sending predictions:', e.message);
        return { status: 'error', error: e.message };
    }
};

/**
 * Processes all pending Telegram alerts queued in Firestore by the Python pipeline.
 * Reads from the `pending_telegram_alerts` collection, sends each alert,
 * and deletes the processed documents.
 */
export const processPendingTelegramAlerts = async () => {
    console.log('[Telegram] Processing pending alerts...');
    try {
        const settings = await getTelegramSettings();
        if (!settings?.enabled || !settings?.token || !settings?.chatId) {
            console.warn('[Telegram] Settings incomplete. Skipping pending alerts.');
            return { status: 'skipped', reason: 'incomplete_settings' };
        }

        const db       = admin.firestore();
        const snapshot = await db.collection('pending_telegram_alerts')
            .where('processed', '==', false)
            .limit(10)
            .get();

        if (snapshot.empty) {
            console.log('[Telegram] No pending alerts.');
            return { status: 'skipped', reason: 'no_pending_alerts' };
        }

        let sent   = 0;
        let failed = 0;
        const batch = db.batch();

        for (const doc of snapshot.docs) {
            const alert = doc.data();
            try {
                await sendMessage(settings.token, settings.chatId, alert.message);
                batch.update(doc.ref, { processed: true, sent_at: new Date().toISOString() });
                sent++;
            } catch (err) {
                console.error(`[Telegram] Failed to send alert ${doc.id}:`, err.message);
                batch.update(doc.ref, { processed: true, error: err.message, sent_at: new Date().toISOString() });
                failed++;
            }
        }

        await batch.commit();
        console.log(`[Telegram] Processed ${sent + failed} pending alerts (${sent} sent, ${failed} failed).`);
        return { status: 'success', sent, failed };
    } catch (e) {
        console.error('[Telegram] Error processing pending alerts:', e.message);
        return { status: 'error', error: e.message };
    }
};

/**
 * Sends a custom test message to verify the bot configuration.
 * Called by the admin "Test Telegram" button via server.js.
 */
export const sendTelegramTestMessage = async () => {
    try {
        const settings = await getTelegramSettings();
        if (!settings?.token || !settings?.chatId) {
            return { status: 'error', error: 'Bot token or channel ID is not configured.' };
        }
        await sendMessage(
            settings.token,
            settings.chatId,
            `🤖 <b>Vantage AI Bot — Connection Test</b>\n\n✅ Your Telegram bot is correctly configured and working!\n\n<i>Sent at ${new Date().toISOString()}</i>`,
            'HTML',
            {
                inline_keyboard: [[
                    { text: '📲 Download on Google Play', url: PLAYSTORE_URL },
                ]],
            }
        );
        return { status: 'success', message: 'Test message sent successfully.' };
    } catch (e) {
        return { status: 'error', error: e.message };
    }
};

// ── Helper: load & normalize today's predictions ──────────────────────────────

const loadTodayPredictions = async () => {
    const db       = admin.firestore();
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
    let allMatches = [];

    const quantSnap = await db.collection('quant_predictions').doc(todayStr).get();
    if (quantSnap.exists) {
        const rawPreds = quantSnap.data()?.predictions || [];
        allMatches = rawPreds.map(p => ({
            ...p,
            homeTeam:      p.homeTeam      ?? p.home_team  ?? '',
            awayTeam:      p.awayTeam      ?? p.away_team  ?? '',
            league:        p.league        ?? '',
            prediction_en: p.prediction_en ?? p.prediction ?? p.bet_type ?? '',
            confidence:    p.confidence    ?? (p.probability ? Math.round(p.probability * 100) : 0),
            category:      p.category      ?? 'value',
            odds:          p.odds          ?? null,
            analysis_en:   p.analysis_en   ?? null,
            kickoff_local: p.kickoff_local  ?? p.time ?? '',
        }));
    }

    // Merge legacy picks deduped by fixture id
    const legacySnap = await db.collection('daily_predictions').doc(todayStr).get();
    if (legacySnap.exists) {
        const legacyMatches  = legacySnap.data()?.matches || [];
        const quantIds       = new Set(allMatches.map(m => String(m.fixture_id ?? m.id ?? '')));
        const uniqueLegacy   = legacyMatches.filter(m => {
            const fid = String(m.fixture_id ?? m.id ?? '');
            return fid && !quantIds.has(fid);
        });
        allMatches = [...allMatches, ...uniqueLegacy];
    }

    return { allMatches, todayStr };
};

// ── Banker of the Day ─────────────────────────────────────────────────────────

/**
 * Picks the single highest-confidence safe pick of the day and sends it as
 * a standalone "Banker" message. Sent at 08:15 Lagos time — just before the
 * main daily broadcast so it builds anticipation.
 */
export const sendBankerOfTheDay = async () => {
    console.log('[Telegram] Sending Banker of the Day...');
    try {
        const settings = await getTelegramSettings();
        if (!settings?.enabled || !settings?.token || !settings?.chatId) {
            return { status: 'skipped', reason: 'incomplete_settings' };
        }

        const { allMatches, todayStr } = await loadTodayPredictions();
        if (allMatches.length === 0) {
            return { status: 'skipped', reason: 'no_predictions' };
        }

        // Banker = highest confidence safe pick with minimum confidence threshold
        const banker = allMatches
            .filter(m => (m.category === 'safe' || m.category === 'value') && (m.confidence ?? 0) >= 65 && m.sport !== 'basketball')
            .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];

        if (!banker) {
            return { status: 'skipped', reason: 'no_banker_found' };
        }

        const displayDate = new Date(todayStr + 'T12:00:00').toLocaleDateString('en-GB', {
            weekday: 'long', day: 'numeric', month: 'long',
        });

        const pred   = banker.prediction_en || banker.prediction || 'N/A';
        const conf   = banker.confidence ? `${banker.confidence}%` : '—';
        const odds   = banker.odds ? `${Number(banker.odds).toFixed(2)}` : '—';
        const time   = banker.kickoff_local || banker.time || '';
        const reason = shortReason(banker.analysis_en);
        const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━━';

        let msg = `${DIVIDER}\n`;
        msg    += `⭐ <b>BANKER OF THE DAY</b>\n`;
        msg    += `📅 <i>${displayDate}</i>\n`;
        msg    += `${DIVIDER}\n\n`;
        msg    += `🏟 <b>${banker.homeTeam} vs ${banker.awayTeam}</b>\n`;
        msg    += `🏆 ${banker.league}`;
        if (time) msg += ` · 🕐 ${time}`;
        msg    += '\n\n';
        msg    += `📌 <b>${pred}</b>\n`;
        msg    += `💰 Odds: <code>${odds}</code>  ·  📈 Confidence: <code>${conf}</code>\n`;
        if (reason) msg += `\n💡 <i>${reason}</i>\n`;
        msg    += `\n${DIVIDER}\n`;
        msg    += `🔥 <b>Our top pick for today — don't miss it!</b>\n`;
        msg    += `${DIVIDER}\n`;
        msg    += `\n💡 <i>Bet responsibly. Past performance ≠ future results.</i>`;

        const replyMarkup = {
            inline_keyboard: [[
                { text: '📲 Get More Picks on the App', url: PLAYSTORE_URL },
            ]],
        };

        await sendMessage(settings.token, settings.chatId, msg, 'HTML', replyMarkup);
        console.log(`[Telegram] ✅ Banker of the Day sent: ${banker.homeTeam} vs ${banker.awayTeam}`);
        return { status: 'success', banker: `${banker.homeTeam} vs ${banker.awayTeam}` };

    } catch (e) {
        console.error('[Telegram] Error sending Banker of the Day:', e.message);
        return { status: 'error', error: e.message };
    }
};

// ── VIP Teaser ────────────────────────────────────────────────────────────────

/**
 * Sends a teaser message after the daily broadcast showing how many VIP-only
 * picks are hidden, creating urgency without giving away the data.
 * Sent at 09:30 Lagos time — 30 min after the free picks broadcast.
 */
export const sendVipTeaser = async () => {
    console.log('[Telegram] Sending VIP Teaser...');
    try {
        const settings = await getTelegramSettings();
        if (!settings?.enabled || !settings?.token || !settings?.chatId) {
            return { status: 'skipped', reason: 'incomplete_settings' };
        }

        const { allMatches } = await loadTodayPredictions();
        if (allMatches.length === 0) {
            return { status: 'skipped', reason: 'no_predictions' };
        }

        // Count hidden VIP picks (risky / lean / low confidence that aren't free)
        const freeCount = allMatches.filter(m =>
            (m.category === 'safe' || m.category === 'value') && (m.confidence ?? 0) >= 55 && m.sport !== 'basketball'
        ).length;

        const vipCount = Math.max(0, allMatches.filter(m => m.sport !== 'basketball').length - Math.min(freeCount, 3));

        if (vipCount < 3) {
            return { status: 'skipped', reason: 'not_enough_vip_picks' };
        }

        // Pick 2-3 intriguing matches as teasers (show team names only, no pick details)
        const teasers = allMatches
            .filter(m => m.sport !== 'basketball' && (m.confidence ?? 0) >= 60)
            .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
            .slice(3, 6); // skip the first 3 which are already shown free

        const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━━';

        let msg = `${DIVIDER}\n`;
        msg    += `🔒 <b>HIDDEN VIP PICKS TODAY</b>\n`;
        msg    += `${DIVIDER}\n\n`;
        msg    += `Our model has analysed <b>${allMatches.filter(m => m.sport !== 'basketball').length} matches</b> today.\n`;
        msg    += `You saw 3 free picks. Here's what's locked behind VIP:\n\n`;

        if (teasers.length > 0) {
            teasers.forEach(m => {
                const conf = m.confidence ? `${m.confidence}%` : '—';
                msg += `🔒 <b>${m.homeTeam} vs ${m.awayTeam}</b> — <i>${m.league}</i>\n`;
                msg += `   📈 Confidence: <code>${conf}</code>  |  Pick: <b>🔒 Locked</b>\n\n`;
            });
        }

        msg += `${DIVIDER}\n`;
        msg += `✅ VIP members get:\n`;
        msg += `• All <b>${vipCount}+ hidden picks</b> with full analysis\n`;
        msg += `• Smart Ticket builder (auto-generated combos)\n`;
        msg += `• Live stats & Expected Goals (xG) per match\n`;
        msg += `• Head-to-head history & lineup data\n`;
        msg += `${DIVIDER}\n`;
        msg += `\n💡 <i>Bet responsibly. Past performance ≠ future results.</i>`;

        const replyMarkup = {
            inline_keyboard: [[
                { text: '🔓 Unlock VIP on the App', url: PLAYSTORE_URL },
            ]],
        };

        await sendMessage(settings.token, settings.chatId, msg, 'HTML', replyMarkup);
        console.log(`[Telegram] ✅ VIP Teaser sent — ${vipCount} hidden picks teased.`);
        return { status: 'success', vipCount };

    } catch (e) {
        console.error('[Telegram] Error sending VIP Teaser:', e.message);
        return { status: 'error', error: e.message };
    }
};

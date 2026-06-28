import cron from 'node-cron';
import admin from 'firebase-admin';
import pino from 'pino';
import {
    runBasketballPipeline,
    runCricketPipeline,
    runQuantGrading,
    runQuantPerformance,
    runQuantPipeline,
    runLineupSyncer,
    runArbScanner
} from './quantService.js';

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
});

const tasks = new Map();

// ── Distributed Lock (prevents double-execution when horizontally scaled) ───

async function acquireLock(taskName, ttlMinutes = 60) {
    if (!admin.apps.length) return true; // no Firestore, skip locking
    const db = admin.firestore();
    const lockRef = db.collection('generation_locks').doc(taskName);
    try {
        const result = await db.runTransaction(async (tx) => {
            const doc = await tx.get(lockRef);
            const now = new Date();
            if (doc.exists) {
                const expiresAt = doc.data().expiresAt?.toDate();
                if (expiresAt && expiresAt > now) return false;
            }
            tx.set(lockRef, {
                task: taskName,
                acquiredAt: admin.firestore.FieldValue.serverTimestamp(),
                expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
            }, { merge: true });
            return true;
        });
        return result;
    } catch (err) {
        logger.error({ task: taskName, err: err.message }, '[Scheduler] Lock acquisition failed — skipping job to avoid duplicate execution');
        return false; // fail-closed: skip rather than risk double-run
    }
}

async function releaseLock(taskName) {
    if (!admin.apps.length) return;
    try {
        await admin.firestore().collection('generation_locks').doc(taskName)
            .update({ expiresAt: admin.firestore.FieldValue.delete() });
    } catch (_) {
        // best-effort cleanup
    }
}

function withLock(taskName, ttlMinutes, fn) {
    return async () => {
        const locked = await acquireLock(taskName, ttlMinutes);
        if (!locked) {
            logger.info(`[Scheduler] ${taskName}: lock held by another instance, skipping`);
            return;
        }
        try {
            await fn();
        } finally {
            await releaseLock(taskName);
        }
    };
}

// ── Trigger Functions ─────────────────────────────────────────────────────────────────────

function assertSuccess(result, label) {
    if (result?.status === 'error') {
        throw new Error(result.error || `${label} failed`);
    }
    return result;
}

export const triggerFootballGeneration = async (dateStr = null, dryRun = false) => {
    logger.info('[Scheduler] Triggering football generation...');
    try {
        const result = await runQuantPipeline(dateStr, dryRun);
        logger.info('[Scheduler] Football generation complete.');
        return assertSuccess(result, 'Football generation');
    } catch (e) {
        logger.error({ error: e }, '[Scheduler] Football generation error');
        return { status: 'error', error: e.message };
    }
};

export const triggerBasketballGeneration = async (dateStr = null, dryRun = false) => {
    logger.info('[Scheduler] Triggering basketball generation...');
    try {
        const result = await runBasketballPipeline(dateStr, dryRun);
        logger.info('[Scheduler] Basketball generation complete.');
        return assertSuccess(result, 'Basketball generation');
    } catch (e) {
        logger.error({ error: e }, '[Scheduler] Basketball generation error');
        return { status: 'error', error: e.message };
    }
};

export const triggerCricketGeneration = async (dateStr = null, dryRun = false) => {
    logger.info('[Scheduler] Triggering cricket generation...');
    try {
        const result = await runCricketPipeline(dateStr, dryRun);
        logger.info('[Scheduler] Cricket generation complete.');
        return assertSuccess(result, 'Cricket generation');
    } catch (e) {
        logger.error({ error: e }, '[Scheduler] Cricket generation error');
        return { status: 'error', error: e.message };
    }
};

export const triggerGrading = async (dateStr = null) => {
    logger.info('[Scheduler] Triggering match grading...');
    try {
        const result = await runQuantGrading(dateStr);
        logger.info('[Scheduler] Grading complete.');
        return assertSuccess(result, 'Grading');
    } catch (e) {
        logger.error({ error: e }, '[Scheduler] Grading error');
        return { status: 'error', error: e.message };
    }
};

export const triggerBlogGen = async () => {
    logger.info('[Scheduler] Triggering blog generation...');
    try {
        const { triggerBlogGeneration } = await import('./blogGenerator.js');
        const result = await triggerBlogGeneration();
        logger.info('[Scheduler] Blog generation complete.');
        return result || { status: 'success' };
    } catch (e) {
        logger.error({ error: e }, '[Scheduler] Blog generation error');
        return { status: 'error', error: e.message };
    }
};

export const triggerAccumulatorGeneration = async () => {
    logger.info('[Scheduler] Triggering accumulator generation (via quant pipeline)...');
    try {
        const result = await runQuantPipeline();
        logger.info('[Scheduler] Accumulator generation complete.');
        return assertSuccess(result, 'Accumulator generation');
    } catch (e) {
        logger.error({ error: e }, '[Scheduler] Accumulator generation error');
        return { status: 'error', error: e.message };
    }
};

export const triggerTelegramBroadcast = async () => {
    logger.info('[Scheduler] Triggering Telegram broadcast...');
    try {
        const { sendDailyPredictionsToTelegram } = await import('./telegramService.js');
        const result = await sendDailyPredictionsToTelegram();
        logger.info('[Scheduler] Telegram broadcast complete.');
        return result || { status: 'success' };
    } catch (e) {
        logger.error({ error: e }, '[Scheduler] Telegram broadcast error');
        return { status: 'error', error: e.message };
    }
};

export const triggerQuantPipeline = async (dateStr = null, dryRun = false) => {
    logger.info('[Scheduler] Triggering quant pipeline...');
    try {
        const result = await runQuantPipeline(dateStr, dryRun);
        logger.info('[Scheduler] Quant pipeline complete.');
        return assertSuccess(result, 'Quant pipeline');
    } catch (e) {
        logger.error({ error: e }, '[Scheduler] Quant pipeline error');
        return { status: 'error', error: e.message };
    }
};

export const triggerQuantGrading = async (dateStr = null) => {
    logger.info('[Scheduler] Triggering quant grading...');
    try {
        const result = await runQuantGrading(dateStr);
        logger.info('[Scheduler] Quant grading complete.');
        return assertSuccess(result, 'Quant grading');
    } catch (e) {
        logger.error({ error: e }, '[Scheduler] Quant grading error');
        return { status: 'error', error: e.message };
    }
};

export const triggerQuantPerformance = async () => {
    logger.info('[Scheduler] Triggering quant performance tracking...');
    try {
        const result = await runQuantPerformance();
        logger.info('[Scheduler] Quant performance tracking complete.');
        return assertSuccess(result, 'Quant performance');
    } catch (e) {
        logger.error({ error: e }, '[Scheduler] Quant performance tracking error');
        return { status: 'error', error: e.message };
    }
};

// ── Scheduler Initialization ─────────────────────────────────────────────────────────────────────

export const initScheduler = () => {
    logger.info('[Scheduler] Initializing cron jobs...');

    // Daily football predictions at 07:00 Lagos time
    const footballTask = cron.schedule('0 7 * * *',
        withLock('football_generation', 60, async () => {
            logger.info('[Scheduler] Running daily football prediction job...');
            await triggerFootballGeneration();
        }),
        { timezone: 'Africa/Lagos' }
    );
    tasks.set('football', footballTask);
    logger.info('⚽ Football prediction scheduled at 07:00 Lagos');

    // Daily basketball predictions at 07:30 Lagos time
    const basketballTask = cron.schedule('30 7 * * *',
        withLock('basketball_generation', 30, async () => {
            logger.info('[Scheduler] Running daily basketball prediction job...');
            await triggerBasketballGeneration();
        }),
        { timezone: 'Africa/Lagos' }
    );
    tasks.set('basketball', basketballTask);
    logger.info('🏀 Basketball prediction scheduled at 07:30 Lagos');

    // Daily cricket predictions at 08:00 Lagos time
    const cricketTask = cron.schedule('0 8 * * *',
        withLock('cricket_generation', 30, async () => {
            logger.info('[Scheduler] Running daily cricket prediction job...');
            await triggerCricketGeneration();
        }),
        { timezone: 'Africa/Lagos' }
    );
    tasks.set('cricket', cricketTask);
    logger.info('🏏 Cricket prediction scheduled at 08:00 Lagos');

    // Quant pipeline at 07:45 Lagos time
    const quantTask = cron.schedule('45 7 * * *',
        withLock('quant_pipeline', 60, async () => {
            logger.info('[Scheduler] Running quant pipeline...');
            await triggerQuantPipeline();
        }),
        { timezone: 'Africa/Lagos' }
    );
    tasks.set('quant', quantTask);
    logger.info('📊 Quant pipeline scheduled at 07:45 Lagos');

    // Quant grading at 22:00 Lagos time
    const quantGradingTask = cron.schedule('0 22 * * *',
        withLock('quant_grading', 30, async () => {
            logger.info('[Scheduler] Running quant grading...');
            await triggerQuantGrading();
        }),
        { timezone: 'Africa/Lagos' }
    );
    tasks.set('quantGrading', quantGradingTask);
    logger.info('📊 Quant grading scheduled at 22:00 Lagos');

    // Blog generation at 08:30 Lagos time
    const blogTask = cron.schedule('30 8 * * *',
        withLock('blog_generation', 30, async () => {
            logger.info('[Scheduler] Running blog generation...');
            await triggerBlogGen();
        }),
        { timezone: 'Africa/Lagos' }
    );
    tasks.set('blog', blogTask);
    logger.info('📝 Blog generation scheduled at 08:30 Lagos');

    // Telegram broadcast at 09:00 Lagos time
    const telegramTask = cron.schedule('0 9 * * *',
        withLock('telegram_broadcast', 15, async () => {
            logger.info('[Scheduler] Running Telegram broadcast...');
            await triggerTelegramBroadcast();
        }),
        { timezone: 'Africa/Lagos' }
    );
    tasks.set('telegram', telegramTask);
    logger.info('📱 Telegram broadcast scheduled at 09:00 Lagos');

    // NOTE: Live momentum engine and player stats client have been disabled.
    // They consumed ~15,000+ API-Football credits/day running every 2-5 minutes,
    // leaving no quota for grading. Predictions and grading are the priority.

    // Tomorrow's fixtures at 21:00 Lagos time
    const tomorrowTask = cron.schedule('0 21 * * *',
        withLock('tomorrow_fixtures', 60, async () => {
            logger.info('[Scheduler] Running tomorrow fixtures job...');
            await triggerFootballGeneration();
        }),
        { timezone: 'Africa/Lagos' }
    );
    tasks.set('tomorrow', tomorrowTask);
    logger.info('📅 Tomorrow fixtures scheduled at 21:00 Lagos');

    // Lineup sync at 11:00 Lagos time (after team sheets are typically published)
    const lineupTask = cron.schedule('0 11 * * *',
        withLock('lineup_sync', 15, async () => {
            logger.info('[Scheduler] Running lineup sync...');
            try {
                await runLineupSyncer();
            } catch (e) {
                logger.error({ error: e }, '[Scheduler] Lineup sync error');
            }
        }),
        { timezone: 'Africa/Lagos' }
    );
    tasks.set('lineupSync', lineupTask);
    logger.info('📋 Lineup sync scheduled at 11:00 Lagos');

    // Arb Scanner every 15 minutes (short TTL since it runs frequently)
    const arbScannerTask = cron.schedule('*/15 * * * *',
        withLock('arb_scanner', 14, async () => {
            logger.info('[Scheduler] Running 15-minute Arb Scanner...');
            try {
                await runArbScanner();
                logger.info('[Scheduler] Arb Scanner complete.');
            } catch (e) {
                logger.error({ error: e }, '[Scheduler] Arb Scanner error');
            }
        })
    );
    tasks.set('arbScanner', arbScannerTask);
    logger.info('🔍 Arb Scanner scheduled every 15 minutes');

    // Repair corrupted predictions at 23:30 Lagos time
    const repairTask = cron.schedule('30 23 * * *',
        withLock('prediction_repair', 10, async () => {
            logger.info('[Scheduler] Running prediction repair...');
            try {
                if (admin.apps.length > 0) {
                    const db = admin.firestore();
                    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
                    await repairCorruptedPredictions(db, todayStr);
                }
            } catch (e) {
                logger.error({ error: e }, '[Scheduler] Prediction repair error');
            }
        }),
        { timezone: 'Africa/Lagos' }
    );
    tasks.set('repair', repairTask);
    logger.info('🔧 Prediction repair scheduled at 23:30 Lagos');

    logger.info('✅ Scheduler initialized. All cron jobs scheduled.');
};

// ── Stop Scheduler ─────────────────────────────────────────────────────────────────────

export const stopScheduler = () => {
    const count = tasks.size;
    for (const [name, task] of tasks) {
        task.stop();
        logger.info(`[Scheduler] Stopped task: ${name}`);
    }
    tasks.clear();
    logger.info(`[Scheduler] All ${count} cron tasks stopped.`);
};

// ── Repair Corrupted Predictions ─────────────────────────────────────────────────────────────────────

export async function repairCorruptedPredictions(db, dateStr) {
    const docRef = db.collection('quant_predictions').doc(dateStr);
    const doc = await docRef.get();
    if (!doc.exists) {
        logger.info(`[Repair] No predictions found for ${dateStr}`);
        return 0;
    }

    const data = doc.data();
    const preds = data.predictions || [];
    let fixed = 0;
    const now = new Date();

    for (const pred of preds) {
        if (pred.graded_by === 'live_auto') {
            const kickoff = new Date(pred.kickoff_utc);
            if (kickoff > now) {
                pred.status = 'pending';
                pred.score = null;
                pred.live_state = null;
                pred.live_minute = null;
                delete pred.graded_at;
                delete pred.graded_by;
                fixed++;
            }
        }
    }

    if (fixed > 0) {
        await docRef.update({ predictions: preds });
        logger.info(`[Repair] ✅ Fixed ${fixed} corrupted predictions for ${dateStr}`);
    }
    return fixed;
}

import cron from 'node-cron';
import admin from 'firebase-admin';
import pino from 'pino';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {
    runBasketballPipeline,
    runCricketPipeline,
    runQuantGrading,
    runQuantPerformance,
    runQuantPipeline,
    runLineupSyncer,
    runArbScanner
} from './quantService.js';
import { sendTipOfTheDayPush, generateDailyTipFromPredictions } from './pushService.js';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

export const triggerTipOfTheDay = async () => {
    logger.info('[Scheduler] Triggering Tip of the Day push...');
    try {
        const db = admin.firestore();
        const todayKey = new Date().toISOString().split('T')[0];
        
        const snap = await db.collection('quant_predictions').doc(todayKey).get();
        if (!snap.exists || !snap.data().predictions) {
            logger.warn('[Scheduler] No predictions found for today');
            return { status: 'error', error: 'No predictions found' };
        }

        const predictions = snap.data().predictions;
        const tipData = await generateDailyTipFromPredictions(predictions);
        
        if (!tipData) {
            return { status: 'error', error: 'Failed to generate tip' };
        }

        const result = await sendTipOfTheDayPush(tipData);
        logger.info('[Scheduler] Tip of the Day push complete.', result);
        return { status: 'success', ...result };
    } catch (e) {
        logger.error({ error: e }, '[Scheduler] Tip of the Day push error');
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

    // Quant pipeline at 07:45 Lagos time — REMOVED (duplicate of 07:00 football generation)
    // Both triggerFootballGeneration() and triggerQuantPipeline() call runQuantPipeline()
    // with the same logic. Running twice wastes ~150 API-Football credits daily.

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

    // Tip of the Day push at 08:00 Lagos time (after quant pipeline completes)
    const tipTask = cron.schedule('0 8 * * *',
        withLock('tip_of_day_push', 15, async () => {
            logger.info('[Scheduler] Sending Tip of the Day push...');
            await triggerTipOfTheDay();
        }),
        { timezone: 'Africa/Lagos' }
    );
    tasks.set('tipOfDay', tipTask);
    logger.info('💡 Tip of the Day push scheduled at 08:00 Lagos');

    // NOTE: Live momentum engine and player stats client have been disabled.
    // They consumed ~15,000+ API-Football credits/day running every 2-5 minutes,
    // leaving no quota for grading. Predictions and grading are the priority.
    //
    // REPLACED WITH: Lightweight live_score_writer.py (1 API call every 2 min = ~480/day).
    // Previously 15,000+ credits/day → now ~480 credits/day. Safe within 7,500 quota.

    // Live score writer every 2 minutes (lightweight, 1 API call per run)
    if (process.env.API_FOOTBALL_KEY) {
        const liveScoreTask = cron.schedule('*/2 * * * *',
            withLock('live_scores', 1, async () => {
                try {
                    const { spawn } = await import('child_process');
                    const { default: path } = await import('path');
                    const script = path.join(__dirname, 'quant', 'live_score_writer.py');
                    const python = process.env.PYTHON_BIN || 'python3';

                    const child = spawn(python, [script], {
                        cwd: path.join(__dirname, 'quant'),
                        env: { ...process.env },
                        timeout: 30000,
                    });

                    let stdout = '';
                    let stderr = '';
                    child.stdout.on('data', d => stdout += d);
                    child.stderr.on('data', d => stderr += d);

                    child.on('close', code => {
                        if (code !== 0) {
                            logger.warn({ stderr }, '[LiveScores] Non-zero exit');
                        }
                    });
                } catch (e) {
                    logger.warn({ error: e.message }, '[LiveScores] Spawn error');
                }
            }),
            { timezone: 'Africa/Lagos' }
        );
        tasks.set('liveScores', liveScoreTask);
        logger.info('⚽ Live scores scheduled every 2 minutes (~480 API calls/day)');
    }

    // Unified vault at 08:15 Lagos (after all sports pipelines complete)
    const unifiedVaultTask = cron.schedule('15 8 * * *',
        withLock('unified_vault', 10, async () => {
            try {
                const { spawn } = await import('child_process');
                const { default: path } = await import('path');
                const script = path.join(__dirname, 'quant', 'unified_vault.py');
                const python = process.env.PYTHON_BIN || 'python3';

                const child = spawn(python, [script], {
                    cwd: path.join(__dirname, 'quant'),
                    env: { ...process.env },
                    timeout: 30000,
                });

                let stdout = '';
                let stderr = '';
                child.stdout.on('data', d => stdout += d);
                child.stderr.on('data', d => stderr += d);

                child.on('close', code => {
                    if (code !== 0) {
                        logger.warn({ stderr }, '[Scheduler] Unified vault non-zero exit');
                    } else {
                        logger.info({ stdout: stdout.trim() }, '[Scheduler] Unified vault built');
                    }
                });
            } catch (e) {
                logger.error({ error: e }, '[Scheduler] Unified vault error');
            }
        }),
        { timezone: 'Africa/Lagos' }
    );
    tasks.set('unifiedVault', unifiedVaultTask);
    logger.info('🏦 Unified vault (all sports) scheduled at 08:15 Lagos');

    // Live in-play EV every 5 minutes
    if (process.env.API_FOOTBALL_KEY) {
        const liveEvTask = cron.schedule('*/5 * * * *',
            withLock('live_ev', 4, async () => {
                try {
                    const { spawn } = await import('child_process');
                    const { default: path } = await import('path');
                    const script = path.join(__dirname, 'quant', 'live_ev_engine.py');
                    const python = process.env.PYTHON_BIN || 'python3';

                    const child = spawn(python, [script], {
                        cwd: path.join(__dirname, 'quant'),
                        env: { ...process.env },
                        timeout: 30000,
                    });

                    let stdout = '';
                    child.stdout.on('data', d => stdout += d);
                    child.stderr.on('data', d => { /* silent */ });

                    child.on('close', code => {
                        try {
                            const result = JSON.parse(stdout.trim() || '{}');
                            if (result.live_bets > 0) {
                                logger.info({ result }, `[LiveEV] ${result.live_bets} in-play bets found`);
                            }
                        } catch {}
                    });
                } catch (e) {
                    logger.warn({ error: e.message }, '[LiveEV] Spawn error');
                }
            }),
            { timezone: 'Africa/Lagos' }
        );
        tasks.set('liveEv', liveEvTask);
        logger.info('🎯 Live in-play EV scheduled every 5 minutes');
    }

    // Historical data collection at 03:00 Lagos (low traffic, once daily)
    if (process.env.API_FOOTBALL_KEY) {
        const historicalTask = cron.schedule('0 3 * * *',
            withLock('historical_data', 120, async () => {
                try {
                    const { spawn } = await import('child_process');
                    const { default: path } = await import('path');
                    const script = path.join(__dirname, 'quant', 'historical_data_pipeline.py');
                    const python = process.env.PYTHON_BIN || 'python3';

                    const child = spawn(python, [script, '--days', '7'], {
                        cwd: path.join(__dirname, 'quant'),
                        env: { ...process.env },
                        timeout: 120000,
                    });

                    let stdout = '';
                    child.stdout.on('data', d => stdout += d);
                    child.stderr.on('data', d => { /* silent */ });

                    child.on('close', code => {
                        logger.info({ exitCode: code }, '[Historical] Data collection complete');
                    });
                } catch (e) {
                    logger.warn({ error: e.message }, '[Historical] Spawn error');
                }
            }),
            { timezone: 'Africa/Lagos' }
        );
        tasks.set('historicalData', historicalTask);
        logger.info('📚 Historical data collection at 03:00 Lagos (7 days per run)');
    }
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
    // DISABLED: The arb scanner has never found a prediction for the West African bookmaker market.
    // Keeping the code on disk for future rebuild with custom scraper.
    // const arbScannerTask = cron.schedule('*/15 * * * *',
    //     withLock('arb_scanner', 14, async () => {
    //         logger.info('[Scheduler] Running 15-minute Arb Scanner...');
    //         try {
    //             await runArbScanner();
    //             logger.info('[Scheduler] Arb Scanner complete.');
    //         } catch (e) {
    //             logger.error({ error: e }, '[Scheduler] Arb Scanner error');
    //         }
    //     })
    // );
    // tasks.set('arbScanner', arbScannerTask);
    // logger.info('🔍 Arb Scanner scheduled every 15 minutes');

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

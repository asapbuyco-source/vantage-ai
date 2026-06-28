/**
 * backend/quantService.js
 * ──────────────────────────────────────────────────────────────────────────────
 * Node.js wrapper that spawns the Python quant pipeline.
 * Called by scheduler.js for daily automated runs, and by server.js for
 * admin on-demand triggers.
 *
 * The Python process handles all statistical model computation.
 * This module collects stdout, parses the result, and returns a standardized
 * { status, generated, predictions } object.
 */

import { spawn, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import pino from 'pino';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUANT_SCRIPT = path.join(__dirname, 'quant', 'quant_pipeline.py');

// Initialize Pino logger for structured logging
const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
});

// ── Async Python binary resolution (cached after first call) ─────────────────
const PYTHON_CANDIDATES = [
    'python3', 'python',
    '/nix/var/nix/profiles/default/bin/python3',
    '/root/.nix-profile/bin/python3',
    '/usr/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python',
];

let _pythonBin = null;
let _pythonBinPromise = null; // deduplicate concurrent resolution

async function resolvePythonBin() {
    if (_pythonBin) return _pythonBin;
    if (_pythonBinPromise) return _pythonBinPromise;
    _pythonBinPromise = (async () => {
        const probeEnv = {
            PATH: [
                '/nix/var/nix/profiles/default/bin',
                '/root/.nix-profile/bin',
                '/usr/local/bin',
                '/usr/bin',
                '/bin',
                process.env.PATH || '',
            ].join(':'),
        };
        for (const candidate of PYTHON_CANDIDATES) {
            try {
                const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 3000, env: probeEnv });
                if (result.status === 0) {
                    const ver = (result.stdout || result.stderr || '').trim();
                    logger.info(`[QuantService] Python binary resolved: ${candidate} (${ver})`);
                    _pythonBin = candidate;
                    return _pythonBin;
                }
            } catch (_) { /* not available */ }
        }
        const pathEnv = process.env.PATH || '(not set)';
        logger.error(`[QuantService] No Python binary found. PATH = ${pathEnv}`);
        _pythonBin = 'python3'; // surface a clear ENOENT at spawn time
        return _pythonBin;
    })();
    return _pythonBinPromise;
}

// ── Env forward to Python process (scoped whitelist) ─────────────────────────
function buildPythonEnv() {
    return {
        // Forward PATH with Nix profile dirs prepended — CRITICAL FIX for ENOENT
        PATH: [
            '/nix/var/nix/profiles/default/bin',
            '/root/.nix-profile/bin',
            '/usr/local/bin',
            '/usr/bin',
            '/bin',
            process.env.PATH || '',
        ].join(':'),
        // Only forward the API tokens and config that Python needs
        RAPIDAPI_KEY: process.env.RAPIDAPI_KEY || '',
        SPORTMONKS_API_TOKEN: process.env.SPORTMONKS_API_TOKEN || '',
        SPORTMONKS_CRICKET_API_TOKEN: process.env.SPORTMONKS_CRICKET_API_TOKEN || '',
        API_FOOTBALL_KEY: process.env.API_FOOTBALL_KEY || '',
        FOOTBALL_DATA_KEY: process.env.FOOTBALL_DATA_KEY || '',
        API_BASKETBALL_KEY: process.env.API_BASKETBALL_KEY || '',
        ODDS_API_KEY: process.env.ODDS_API_KEY || '',
        GOOGLE_GENAI_API_KEY: process.env.GOOGLE_GENAI_API_KEY || '',
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
        FIREBASE_SERVICE_ACCOUNT: process.env.FIREBASE_SERVICE_ACCOUNT || '',
        // Force Python binary wheels to find Nixpacks C++ standard libraries
        LD_LIBRARY_PATH: '/nix/var/nix/profiles/default/lib:/root/.nix-profile/lib:' + (process.env.LD_LIBRARY_PATH || ''),
        PYTHONUNBUFFERED: '1',         // Ensure real-time stdout
        PYTHONPATH: path.join(__dirname, 'quant'),
        // Include HOME so Python can locate user site-packages if needed
        HOME: process.env.HOME || '/root',
    };
}

// ── Exponential backoff retry helper ──────────────────────────────────────────
/**
 * Execute a promise with exponential backoff retry logic.
 * @param {Function} fn - Async function to retry
 * @param {object} opts - {maxAttempts, baseDelayMs, backoffMultiplier, maxDelayMs}
 */
async function withExponentialBackoff(fn, opts = {}) {
    const {
        maxAttempts = 3,
        baseDelayMs = 2000,
        backoffMultiplier = 2.5,
        maxDelayMs = 30000,
        label = 'operation'
    } = opts;

    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            logger.info(`[QuantService] ${label} (attempt ${attempt}/${maxAttempts})...`);
            const result = await fn();
            if (attempt > 1) {
                logger.info(`[QuantService] ✅ ${label} succeeded on attempt ${attempt}`);
            }
            return result;
        } catch (err) {
            lastErr = err;
            if (attempt < maxAttempts) {
                const delayMs = Math.min(
                    baseDelayMs * Math.pow(backoffMultiplier, attempt - 1),
                    maxDelayMs
                );
                logger.warn(`[QuantService] ⚠️  ${label} attempt ${attempt} failed: ${err.message}`);
                logger.info(`[QuantService] Retrying in ${delayMs}ms...`);
                await new Promise(r => setTimeout(r, delayMs));
            } else {
                logger.error(`[QuantService] ❌ ${label} failed on all ${maxAttempts} attempts: ${err.message}`);
            }
        }
    }
    throw lastErr;
}

// ── Spawn Python quant pipeline ───────────────────────────────────────────────
async function spawnPythonPipeline(dateStr = null, dryRun = false) {
    const pythonBin = await resolvePythonBin();
    return new Promise((resolve, reject) => {
        const args = ['quant_pipeline.py'];
        if (dateStr) args.push(dateStr);
        if (dryRun) args.push('--dry-run');

        logger.info(`[QuantService] Spawning Python pipeline: ${pythonBin} ${args.join(' ')}`);

        const py = spawn(pythonBin, args, {
            cwd: path.join(__dirname, 'quant'),
            env: buildPythonEnv(),
        });

        let stdout = '';
        let stderr = '';

        py.stdout.on('data', (data) => {
            const line = data.toString();
            stdout += line;
            // Stream pipeline log lines to main Node log
            line.split('\n').filter(Boolean).forEach(l => logger.info(`[Python|Quant] ${l}`));
        });

        py.stderr.on('data', (data) => {
            const line = data.toString();
            stderr += line;
            line.split('\n').filter(Boolean).forEach(l => logger.warn(`[Python|Quant|ERR] ${l}`));
        });

        py.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Python process exited with code ${code}: ${stderr.slice(-500)}`));
                return;
            }
            resolve({ stdout, stderr });
        });

        py.on('error', (err) => {
            reject(new Error(`Failed to spawn Python: ${err.message}`));
        });

        // Safety timeout: 10 minutes
        setTimeout(() => {
            py.kill('SIGTERM');
            reject(new Error('Quant pipeline timed out after 10 minutes'));
        }, 10 * 60 * 1000);
    });
}

// ── Startup probe: resolve Python binary at module load time ─────────────────
// This runs when server.js imports quantService.js, logging success/failure
// immediately at startup rather than waiting for the 19:00 cron job.
resolvePythonBin().then(bin => {
    logger.info(`[QuantService] 🐍 Python probe complete. Active binary: ${bin}`);
}).catch(err => {
    logger.error(`[QuantService] 💀 Python probe FAILED at startup: ${err.message}`);
});

// ── Main exported function ────────────────────────────────────────────────────

/**
 * Run the quantitative football pipeline for the given date.
 * If dateStr is null, uses today's date (Lagos UTC+1).
 *
 * @param {string|null} dateStr - YYYY-MM-DD
 * @param {boolean} dryRun      - If true, no API calls, no Firestore writes
 * @returns {Promise<{status, generated, date, matches_analyzed}>}
 */
export const runQuantPipeline = async (dateStr = null, dryRun = false) => {
    const label = dryRun ? 'DRY RUN' : (dateStr || 'today');
    logger.info(`[QuantService] Starting Quant Pipeline (${label})...`);

    try {
        // Use exponential backoff: 3 attempts, 2s base delay, 2.5x multiplier, 30s max
        const { stdout } = await withExponentialBackoff(
            () => spawnPythonPipeline(dateStr, dryRun),
            {
                maxAttempts: 3,
                baseDelayMs: 2000,
                backoffMultiplier: 2.5,
                maxDelayMs: 30000,
                label: 'Quant pipeline execution'
            }
        );

        // Try to extract summary from stdout "[QuantPipeline] ✅ Pipeline complete!"
        const matchesMatch = stdout.match(/Matches analyzed:\s*(\d+)/);
        const betsMatch = stdout.match(/Value bets \(high\/medium\):\s*(\d+)/); // BUG-14 FIX: was 'Value bets found:' which never matched
        const matchesAnalyzed = matchesMatch ? parseInt(matchesMatch[1]) : 0;
        const generated = betsMatch ? parseInt(betsMatch[1]) : 0;

        // Read the actual predictions from Firestore for confirmation
        let predictions = [];
        if (!dryRun) {
            try {
                // Lazy-init Firebase Admin if not already initialized (e.g. when run standalone)
                if (!admin.apps.length) {
                    const saCred = process.env.FIREBASE_SERVICE_ACCOUNT;
                    if (saCred) {
                        admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saCred)) });
                    }
                }
                const db = admin.firestore();
                const effectiveDate = dateStr || getLagosDateKey();
                const doc = await db.collection('quant_predictions').doc(effectiveDate).get();
                if (doc.exists) {
                    predictions = doc.data()?.predictions || [];
                }
            } catch (fsErr) {
                logger.warn(`[QuantService] Could not read Firestore confirmation: ${fsErr.message}`);
            }
        }

        logger.info(`[QuantService] ✅ Quant Pipeline done: ${generated} value bets from ${matchesAnalyzed} matches.`);
        return {
            status: 'success',
            generated: predictions.length || generated,
            matches_analyzed: matchesAnalyzed,
            date: dateStr || getLagosDateKey(),
        };
    } catch (err) {
        logger.error(`[QuantService] ❌ Quant Pipeline failed: ${err.message}`);
        return { status: 'error', error: err.message };
    }
};

/**
 * Run grading for yesterday (or a custom date).
 */
export const runQuantGrading = async (dateStr = null) => {
    logger.info(`[QuantService] Starting Quant Grading for ${dateStr || 'yesterday'}...`);
    try {
        const result = await withExponentialBackoff(
            async () => {
                const pythonBin = await resolvePythonBin();
                return new Promise((resolve, reject) => {
                    const args = ['grading_engine.py'];
                    if (dateStr) args.push(dateStr);

                    const py = spawn(pythonBin, args, {
                        cwd: path.join(__dirname, 'quant'),
                        env: buildPythonEnv(),
                    });

                    let stdout = '';
                    py.stdout.on('data', d => { 
                        stdout += d; 
                        logger.info(`[Python|Grading] ${d.toString().trim()}`); 
                    });
                    py.stderr.on('data', d => logger.warn(`[Python|Grading|ERR] ${d.toString().trim()}`));
                    py.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`Exit code ${code}`)));
                    py.on('error', reject);
                    setTimeout(() => { py.kill(); reject(new Error('Grading timeout')); }, 5 * 60 * 1000);
                });
            },
            {
                maxAttempts: 2,
                baseDelayMs: 2000,
                backoffMultiplier: 2.5,
                label: 'Quant grading'
            }
        );

        let graded = 0;
        let total = 0;

        // Try JSON parse first (grading_engine.py outputs {"status": "error"} or "Graded X/Y")
        try {
            const parsed = JSON.parse(result.trim().split('\n').pop());
            if (parsed.status === 'error') throw new Error(parsed.error);
            if (parsed.graded !== undefined) {
                graded = parsed.graded;
                total = parsed.total ?? 0;
            }
        } catch (_) {
            // Fall back to regex
            const gradedMatch = result.match(/Graded (\d+)\/(\d+)/);
            graded = gradedMatch ? parseInt(gradedMatch[1]) : 0;
            total = gradedMatch ? parseInt(gradedMatch[2]) : 0;
        }

        return {
            status: 'success',
            graded,
            total,
        };
    } catch (err) {
        logger.error(`[QuantService] Grading error: ${err.message}`);
        return { status: 'error', error: err.message };
    }
};

/**
 * Run performance tracker and save to Firestore.
 */
export const runQuantPerformance = async () => {
    logger.info('[QuantService] Computing quant performance metrics...');
    try {
        await withExponentialBackoff(
            async () => {
                const pythonBin = await resolvePythonBin();
                return new Promise((resolve, reject) => {
                    const py = spawn(pythonBin, ['performance_tracker.py'], {
                        cwd: path.join(__dirname, 'quant'),
                        env: buildPythonEnv(),
                    });
                    py.stdout.on('data', d => logger.info(`[Python|Perf] ${d.toString().trim()}`));
                    py.stderr.on('data', d => logger.warn(`[Python|Perf|ERR] ${d.toString().trim()}`));
                    py.on('close', code => code === 0 ? resolve() : reject(new Error(`Exit code ${code}`)));
                    py.on('error', reject);
                    setTimeout(() => { py.kill(); reject(new Error('Performance timeout')); }, 3 * 60 * 1000);
                });
            },
            {
                maxAttempts: 2,
                baseDelayMs: 2000,
                label: 'Performance tracking'
            }
        );
        return { status: 'success' };
    } catch (err) {
        return { status: 'error', error: err.message };
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// BASKETBALL PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

const BASKETBALL_SCRIPT = path.join(__dirname, 'quant', 'basketball_pipeline.py');

/**
 * Run the quantitative basketball pipeline for the given date.
 * Uses BallDontLie API (free, no key) for real NBA game data.
 * If no games are found, returns { status: 'no_games' }.
 *
 * @param {string|null} dateStr - YYYY-MM-DD, defaults to Lagos today
 * @param {boolean} dryRun
 * @returns {Promise<{status, generated, matches_analyzed, date}>}
 */
export const runBasketballPipeline = async (dateStr = null, dryRun = false) => {
    const label = dryRun ? 'DRY RUN' : (dateStr || 'today');
    logger.info(`[QuantService] 🏀 Starting Basketball Pipeline (${label})...`);

    try {
        const { stdout } = await withExponentialBackoff(
            async () => {
                const pythonBin = await resolvePythonBin();
                return new Promise((resolve, reject) => {
                    const args = ['basketball_pipeline.py'];
                    if (dateStr) args.push(dateStr);
                    if (dryRun) args.push('--dry-run');

                    logger.info(`[QuantService] Spawning: ${pythonBin} ${args.join(' ')}`);

                    const py = spawn(pythonBin, args, {
                        cwd: path.join(__dirname, 'quant'),
                        env: buildPythonEnv(),
                    });

                    let stdout = '';
                    let stderr = '';

                    py.stdout.on('data', (data) => {
                        const line = data.toString();
                        stdout += line;
                        line.split('\n').filter(Boolean).forEach(l => logger.info(`[Python|Basketball] ${l}`));
                    });
                    py.stderr.on('data', (data) => {
                        const line = data.toString();
                        stderr += line;
                        line.split('\n').filter(Boolean).forEach(l => logger.warn(`[Python|Basketball|ERR] ${l}`));
                    });

                    py.on('close', (code) => {
                        if (stdout.includes('NO_GAMES')) {
                            logger.info('[QuantService] 🏀 Basketball: no NBA games scheduled today.');
                            resolve({ stdout, stderr, noGames: true });
                            return;
                        }
                        if (code !== 0) {
                            reject(new Error(`Basketball pipeline exited with code ${code}: ${stderr.slice(-500)}`));
                            return;
                        }
                        resolve({ stdout, stderr });
                    });

                    py.on('error', (err) => reject(new Error(`Failed to spawn basketball pipeline: ${err.message}`)));

                    // Safety timeout: 5 minutes
                    setTimeout(() => {
                        py.kill('SIGTERM');
                        reject(new Error('Basketball pipeline timed out after 5 minutes'));
                    }, 5 * 60 * 1000);
                });
            },
            {
                maxAttempts: 2,
                baseDelayMs: 2000,
                backoffMultiplier: 2.5,
                maxDelayMs: 15000,
                label: 'Basketball pipeline execution'
            }
        );

        // Check for "no games today"
        if (stdout.includes('NO_GAMES')) {
            logger.info('[QuantService] 🏀 Basketball: no NBA games scheduled today.');
            return { status: 'no_games', generated: 0 };
        }

        // Parse summary stats from stdout
        const gamesMatch  = stdout.match(/Games analyzed:\s*(\d+)/);
        const betsMatch   = stdout.match(/Value bets identified:\s*(\d+)/);
        const gamesAnalyzed = gamesMatch ? parseInt(gamesMatch[1]) : 0;
        const generated     = betsMatch  ? parseInt(betsMatch[1])  : 0;

        logger.info(`[QuantService] ✅ Basketball done: ${generated} value bets from ${gamesAnalyzed} games.`);
        return {
            status: 'success',
            generated,
            matches_analyzed: gamesAnalyzed,
            date: dateStr || getLagosDateKey(),
        };
    } catch (err) {
        logger.error(`[QuantService] 🏀 Basketball pipeline failed: ${err.message}`);
        return { status: 'error', error: err.message };
    }
};

export const runCricketPipeline = async (dateStr = null, dryRun = false) => {
    const label = dryRun ? 'DRY RUN' : (dateStr || 'today');
    logger.info(`[QuantService] Starting Cricket Pipeline (${label})...`);

    try {
        const { stdout } = await withExponentialBackoff(
            async () => {
                const pythonBin = await resolvePythonBin();
                return new Promise((resolve, reject) => {
                    const args = ['cricket_pipeline.py'];
                    if (dateStr) args.push(dateStr);
                    if (dryRun) args.push('--dry-run');

                    logger.info(`[QuantService] Spawning: ${pythonBin} ${args.join(' ')}`);

                    const py = spawn(pythonBin, args, {
                        cwd: path.join(__dirname, 'quant'),
                        env: buildPythonEnv(),
                    });

                    let stdout = '';
                    let stderr = '';

                    py.stdout.on('data', (data) => {
                        const line = data.toString();
                        stdout += line;
                        line.split('\n').filter(Boolean).forEach(l => logger.info(`[Python|Cricket] ${l}`));
                    });
                    py.stderr.on('data', (data) => {
                        const line = data.toString();
                        stderr += line;
                        line.split('\n').filter(Boolean).forEach(l => logger.warn(`[Python|Cricket|ERR] ${l}`));
                    });

                    py.on('close', (code) => {
                        if (code !== 0) {
                            reject(new Error(`Cricket pipeline exited with code ${code}: ${stderr.slice(-500)}`));
                            return;
                        }
                        resolve({ stdout, stderr });
                    });

                    py.on('error', (err) => reject(new Error(`Failed to spawn cricket pipeline: ${err.message}`)));

                    setTimeout(() => {
                        py.kill('SIGTERM');
                        reject(new Error('Cricket pipeline timed out after 5 minutes'));
                    }, 5 * 60 * 1000);
                });
            },
            {
                maxAttempts: 2,
                baseDelayMs: 2000,
                backoffMultiplier: 2.5,
                maxDelayMs: 15000,
                label: 'Cricket pipeline execution'
            }
        );

        const fixturesMatch = stdout.match(/Fixtures analyzed:\s*(\d+)/);
        const picksMatch = stdout.match(/Value picks identified:\s*(\d+)/);
        const fixturesAnalyzed = fixturesMatch ? parseInt(fixturesMatch[1]) : 0;
        const generated = picksMatch ? parseInt(picksMatch[1]) : 0;

        logger.info(`[QuantService] Cricket done: ${generated} picks from ${fixturesAnalyzed} fixtures.`);
        return {
            status: 'success',
            generated,
            matches_analyzed: fixturesAnalyzed,
            date: dateStr || getLagosDateKey(),
        };
    } catch (err) {
        logger.error(`[QuantService] Cricket pipeline failed: ${err.message}`);
        return { status: 'error', error: err.message };
    }
};

// ── Lagos date helper ─────────────────────────────────────────────────────────
function getLagosDateKey() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
}


export const runLineupSyncer = async (dateStr = null) => {
    logger.info('[QuantService] Running lineup syncer...');
    try {
        const pythonBin = await resolvePythonBin();
        const args = ['lineup_syncer.py'];
        if (dateStr) args.push(dateStr);
        return new Promise((resolve) => {
            const py = spawn(pythonBin, args, {
                cwd: path.join(__dirname, 'quant'),
                env: buildPythonEnv(),
            });
            py.stdout.on('data', d => logger.info(`[Python|LineupSyncer] ${d}`));
            py.stderr.on('data', d => logger.warn(`[Python|LineupSyncer|ERR] ${d}`));
            py.on('close', code => {
                if (code === 0) resolve({ status: 'success' });
                else resolve({ status: 'error', reason: `exit code ${code}` });
            });
            py.on('error', err => resolve({ status: 'error', error: err.message }));
        });
    } catch (e) {
        logger.error(`[QuantService] Lineup sync failed: ${e.message}`);
        return { status: 'error', error: e.message };
    }
};

export const runArbScanner = async () => {
    logger.info('[QuantService] Running Arb Scanner...');
    try {
        const pythonBin = await resolvePythonBin();
        return new Promise((resolve) => {
            const py = spawn(pythonBin, ['api_football_arb_scraper.py'], {
                cwd: path.join(__dirname, 'scrapers'),
                env: buildPythonEnv(),
            });
            py.stdout.on('data', d => logger.info(`[Python|ArbScanner] ${d}`));
            py.stderr.on('data', d => logger.warn(`[Python|ArbScanner|ERR] ${d}`));
            py.on('close', code => {
                if (code === 0) resolve({ status: 'success' });
                else resolve({ status: 'error', reason: `exit code ${code}` });
            });
            py.on('error', err => resolve({ status: 'error', error: err.message }));
        });
    } catch (e) {
        logger.error(`[QuantService] Arb Scanner failed: ${e.message}`);
        return { status: 'error', error: e.message };
    }
};

import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { rateLimit } from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import fs from 'fs';
import { spawnSync } from 'child_process';
import pino from 'pino';
import * as Sentry from '@sentry/node';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import sanitizeHtml from 'sanitize-html';
import jwt from 'jsonwebtoken';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { initScheduler, stopScheduler, triggerFootballGeneration, triggerBasketballGeneration, triggerCricketGeneration, triggerGrading, triggerBlogGen, triggerAccumulatorGeneration, triggerTelegramBroadcast, triggerQuantPipeline, triggerQuantGrading, triggerQuantPerformance, repairCorruptedPredictions, triggerTipOfTheDay } from './backend/scheduler.js';
import { sendTelegramTestMessage } from './backend/telegramService.js';
import { requireFirebaseUser } from './backend/authMiddleware.js';
import { assertValidPlan, inferPlanFromAmount } from './backend/paymentPlans.js';
import { fulfillVipPayment } from './backend/paymentFulfillment.js';


// Load environment variables from .env.local if available (for local dev)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

// ══════════════════════════════════════════════════════════════════════
// SENTRY & STRUCTURED LOGGING SETUP
// ══════════════════════════════════════════════════════════════════════

// Initialize Pino structured logger
const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    serializers: {
        error: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
    }
});

// Initialize Sentry for error tracking (if SENTRY_DSN is provided)
const SENTRY_DSN = process.env.SENTRY_DSN;
if (SENTRY_DSN) {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 0.1, // 10% of transactions for performance monitoring
        integrations: [
            Sentry.httpIntegration(),
            Sentry.expressIntegration(),
            Sentry.onUncaughtExceptionIntegration(),
            Sentry.onUnhandledRejectionIntegration(),
        ],
    });
    logger.info('Sentry initialized for error tracking');
} else {
    logger.warn('SENTRY_DSN not set — error tracking disabled');
}

// Log startup
logger.info({ env: process.env.NODE_ENV }, '[Server] Starting Vantage AI backend');

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize Firebase Admin (Required for write access by the backend tasks)
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        if (serviceAccount.private_key) {
            serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        }
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });

        // Critical Fix: Instruct Firestore Admin to ignore undefined properties
        // This prevents crashes if the AI omits optional fields like `homeForm` from its JSON output
        admin.firestore().settings({ ignoreUndefinedProperties: true });

        logger.info('[Server] Firebase Admin SDK initialized successfully');

        // Start the automated cron scheduler now that Admin is ready
        initScheduler();
    } else {
        logger.warn('[Server] FIREBASE_SERVICE_ACCOUNT not found. Auto-generation scheduler will not work.');
    }

    // ── Graceful Shutdown ─────────────────────────────────────────────────────
    const shutdown = (signal) => {
        logger.info(`[Server] ${signal} received — shutting down gracefully...`);
        stopScheduler();
        server.close(() => {
            logger.info('[Server] HTTP server closed.');
            process.exit(0);
        });
        setTimeout(() => {
            logger.error('[Server] Forced shutdown after timeout.');
            process.exit(1);
        }, 15000);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
} catch (error) {
    logger.error({ error }, '[Server] Failed to initialize Firebase Admin');
    Sentry.captureException(error);
}

// Trust the reverse proxy (Render, Railway, etc.) so express-rate-limit can get the real client IP.
// This resolves the ERR_ERL_UNEXPECTED_X_FORWARDED_FOR error.
app.set('trust proxy', 1);

// ── Public privacy policy for Play Store compliance ────────────────────────
app.get('/privacy', (req, res) => {
    const lang = (req.query.lang || 'en').startsWith('fr') ? 'fr' : 'en';
    const lastUpdated = new Date().toISOString().split('T')[0];
    const title = lang === 'fr' ? 'Politique de Confidentialité — Vantage AI' : 'Privacy Policy — Vantage AI';
    const content = lang === 'fr'
        ? `<h1>Politique de Confidentialité</h1><p><strong>Dernière mise à jour :</strong> ${lastUpdated}</p><p>Chez <strong>Vantage AI</strong>, nous accordons une importance capitale à la confidentialité de vos données.</p><h2>1. Collecte des Données</h2><p>Nous collectons : adresse email, nom d'affichage (via Google Auth ou Email), historique des transactions VIP, données d'utilisation.</p><h2>2. Utilisation</h2><p>Fournir les services, gérer les abonnements, améliorer l'algorithme.</p><h2>3. Sécurité</h2><p>Chiffrement SSL, authentification Firebase sécurisée.</p><h2>4. Partage</h2><p>Nous ne vendons jamais vos données. Partagées uniquement avec Google Cloud (Firebase), Google Play (RevenueCat) pour les abonnements.</p><h2>5. Vos Droits</h2><p>Accès, rectification, suppression. Contact via la section Profil de l'application.</p><p>Contact : <a href="mailto:support@vantageai.online">support@vantageai.online</a></p>`
        : `<h1>Privacy Policy</h1><p><strong>Last Updated:</strong> ${lastUpdated}</p><p>At <strong>Vantage AI</strong>, we prioritize your data privacy.</p><h2>1. Data Collection</h2><p>We collect: email address, display name (via Google Auth or Email), VIP transaction history, usage data.</p><h2>2. Usage</h2><p>To provide services, manage subscriptions, improve our algorithm.</p><h2>3. Security</h2><p>SSL encryption, secure Firebase authentication.</p><h2>4. Data Sharing</h2><p>We never sell your data. Shared only with Google Cloud (Firebase), Google Play (RevenueCat) for subscriptions.</p><h2>5. Your Rights</h2><p>Access, correction, deletion. Contact us via the Profile section in the app.</p><p>Contact: <a href="mailto:support@vantageai.online">support@vantageai.online</a></p>`;
    res.send(`<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#1e293b;background:#f8fafc}h1{color:#0f172a}h2{color:#334155;margin-top:2rem}a{color:#0891b2}</style></head><body>${content}</body></html>`);
});

// ── Sentry Middleware ─────────────────────────────────────────────────────────
// Basic health check endpoint for Render/Railway (Needs to be above CORS so it isn't blocked by missing origin)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Health check endpoint for Python environment availability
// This endpoint verifies that the Python binary can be invoked and is working
app.get('/health/python', (req, res) => {
    try {
        // Try common Python binary names
        const pythonBinaries = ['python3', 'python'];
        let pythonVersion = null;
        let pythonBinary = null;
        
        for (const binary of pythonBinaries) {
            try {
                const result = spawnSync(binary, ['--version'], { 
                    encoding: 'utf8', 
                    timeout: 3000 
                });
                if (result.status === 0) {
                    pythonVersion = (result.stdout || result.stderr || '').trim();
                    pythonBinary = binary;
                    break;
                }
            } catch (_) {
                // Binary not available, try next
            }
        }
        
        if (!pythonBinary) {
            logger.warn('[Health] Python binary not found');
            return res.status(503).json({
                status: 'degraded',
                python: 'unavailable',
                message: 'Python binary not found in system PATH',
                timestamp: new Date().toISOString()
            });
        }
        
        res.status(200).json({
            status: 'ok',
            python: 'available',
            pythonBinary: pythonBinary,
            pythonVersion: pythonVersion,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        logger.error({ error: err }, '[Health] Python check error');
        res.status(500).json({
            status: 'error',
            error: err.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Enable CORS
// During local dev, allow localhost:5173.
// In production, allow the Netlify frontend URL.
// Also allow Capacitor native app origins (Android + iOS).
const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://vantageaiafrica.netlify.app',
    'https://vantageai.online',
    // Capacitor native app origins
    'capacitor://localhost',
    'ionic://localhost',
    'http://localhost',
    'https://localhost',
    process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, "") : null
].filter(Boolean); // Remove undefined values

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (e.g., background crons, server-to-server calls)
        if (!origin) {
            return callback(null, true);
        }

        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
}));

// ══════════════════════════════════════════════════════════════════════
// RAW BODY CAPTURE (for webhook signature verification)
// Captures raw bytes before JSON parsing so HMAC can be verified
// ══════════════════════════════════════════════════════════════════════
app.use('/api/payments/selar/webhook', express.raw({ type: 'application/json', limit: '5mb' }));
app.use('/api/payments', express.json({ limit: '5mb' }));

// ══════════════════════════════════════════════════════════════════════
// GEMINI API PROXY
// ══════════════════════════════════════════════════════════════════════
// We need to parse JSON bodies for the Gemini POST requests
app.use(express.json({ limit: '5mb' }));

const GOOGLE_GENAI_API_KEY = process.env.GOOGLE_GENAI_API_KEY;

if (!GOOGLE_GENAI_API_KEY) {
    logger.error("[API] CRITICAL: GOOGLE_GENAI_API_KEY environment variable is not set!");
    Sentry.captureMessage("CRITICAL: GOOGLE_GENAI_API_KEY missing", "fatal");
}

// 50 requests per 15 minutes per IP for Gemini
const geminiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests to Gemini API from this IP, please try again after 15 minutes' }
});

app.post('/api/gemini/generate', adminAuth, geminiLimiter, async (req, res) => {
    try {
        if (!GOOGLE_GENAI_API_KEY) {
            logger.warn("[API] Gemini: API key missing on server");
            return res.status(500).json({ error: "API Key missing on server" });
        }

        const { model, contents, config } = req.body;

        if (!model || !contents) {
            return res.status(400).json({ error: "Missing required fields: model or contents" });
        }

        const ai = new GoogleGenAI({ apiKey: GOOGLE_GENAI_API_KEY });

        // Execute the call
        const response = await ai.models.generateContent({
            model,
            contents,
            config
        });

        res.json({ text: response.text });

    } catch (error) {
        logger.error({ error, model: req.body?.model }, 'Gemini generation error');
        Sentry.captureException(error);

        // Pass through the status code if it exists on the error, otherwise 500
        const status = error.status || 500;
        res.status(status).json({
            error: 'Gemini request failed',
            details: error.message,
            status: status
        });
    }
});

// ══════════════════════════════════════════════════════════════════════
// AI FEATURES ENDPOINT (League Radar, Acca Copilot, Daily Tip)
// ══════════════════════════════════════════════════════════════════════

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';

async function callGroq(messages, temperature = 0.15, maxTokens = 150) {
    if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');
    const response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: GROQ_MODEL, messages, temperature, max_tokens: maxTokens })
    });
    if (!response.ok) throw new Error(`Groq error: ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
}

async function generateLeagueRadar(predictions) {
    if (!predictions || predictions.length === 0) return null;
    try {
        const leagueStats = {};
        for (const pred of predictions) {
            const league = pred.league || 'Unknown';
            if (!leagueStats[league]) leagueStats[league] = { name: league, picks: [], totalEv: 0, highValueCount: 0 };
            leagueStats[league].picks.push(pred);
            leagueStats[league].totalEv += (pred.expected_value || 0) * 100;
            if ((pred.expected_value || 0) >= 0.06) leagueStats[league].highValueCount++;
        }
        const sortedLeagues = Object.values(leagueStats)
            .map(l => ({ ...l, avgEv: l.totalEv / l.picks.length }))
            .sort((a, b) => b.avgEv - a.avgEv)
            .slice(0, 5);
        const leagueSummary = sortedLeagues.map(l => ({ name: l.name, picks: l.picks.length, avgEv: l.avgEv.toFixed(1), highValue: l.highValueCount }));
        const prompt = `You are a betting analyst. Based on this data, give a 3-sentence summary of the best leagues for betting today:\n\n${JSON.stringify(leagueSummary, null, 2)}\n\nFocus on: Which leagues have the most value? What's the best strategy today? Keep it concise and actionable. Max 60 words.`;
        const insight = await callGroq([{ role: 'user', content: prompt }], 0.2, 100);
        return { leagues: leagueSummary, insight, generatedAt: new Date().toISOString() };
    } catch (e) {
        logger.error(`[AI] League Radar failed: ${e.message}`);
        return null;
    }
}

async function generateAccaCopilot(predictions) {
    if (!predictions || predictions.length === 0) return null;
    try {
        const vaultPicks = predictions.filter(p => p.vault_eligible && p.odds > 0)
            .sort((a, b) => (b.expected_value || 0) - (a.expected_value || 0)).slice(0, 10);
        if (vaultPicks.length < 2) return null;
        const picksSummary = vaultPicks.map(p => ({ match: `${p.home_team} vs ${p.away_team}`, pick: p.bet_type, odds: p.odds, ev: ((p.expected_value || 0) * 100).toFixed(1) }));
        const prompt = `You are an accumulator betting expert. From these picks, suggest 2 accumulator combinations:\n\n${JSON.stringify(picksSummary, null, 2)}\n\nRules:\n- Each acca should have 2-4 legs\n- Combined odds should be reasonable (2.0 - 10.0)\n- Mix different leagues if possible\n- Explain why this combo works\n\nOutput format:\n**[Acca 1]**\nLeg 1: Team A - Pick @ Odds\nCombined Odds: X.XX\n\nBe concise. Total response under 100 words.`;
        const suggestions = await callGroq([{ role: 'user', content: prompt }], 0.2, 200);
        return { suggestions, picks: picksSummary, generatedAt: new Date().toISOString() };
    } catch (e) {
        logger.error(`[AI] Acca Copilot failed: ${e.message}`);
        return null;
    }
}

async function generateDailyTip(predictions) {
    if (!predictions || predictions.length === 0) return null;
    try {
        const bestPick = predictions.filter(p => p.vault_eligible && p.odds > 0)
            .sort((a, b) => (b.expected_value || 0) - (a.expected_value || 0))[0];
        if (!bestPick) return null;
        const prompt = `As a betting expert, give a ONE sentence tip for today focusing on this top pick:\n\nMatch: ${bestPick.home_team} vs ${bestPick.away_team} (${bestPick.league})\nPick: ${bestPick.bet_type} @ ${bestPick.odds}\nEV: ${((bestPick.expected_value || 0) * 100).toFixed(1)}%\n\nMake it punchy and actionable. Max 20 words. Example: "Back Over 2.5 at Anfield - Liverpool's home games average 3.2 goals."`;
        const tip = await callGroq([{ role: 'user', content: prompt }], 0.3, 50);
        return { tip, match: `${bestPick.home_team} vs ${bestPick.away_team}`, pick: bestPick.bet_type, odds: bestPick.odds, ev: ((bestPick.expected_value || 0) * 100).toFixed(1), generatedAt: new Date().toISOString() };
    } catch (e) {
        logger.error(`[AI] Daily Tip failed: ${e.message}`);
        return null;
    }
}

app.post('/api/ai/features', async (req, res) => {
    try {
        const { predictions } = req.body;
        const [leagueRadar, accaCopilot, dailyTip] = await Promise.all([
            generateLeagueRadar(predictions),
            generateAccaCopilot(predictions),
            generateDailyTip(predictions)
        ]);
        res.json({ leagueRadar, accaCopilot, dailyTip });
    } catch (error) {
        logger.error({ error }, 'AI features error');
        res.status(500).json({ error: 'Failed to generate AI features' });
    }
});

app.post('/api/ai/ticket-explanation', async (req, res) => {
    try {
        const { ticket, stake, legCount } = req.body;
        if (!ticket || ticket.length === 0) {
            return res.status(400).json({ error: 'No ticket provided' });
        }

        const totalOdds = ticket.reduce((acc, m) => acc * (m.odds || 1), 1);
        const combinedEv = ticket.reduce((acc, m) => acc + ((m.expected_value || 0) * 100), 0);

        const leagues = [...new Set(ticket.map(m => m.league || 'Unknown'))];
        const picks = ticket.map((m, i) => `Leg ${i + 1}: ${m.home_team || m.homeTeam} vs ${m.away_team || m.awayTeam} - ${m.bet_type || m.prediction} @ ${m.odds?.toFixed(2)} (EV: ${((m.expected_value || 0) * 100).toFixed(1)}%)`).join('\n');

        const prompt = `You are an accumulator betting expert explaining a smart ticket to a user.

Ticket Details:
Stake: ${stake} FCFA
Legs: ${legCount} selections
Combined Odds: ${totalOdds.toFixed(2)}
Combined EV: ${combinedEv.toFixed(1)}%
Leagues: ${leagues.join(', ')}

${picks}

Write a 2-3 sentence explanation of WHY this ticket was selected:
- Why these picks work together
- What makes it a good combination
- Any risk factors

Be encouraging but realistic. Keep it under 60 words. Max 50 words.`;

        const explanation = await callGroq([{ role: 'user', content: prompt }], 0.2, 80);
        res.json({ explanation, totalOdds: totalOdds.toFixed(2), combinedEv: combinedEv.toFixed(1) });
    } catch (error) {
        logger.error({ error }, 'Ticket explanation error');
        res.status(500).json({ error: 'Failed to generate ticket explanation' });
    }
});

// ══════════════════════════════════════════════════════════════════════
// ADMIN TRIGGER ENDPOINTS
// ══════════════════════════════════════════════════════════════════════

// Admin authentication middleware — accepts either:
// 1. x-admin-token header matching ADMIN_API_SECRET (legacy)
// 2. Authorization: Bearer <JWT> signed with ADMIN_API_SECRET or ADMIN_JWT_SECRET
function adminAuth(req, res, next) {
    const secret = process.env.ADMIN_API_SECRET;
    const jwtSecret = process.env.ADMIN_JWT_SECRET || secret;
    const bearerToken = req.headers['authorization']?.replace('Bearer ', '');
    const headerToken = req.headers['x-admin-token'];

    if (!secret) {
        logger.error('[AdminAuth] ADMIN_API_SECRET is not set — admin endpoints are DISABLED');
        return res.status(503).json({ error: 'Admin functionality is not configured on this server.' });
    }

    // Legacy token auth
    if (headerToken && headerToken === secret) return next();

    // JWT auth
    if (bearerToken) {
        try {
            const payload = jwt.verify(bearerToken, jwtSecret);
            if (payload.role === 'admin') return next();
        } catch (_) { /* invalid or expired */ }
    }

    return res.status(401).json({ error: 'Unauthorized — valid x-admin-token or Bearer JWT required' });
}

// GET /api/admin/token — exchange a Firebase ID token for a short-lived admin JWT.
// The caller must be authenticated with Firebase and have isAdmin:true in Firestore.
// This removes the need for any admin secret in the browser bundle.
app.get('/api/admin/token', async (req, res) => {
    if (!process.env.ADMIN_API_SECRET) {
        return res.status(503).json({ error: 'Admin functionality is not configured on this server.' });
    }

    // Support legacy x-admin-token for server-to-server calls (cron, Railway health checks)
    const headerToken = req.headers['x-admin-token'];
    if (headerToken && headerToken === process.env.ADMIN_API_SECRET) {
        const jwtSecret = process.env.ADMIN_JWT_SECRET || process.env.ADMIN_API_SECRET;
        const token = jwt.sign({ role: 'admin' }, jwtSecret, { expiresIn: '15m' });
        logger.info('[AdminAuth] JWT issued via legacy x-admin-token');
        return res.json({ token, expiresIn: 900 });
    }

    // Primary path: verify Firebase ID token sent as Bearer
    const idToken = req.headers['authorization']?.replace('Bearer ', '');
    if (!idToken) {
        return res.status(401).json({ error: 'Unauthorized — provide a Firebase ID token as Bearer or x-admin-token header' });
    }

    try {
        if (!admin.apps.length) {
            return res.status(503).json({ error: 'Firebase Admin not initialized' });
        }
        const decoded = await admin.auth().verifyIdToken(idToken);
        const profileSnap = await admin.firestore().collection('profiles').doc(decoded.uid).get();
        if (!profileSnap.exists || profileSnap.data()?.isAdmin !== true) {
            logger.warn({ uid: decoded.uid }, '[AdminAuth] Token request denied — not an admin');
            return res.status(403).json({ error: 'Forbidden — account is not an admin' });
        }
        const jwtSecret = process.env.ADMIN_JWT_SECRET || process.env.ADMIN_API_SECRET;
        const token = jwt.sign({ role: 'admin', uid: decoded.uid }, jwtSecret, { expiresIn: '15m' });
        logger.info({ uid: decoded.uid }, '[AdminAuth] JWT issued for verified admin user');
        return res.json({ token, expiresIn: 900 });
    } catch (e) {
        logger.warn({ err: e.message }, '[AdminAuth] Firebase ID token verification failed');
        return res.status(401).json({ error: 'Unauthorized — invalid or expired Firebase ID token' });
    }
});

// 🏀 Basketball Quant Pipeline endpoint — Quant Engine primary, OpenAI/Gemini fallback
app.post('/api/admin/generate-basketball', adminAuth, async (req, res) => {
    try {
        logger.info('[API] Manual Basketball Quant Pipeline triggered via Admin');
        const result = await triggerBasketballGeneration();
        res.json(result);
    } catch (e) {
        logger.error({ error: e }, '[API] Basketball pipeline error');
        Sentry.captureException(e);
        res.status(500).json({ error: 'Basketball pipeline failed', details: e.message });
    }
});

app.post('/api/admin/generate-cricket', adminAuth, async (req, res) => {
    try {
        logger.info('[API] Manual Cricket Quant Pipeline triggered via Admin');
        const result = await triggerCricketGeneration();
        res.json(result);
    } catch (e) {
        logger.error({ error: e }, '[API] Cricket pipeline error');
        Sentry.captureException(e);
        res.status(500).json({ error: 'Cricket pipeline failed', details: e.message });
    }
});

app.post('/api/admin/generate-blog', adminAuth, async (req, res) => {
    try {
        logger.info('[API] Manual Blog Generation Triggered via Admin (Programmatic)');
        const result = await triggerBlogGen();
        res.json(result);
    } catch (e) {
        logger.error({ error: e }, '[API] Blog generation error');
        Sentry.captureException(e);
        res.status(500).json({ error: 'Blog generation failed', details: e.message });
    }
});

app.post('/api/admin/generate-accumulators', adminAuth, geminiLimiter, async (req, res) => {
    try {
        logger.info('[API] Manual Accumulator Generation Triggered via Admin (OpenAI)');
        const result = await triggerAccumulatorGeneration();
        res.json(result);
    } catch (e) {
        logger.error({ error: e }, '[API] Accumulator generation error');
        Sentry.captureException(e);
        res.status(500).json({ error: 'Accumulator generation failed', details: e.message });
    }
});

app.post('/api/admin/telegram-broadcast', adminAuth, async (req, res) => {
    try {
        logger.info('[API] Manual Telegram Broadcast Triggered via Admin');
        const result = await triggerTelegramBroadcast();
        res.json(result);
    } catch (e) {
        logger.error({ error: e }, '[API] Telegram broadcast error');
        Sentry.captureException(e);
        res.status(500).json({ error: 'Telegram broadcast failed', details: e.message });
    }
});

app.post('/api/admin/telegram-test', adminAuth, async (req, res) => {
    try {
        logger.info('[API] Telegram Test Message Triggered via Admin');
        const result = await sendTelegramTestMessage();
        res.json(result);
    } catch (e) {
        logger.error({ error: e }, '[API] Telegram test error');
        Sentry.captureException(e);
        res.status(500).json({ error: 'Telegram test failed', details: e.message });
    }
});

app.post('/api/admin/tip-of-day', adminAuth, async (req, res) => {
    try {
        logger.info('[API] Manual Tip of the Day Triggered via Admin');
        const result = await triggerTipOfTheDay();
        res.json(result);
    } catch (e) {
        logger.error({ error: e }, '[API] Tip of the Day error');
        Sentry.captureException(e);
        res.status(500).json({ error: 'Tip of the Day failed', details: e.message });
    }
});

// ── Quant Pipeline Endpoints ───────────────────────────────────────────────────

/** Trigger quant statistical pipeline (no AI/LLM — pure models) */
app.post('/api/admin/trigger-quant', adminAuth, async (req, res) => {
    try {
        const { date, dryRun } = req.body || {};
        
        // Validate date format if provided (YYYY-MM-DD)
        if (date !== null && date !== undefined && date !== '') {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
            }
        }
        
        logger.info({ date: date || 'today', dryRun: !!dryRun }, '[API] Quant Pipeline triggered');
        const result = await triggerQuantPipeline(date || null, !!dryRun);
        res.json(result);
    } catch (e) {
        logger.error({ error: e }, '[API] Quant trigger error');
        Sentry.captureException(e);
        res.status(500).json({ error: 'Quant pipeline failed', details: e.message });
    }
});

/** Grade yesterday's (or custom date) quant predictions */
app.post('/api/admin/grade-quant', adminAuth, async (req, res) => {
    try {
        const { date } = req.body || {};
        
        // Validate date format if provided (YYYY-MM-DD)
        if (date !== null && date !== undefined && date !== '') {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
            }
        }
        
        logger.info({ date: date || 'yesterday' }, '[API] Quant Grading triggered');
        const result = await triggerQuantGrading(date || null);
        res.json(result);
    } catch (e) {
        logger.error({ error: e }, '[API] Quant grading error');
        Sentry.captureException(e);
        res.status(500).json({ error: 'Quant grading failed', details: e.message });
    }
});

/** Recompute and save quant performance analytics */
app.post('/api/admin/quant-performance', adminAuth, async (req, res) => {
    try {
        logger.info('[API] Quant Performance computation triggered');
        const result = await triggerQuantPerformance();
        res.json(result);
    } catch (e) {
        logger.error({ error: e }, '[API] Quant performance error');
        Sentry.captureException(e);
        res.status(500).json({ error: 'Quant performance failed', details: e.message });
    }
});

// ── OpenAI API Key (declared here so it's available to both test-openai and the proxy below) ───
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    logger.warn('[API] OPENAI_API_KEY not set — OpenAI proxy will return 500 until configured.');
}

// Test OpenAI connection — used by the Admin panel "Test OpenAI" button
app.post('/api/admin/test-openai', adminAuth, async (req, res) => {
    const start = Date.now();
    try {
        if (!OPENAI_API_KEY) {
            return res.status(200).json({ status: 'error', latency: 0, model: 'gpt-4o-mini', message: 'OPENAI_API_KEY is not configured on the server.' });
        }

        const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

        const response = await openai.responses.create({
            model: 'gpt-4o-mini',
            input: [{ role: 'user', content: 'Say "OpenAI connection OK" and nothing else.' }],
            temperature: 0,
        });

        const latency = Date.now() - start;
        const text = response.output_text ||
            response.output?.find(o => o.type === 'message')?.content?.find(c => c.type === 'output_text')?.text || 'Response received';

        res.json({ status: 'success', latency, model: 'gpt-4o-mini', message: text.trim() });
    } catch (error) {
        const latency = Date.now() - start;
        console.error('[API test-openai] Error:', error.message);
        let msg = error.message || 'Unknown error';
        if (error.status === 401) msg = 'Unauthorized (401) — Invalid API Key';
        else if (error.status === 429) msg = 'Rate Limited (429) — Quota exceeded';
        res.json({ status: 'error', latency, model: 'gpt-4o-mini', message: msg });
    }
});


// ══════════════════════════════════════════════════════════════════════
// OPENAI API PROXY
// Keeps OPENAI_API_KEY server-side only. Same pattern as Gemini proxy.
// ══════════════════════════════════════════════════════════════════════

// Re-use key already declared above; just set up the rate limiter and proxy endpoint

const openaiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many OpenAI requests from this IP, please try again in 15 minutes' }
});

app.post('/api/openai/generate', adminAuth, openaiLimiter, async (req, res) => {
    try {
        if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not configured on server' });

        const { model = 'gpt-4o-mini', messages, prompt, temperature = 0.3, useWebSearch = false } = req.body;

        const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

        // Build input: support both {messages} array and single {prompt} string
        const input = messages || [{ role: 'user', content: prompt || '' }];
        const tools = useWebSearch ? [{ type: 'web_search_preview' }] : undefined;

        const response = await openai.responses.create({
            model,
            input,
            temperature,
            ...(tools && { tools }),
        });

        const text = response.output_text ||
            response.output?.find(o => o.type === 'message')?.content?.find(c => c.type === 'output_text')?.text || '';

        res.json({ text });
    } catch (error) {
        console.error('OpenAI Proxy Error:', error.message);
        const status = error.status || 500;
        res.status(status).json({ error: 'OpenAI request failed', details: error.message, status });
    }
});

// ══════════════════════════════════════════════════════════════════════
// FAPSHI PAYMENT PROXY
// Keeps FAPSHI_USER_TOKEN and FAPSHI_API_KEY server-side only.
// Legacy /api/fapshi/* routes are retired; active payment routes live under /api/payments/fapshi/*.
// ══════════════════════════════════════════════════════════════════════

const fapshiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many payment requests from this IP, please try again in 15 minutes' }
});

const FAPSHI_API_BASE = 'https://live.fapshi.com';

function safeEqualString(a = '', b = '') {
    const aBuf = Buffer.from(String(a));
    const bBuf = Buffer.from(String(b));
    return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

function verifySelarWebhook(req) {
    const secret = process.env.SELAR_WEBHOOK_SECRET;
    if (!secret) return { ok: false, status: 503, error: 'Selar webhook secret is not configured' };

    const tokenHeader =
        req.headers['x-selar-webhook-secret'] ||
        req.headers['x-webhook-secret'] ||
        req.headers['x-selar-secret'];
    if (tokenHeader && safeEqualString(tokenHeader, secret)) return { ok: true };

    const signatureHeader = req.headers['x-selar-signature'] || req.headers['x-webhook-signature'];
    if (signatureHeader) {
        const signature = String(signatureHeader).replace(/^sha256=/i, '');
        // Use raw body bytes for HMAC verification (Buffer from express.raw, or string from JSON.parse)
        let payload;
        if (Buffer.isBuffer(req.body)) {
            payload = req.body;
        } else if (typeof req.body === 'string') {
            payload = req.body;
        } else {
            payload = JSON.stringify(req.body || {});
        }
        const expected = createHmac('sha256', secret).update(payload).digest('hex');
        if (safeEqualString(signature, expected)) return { ok: true };
    }

    return { ok: false, status: 401, error: 'Invalid Selar webhook signature' };
}

function parseSelarWebhookBody(req) {
    if (Buffer.isBuffer(req.body)) {
        if (req.body.length === 0) return {};
        return JSON.parse(req.body.toString('utf8'));
    }
    if (typeof req.body === 'string') {
        return req.body ? JSON.parse(req.body) : {};
    }
    return req.body || {};
}

// ══════════════════════════════════════════════════════════════════════
// SERVER-SIDE PAYMENT FULFILLMENT
// VIP activation happens exclusively through Firebase Admin SDK.
// Browser initiates payment, backend verifies and grants VIP.
// ══════════════════════════════════════════════════════════════════════

app.post('/api/payments/fapshi/initiate', requireFirebaseUser, fapshiLimiter, async (req, res) => {
    try {
        if (!process.env.FAPSHI_USER_TOKEN || !process.env.FAPSHI_API_KEY) {
            return res.status(503).json({ error: 'Fapshi payment gateway is not configured on this server.' });
        }
        const { plan, email, redirectUrl } = req.body || {};
        const cfg = assertValidPlan(plan);
        const uid = req.firebaseUser.uid;

        const response = await fetch(`${FAPSHI_API_BASE}/initiate-pay`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apiuser': process.env.FAPSHI_USER_TOKEN,
                'apikey': process.env.FAPSHI_API_KEY,
            },
            body: JSON.stringify({
                amount: cfg.amount,
                email: email || req.firebaseUser.email,
                externalId: `${uid}_${Date.now()}`,
                redirectUrl,
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json({ error: data.message || 'Fapshi initiation failed' });
        }

        await admin.firestore().collection('payment_intents').doc(`fapshi_${data.transId}`).set({
            uid,
            provider: 'fapshi',
            transId: data.transId,
            plan,
            amount: cfg.amount,
            status: 'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.json({ link: data.link, transId: data.transId });
    } catch (e) {
        logger.error({ error: e }, '[Payments] Fapshi initiate error');
        res.status(e.status || 500).json({ error: e.message || 'Payment initiation failed' });
    }
});

app.post('/api/payments/fapshi/verify', requireFirebaseUser, fapshiLimiter, async (req, res) => {
    try {
        if (!process.env.FAPSHI_USER_TOKEN || !process.env.FAPSHI_API_KEY) {
            return res.status(503).json({ error: 'Fapshi payment gateway is not configured on this server.' });
        }
        const { transId } = req.body || {};
        if (!transId || !/^[a-zA-Z0-9_-]+$/.test(transId)) {
            return res.status(400).json({ error: 'Invalid transId' });
        }

        const db = admin.firestore();
        const intentRef = db.collection('payment_intents').doc(`fapshi_${transId}`);
        const intentSnap = await intentRef.get();
        if (!intentSnap.exists) return res.status(404).json({ error: 'Payment intent not found' });

        const intent = intentSnap.data();
        if (intent.uid !== req.firebaseUser.uid) {
            return res.status(403).json({ error: 'Payment intent does not belong to this user' });
        }

        const response = await fetch(`${FAPSHI_API_BASE}/payment-status/${transId}`, {
            headers: {
                'apiuser': process.env.FAPSHI_USER_TOKEN,
                'apikey': process.env.FAPSHI_API_KEY,
            },
        });

        const data = await response.json();
        if (!response.ok) return res.status(response.status).json({ status: 'UNKNOWN' });
        if (data.status !== 'SUCCESSFUL') return res.json({ status: data.status });

        const paidAmount = Number(data.amount || 0);
        const paidPlan = inferPlanFromAmount(paidAmount);
        if (!paidPlan || paidPlan !== intent.plan) {
            return res.status(400).json({ error: 'Payment amount does not match selected plan' });
        }

        const result = await fulfillVipPayment({
            uid: intent.uid,
            provider: 'fapshi',
            transactionId: transId,
            plan: intent.plan,
            amount: paidAmount,
            raw: data,
        });

        await intentRef.set({ status: 'fulfilled', verifiedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        res.json({ status: 'SUCCESSFUL', ...result });
    } catch (e) {
        logger.error({ error: e }, '[Payments] Fapshi verify error');
        res.status(e.status || 500).json({ error: e.message || 'Payment verification failed' });
    }
});

app.post('/api/payments/selar/initiate', requireFirebaseUser, async (req, res) => {
    try {
        const { plan, email } = req.body || {};
        const cfg = assertValidPlan(plan);
        const productLink = process.env[`SELAR_${plan.toUpperCase()}_LINK`];
        if (!productLink) return res.status(503).json({ error: 'Selar product link not configured' });

        const reference = `VAN_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

        await admin.firestore().collection('selar_pending').doc(reference).set({
            uid: req.firebaseUser.uid,
            email: email || req.firebaseUser.email,
            plan,
            amount: cfg.amount,
            reference,
            used: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        const returnUrl = `${process.env.FRONTEND_URL}/?selar_ref=${encodeURIComponent(reference)}`;
        const checkoutUrl = `${productLink}?email=${encodeURIComponent(email || req.firebaseUser.email)}&redirect=${encodeURIComponent(returnUrl)}`;
        res.json({ checkoutUrl, reference });
    } catch (e) {
        logger.error({ error: e }, '[Payments] Selar initiate error');
        res.status(e.status || 500).json({ error: e.message || 'Selar initiation failed' });
    }
});

app.post('/api/payments/selar/verify', requireFirebaseUser, async (req, res) => {
    try {
        const { reference } = req.body || {};
        if (!reference || !/^VAN_[a-f0-9]{24}$/i.test(reference)) {
            return res.status(400).json({ error: 'Invalid reference' });
        }

        const db = admin.firestore();
        const ref = db.collection('selar_pending').doc(reference);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Pending Selar payment not found' });

        const pending = snap.data();
        if (pending.uid !== req.firebaseUser.uid) {
            return res.status(403).json({ error: 'Payment does not belong to this user' });
        }

        if (pending.used !== true) {
            return res.status(202).json({ status: 'PENDING', message: 'Waiting for Selar webhook/payment confirmation' });
        }

        res.json({ status: 'SUCCESSFUL' });
    } catch (e) {
        logger.error({ error: e }, '[Payments] Selar verify error');
        res.status(e.status || 500).json({ error: e.message || 'Selar verification failed' });
    }
});

app.post('/api/payments/selar/webhook', async (req, res) => {
    try {
        const authResult = verifySelarWebhook(req);
        if (!authResult.ok) {
            return res.status(authResult.status).json({ error: authResult.error });
        }

        const payload = parseSelarWebhookBody(req);
        const { reference, status, amount } = payload;
        if (!reference || !/^VAN_[a-f0-9]{24}$/i.test(reference)) {
            return res.status(400).json({ error: 'Invalid reference' });
        }
        if (status !== 'successful') return res.status(202).json({ ignored: true });

        const db = admin.firestore();
        const ref = db.collection('selar_pending').doc(reference);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Pending token not found' });

        const pending = snap.data();
        const expected = assertValidPlan(pending.plan);
        const paidAmount = Number(String(amount ?? '').replace(/[^\d.]/g, ''));
        if (paidAmount !== expected.amount) {
            logger.warn({ reference, paidAmount, expectedAmount: expected.amount }, '[Payments] Selar webhook amount mismatch');
            return res.status(400).json({ error: 'Payment amount does not match selected plan' });
        }

        await fulfillVipPayment({
            uid: pending.uid,
            provider: 'selar',
            transactionId: reference,
            plan: pending.plan,
            amount: paidAmount,
            raw: payload,
        });

        await ref.set({
            used: true,
            verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        res.json({ ok: true });
    } catch (e) {
        logger.error({ error: e }, '[Payments] Selar webhook error');
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// ══════════════════════════════════════════════════════════════════════
// REVENUECAT WEBHOOK — Android Google Play subscriptions
// ══════════════════════════════════════════════════════════════════════
const REVENUECAT_WEBHOOK_SECRET = process.env.REVENUECAT_WEBHOOK_SECRET;

app.post('/api/payments/revenuecat/webhook', express.json({ limit: '1mb' }), async (req, res) => {
    try {
        if (!REVENUECAT_WEBHOOK_SECRET) {
            logger.error('[RevenueCat] REVENUECAT_WEBHOOK_SECRET is not configured — webhook disabled');
            return res.status(503).json({ error: 'RevenueCat webhook is not configured on this server.' });
        }
        const authHeader = req.headers['authorization'] || '';
        if (!authHeader || authHeader !== `Bearer ${REVENUECAT_WEBHOOK_SECRET}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const event = req.body?.event;
        if (!event) return res.status(400).json({ error: 'Missing event' });

        const validEvents = ['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE'];
        if (!validEvents.includes(event.type)) {
            return res.status(200).json({ ignored: true, reason: `Event type ${event.type} not processed` });
        }

        const appUserId = event.app_user_id;
        const productId = event.product_id || '';
        if (!appUserId || !productId) {
            return res.status(400).json({ error: 'Missing app_user_id or product_id' });
        }

        const plan = productId.includes('annual') ? 'annual'
            : productId.includes('quarterly') ? 'quarterly'
            : productId.includes('monthly') ? 'monthly'
            : productId.includes('weekly') ? 'weekly'
            : productId.includes('daily') ? 'daily'
            : null;

        if (!plan) {
            logger.warn({ productId }, '[RevenueCat] Unknown product ID');
            return res.status(200).json({ ignored: true, reason: 'Unknown product' });
        }

        const db = admin.firestore();
        const userQuery = await db.collection('profiles')
            .where('revenuecatId', '==', appUserId)
            .limit(1)
            .get();

        if (userQuery.empty) {
            logger.warn({ appUserId, productId }, '[RevenueCat] No user found for RevenueCat ID');
            return res.status(404).json({ error: 'User not found' });
        }

        const userDoc = userQuery.docs[0];
        const txId = `rc_${event.id || Date.now()}`;

        await fulfillVipPayment({
            uid: userDoc.id,
            provider: 'revenuecat',
            transactionId: txId,
            plan,
            amount: 0,
            raw: req.body,
        });

        logger.info({ uid: userDoc.id, plan, productId }, '[RevenueCat] VIP fulfilled via webhook');
        res.json({ ok: true });
    } catch (e) {
        logger.error({ error: e }, '[RevenueCat] Webhook error');
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// ══════════════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════════
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;

app.get('/api/push/vapid-key', (req, res) => {
    if (!VAPID_PUBLIC_KEY) {
        logger.warn('[Server] VAPID_PUBLIC_KEY is not set — push notifications are disabled');
        return res.status(503).json({ error: 'Push notifications are not configured on this server.' });
    }
    res.json({ publicKey: VAPID_PUBLIC_KEY });
});

const pushLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many push subscription requests, please try again in 1 minute' }
});

app.post('/api/push/subscribe', pushLimiter, requireFirebaseUser, async (req, res) => {
    try {
        const subscription = req.body;
        if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
            return res.status(400).json({ error: 'Invalid subscription object' });
        }

        if (admin.apps.length > 0) {
            const uid = req.firebaseUser.uid;
            const endpointHash = createHash('sha256').update(subscription.endpoint).digest('hex').substring(0, 16);
            const subId = `${uid}_${endpointHash}`;
            await admin.firestore().collection('push_subscriptions').doc(subId).set({
                subscription,
                uid,
                platform: 'web',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        res.status(201).json({ success: true });
    } catch (e) {
        logger.error({ error: e }, 'Push subscription error');
        res.status(500).json({ error: 'Failed to save subscription' });
    }
});

// FCM token registration (Android/iOS native push via Capacitor)
app.post('/api/push/register-fcm', pushLimiter, requireFirebaseUser, async (req, res) => {
    try {
        const { token, platform = 'android' } = req.body || {};
        if (!token || typeof token !== 'string' || token.length < 20) {
            return res.status(400).json({ error: 'Invalid FCM token' });
        }

        if (admin.apps.length > 0) {
            const uid = req.firebaseUser.uid;
            const tokenHash = createHash('sha256').update(token).digest('hex').substring(0, 16);
            const subId = `${uid}_fcm_${tokenHash}`;
            await admin.firestore().collection('push_subscriptions').doc(subId).set({
                fcmToken: token,
                uid,
                platform,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        res.status(201).json({ success: true });
    } catch (e) {
        logger.error({ error: e }, 'FCM registration error');
        res.status(500).json({ error: 'Failed to register FCM token' });
    }
});

// ══════════════════════════════════════════════════════════════════════
// SERVER-SIDE RENDERING & SEO (Static + Dynamic Routes)
// ══════════════════════════════════════════════════════════════════════

// Module-level base URL — used by sitemap AND SSR handler
const baseUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, '') : 'https://vantageai.online';

// 1. Serve static files from the React dist directory FIRST (except index.html)
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath, { index: false }));

// 2. Dynamic Sitemap Generator
app.get('/sitemap.xml', async (req, res) => {
    try {
        res.header('Content-Type', 'application/xml');

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

        // Add static routes
        const staticRoutes = ['/', '/blog', '/VIP', '/FreePicks', '/Kelly', '/Guide'];
        staticRoutes.forEach(route => {
            xml += `  <url>\n    <loc>${baseUrl}${route}</loc>\n    <changefreq>daily</changefreq>\n    <priority>${route === '/' ? '1.0' : route === '/blog' ? '0.9' : '0.8'}</priority>\n  </url>\n`;
        });

        if (admin.apps.length > 0) {
            // Get up to 60 most recent prediction days
            const predictionSnap = await admin.firestore()
                .collection('daily_predictions')
                .orderBy('updatedAt', 'desc')
                .limit(60)
                .get();

            predictionSnap.forEach(doc => {
                const dateKey = doc.id;
                // Ensure it's a valid date key format YYYY-MM-DD
                if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
                    xml += `  <url>\n    <loc>${baseUrl}/predictions/${dateKey}</loc>\n    <changefreq>never</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
                }
            });

            // Get all blog posts for SEO
            const blogSnap = await admin.firestore()
                .collection('daily_blogs')
                .orderBy('generatedAt', 'desc')
                .limit(100)
                .get();

            blogSnap.forEach(doc => {
                const dateKey = doc.id;
                if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
                    xml += `  <url>\n    <loc>${baseUrl}/blog/${dateKey}</loc>\n    <changefreq>never</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
                }
            });
        }

        xml += '</urlset>';
        res.send(xml);
    } catch (err) {
        console.error('Sitemap generation error:', err);
        res.status(500).end();
    }
});

// 3. Catch-all for rendering HTML
app.use(async (req, res, next) => {
    if (req.method !== 'GET') return next();
    try {
        const indexPath = path.join(distPath, 'index.html');
        // Check if dist exists (important for dev environments before build)
        if (!fs.existsSync(indexPath)) {
            return res.status(404).send('Vantage AI Frontend build not found. Please run npm run build.');
        }

        let html = "";
        try {
            // Asynchronous read to prevent event loop blocking
            html = await fs.promises.readFile(indexPath, 'utf-8');
        } catch (err) {
            return res.status(404).send('Vantage AI Frontend build not found. Please run npm run build.');
        }

        // Fetch Admin Settings for Google Site Verification
        let googleTag = '';
        try {
            if (admin.apps.length > 0) {
                const settingsDoc = await admin.firestore().collection('settings').doc('app').get();
                if (settingsDoc.exists) {
                    googleTag = settingsDoc.data()?.googleSiteVerificationTag || '';
                }
            }
        } catch (dbErr) {
            console.warn('Could not fetch app settings for GSC tag:', dbErr.message);
        }

        // Inject GSC Verification Tag globally
        if (googleTag) {
            html = html.replace('<!-- GOOGLE_VERIFICATION -->', googleTag);
        } else {
            html = html.replace('<!-- GOOGLE_VERIFICATION -->', ''); // Clean up
        }

        // --- SPECIFIC ROUTE: /predictions/:date ---
        const predictionsMatch = req.path.match(/^\/predictions\/(\d{4}-\d{2}-\d{2})$/);

        if (predictionsMatch && admin.apps.length > 0) {
            const dateKey = predictionsMatch[1];

            // Try to fetch predictions and blog for this date
            const [predDoc, blogDoc] = await Promise.all([
                admin.firestore().collection('daily_predictions').doc(dateKey).get(),
                admin.firestore().collection('daily_blogs').doc(dateKey).get()
            ]);

            if (predDoc.exists) {
                const matchCount = predDoc.data()?.matches?.length || 0;
                const matches = predDoc.data()?.matches || [];

                // Construct a dynamic title and description
                const title = `Pronostics Football ${dateKey} | Vantage AI (${matchCount} Matchs Analysés)`;

                // Use the explicit AI Blog excerpt if available, otherwise fallback to generic text
                let description = `Découvrez nos ${matchCount} pronostics exclusifs de football et de basketball pour le ${dateKey}, générés par le modèle exclusif de Vantage AI.`;
                let blogContent = '';

                if (blogDoc.exists) {
                    description = blogDoc.data().excerpt || description;
                    blogContent = blogDoc.data().content || '';
                }

                // Inject SEO Tags
                const seoTags = `
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${baseUrl}/predictions/${dateKey}" />
                `;

                // Replace the default title and placeholders
                html = html.replace(/<title>.*?<\/title>/, seoTags);

// Inject the raw HTML blog into a hidden NOSCRIPT or hidden div so crawlers index it
                // but React can mount cleanly around it (React replaces the root div content anyway).
                // We must put it OUTSIDE of `<div id="root"></div>` to prevent React hydration errors.
                if (blogContent) {
                    // Use sanitize-html for XSS-safe blog content injection
                    const sanitized = sanitizeHtml(blogContent, {
                        allowedTags: ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'br', 'span', 'a'],
                        allowedAttributes: {
                            'a': ['href', 'target'],
                            'span': ['style'],
                        },
                        // Force all URLs to use https protocol
                        transformTags: {
                            'a': (tagName, attribs) => {
                                const href = attribs.href || '';
                                if (href && !href.match(/^https?:\/\//)) {
                                    return { tagName, attribs: { ...attribs, href: '#' } };
                                }
                                return { tagName, attribs };
                            },
                        },
                    });
                    const blogInjection = `
                    <div id="vantage-seo-content" style="display:none;" aria-hidden="true">
                        ${sanitized}
                    </div>
                    <!-- REACT_ROOT -->
                    `;
                    html = html.replace('<!-- REACT_ROOT -->', blogInjection);
                }
            }
        }

        res.send(html);
    } catch (err) {
        logger.error({ error: err }, 'SSR rendering error');
        Sentry.captureException(err);
        res.status(500).send('Server Error rendering page.');
    }
});

// ── Sentry Error Handler ──────────────────────────────────────────────────────
// This must be last before app.listen
if (SENTRY_DSN && typeof Sentry.setupExpressErrorHandler === 'function') {
    Sentry.setupExpressErrorHandler(app);
}

// Global error handler (catches all unhandled errors)
app.use((err, req, res, next) => {
    logger.error({ error: err, method: req.method, url: req.url }, 'Unhandled error');
    Sentry.captureException(err);
    res.status(err.status || 500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
    });
});

// Start server
const server = app.listen(PORT, () => {
    logger.info({ port: PORT, origins: allowedOrigins }, '🚀 Backend proxy server running');
});

import admin from 'firebase-admin';
import pino from 'pino';

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
});

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';

async function callGroq(messages, temperature = 0.3, maxTokens = 50) {
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

export async function generateDailyTipFromPredictions(predictions) {
    if (!predictions || predictions.length === 0) return null;
    try {
        const bestPick = predictions.filter(p => p.vault_eligible && p.odds > 0)
            .sort((a, b) => (b.expected_value || 0) - (a.expected_value || 0))[0];
        if (!bestPick) return null;
        const prompt = `As a betting expert, give a ONE sentence tip for today focusing on this top pick:\n\nMatch: ${bestPick.home_team} vs ${bestPick.away_team} (${bestPick.league})\nPick: ${bestPick.bet_type} @ ${bestPick.odds}\nEV: ${((bestPick.expected_value || 0) * 100).toFixed(1)}%\n\nMake it punchy and actionable. Max 20 words. Example: "Back Over 2.5 at Anfield - Liverpool's home games average 3.2 goals."`;
        const tip = await callGroq([{ role: 'user', content: prompt }], 0.3, 50);
        return {
            tip,
            match: `${bestPick.home_team} vs ${bestPick.away_team}`,
            pick: bestPick.bet_type,
            odds: bestPick.odds,
            ev: ((bestPick.expected_value || 0) * 100).toFixed(1),
            generatedAt: new Date().toISOString()
        };
    } catch (e) {
        logger.error(`[PushService] Daily tip generation failed: ${e.message}`);
        return null;
    }
}

export async function sendPushToUser(uid, notification) {
    if (!admin.apps.length) {
        logger.warn('[PushService] Firebase not initialized');
        return { success: false, error: 'Firebase not initialized' };
    }

    try {
        const db = admin.firestore();
        const snapshot = await db.collection('push_subscriptions')
            .where('uid', '==', uid)
            .get();

        if (snapshot.empty) {
            return { success: false, error: 'No subscriptions found' };
        }

        let sentCount = 0;
        let failCount = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            
            if (data.fcmToken) {
                try {
                    await admin.messaging().send({
                        token: data.fcmToken,
                        notification: {
                            title: notification.title,
                            body: notification.body,
                        },
                        data: notification.data || {},
                        webpush: {
                            fcm_options: { link: notification.url || '/' }
                        }
                    });
                    sentCount++;
                } catch (err) {
                    logger.warn(`[PushService] FCM send failed for ${doc.id}: ${err.message}`);
                    if (err.message.includes('invalid registration token') || err.message.includes('not registered')) {
                        await doc.ref.delete();
                    }
                    failCount++;
                }
            }
        }

        logger.info(`[PushService] Sent push to ${uid}: ${sentCount} success, ${failCount} failed`);
        return { success: true, sentCount, failCount };
    } catch (e) {
        logger.error(`[PushService] Send to user ${uid} failed: ${e.message}`);
        return { success: false, error: e.message };
    }
}

export async function broadcastPush(notification) {
    if (!admin.apps.length) {
        logger.warn('[PushService] Firebase not initialized');
        return { success: false, error: 'Firebase not initialized' };
    }

    try {
        const db = admin.firestore();
        
        const fcmSnapshot = await db.collection('push_subscriptions')
            .where('platform', 'in', ['android', 'ios', 'web'])
            .get();

        if (fcmSnapshot.empty) {
            logger.info('[PushService] No FCM subscriptions found');
            return { success: true, sentCount: 0 };
        }

        const tokens = [];
        const invalidDocIds = [];

        for (const doc of fcmSnapshot.docs) {
            const data = doc.data();
            if (data.fcmToken) {
                tokens.push(data.fcmToken);
            }
        }

        if (tokens.length === 0) {
            return { success: true, sentCount: 0 };
        }

        const message = {
            notification: {
                title: notification.title,
                body: notification.body,
            },
            data: notification.data || {},
            webpush: {
                fcm_options: { link: notification.url || '/' }
            }
        };

        const result = await admin.messaging().sendEachForMulticast({
            tokens,
            ...message,
        });

        let deleteCount = 0;
        for (const failure of result.failureList) {
            if (failure.error?.message?.includes('Invalid registration token') ||
                failure.error?.message?.includes('not registered')) {
                const docId = fcmSnapshot.docs.find(d => d.data().fcmToken === failure.token)?.id;
                if (docId) {
                    await db.collection('push_subscriptions').doc(docId).delete();
                    deleteCount++;
                }
            }
        }

        logger.info(`[PushService] Broadcast: ${result.successCount} sent, ${result.failureCount} failed, ${deleteCount} cleaned up`);
        return {
            success: true,
            sentCount: result.successCount,
            failCount: result.failureCount,
            deletedCount: deleteCount
        };
    } catch (e) {
        logger.error(`[PushService] Broadcast failed: ${e.message}`);
        return { success: false, error: e.message };
    }
}

export async function sendTipOfTheDayPush(tipData) {
    if (!tipData || !tipData.tip) {
        logger.warn('[PushService] No tip data provided');
        return { success: false, error: 'No tip data' };
    }

    const notification = {
        title: '💡 Tip of the Day',
        body: tipData.tip,
        data: {
            type: 'tip_of_day',
            match: tipData.match || '',
            pick: tipData.pick || '',
            ev: tipData.ev || '',
        },
        url: '/?tab=predictions'
    };

    return broadcastPush(notification);
}


import { db, auth } from "../firebaseConfig";
import { doc, setDoc, increment, getDoc } from "firebase/firestore";

const getLagosTodayKey = (): string =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });

const DEVICE_ID_KEY = 'vantage_device_id';

const getDeviceId = (): string => {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
        id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
};

const detectPlatform = (): 'app' | 'web' => {
    try {
        if (window.location.protocol === 'capacitor:') return 'app';
        if (window.location.protocol === 'android:') return 'app';
        const ua = navigator.userAgent.toLowerCase();
        if (ua.includes('capacitor') || ua.includes('vantageai.app')) return 'app';
        return 'web';
    } catch {
        return 'web';
    }
};

const PAGE_EVENTS: Record<string, string> = {
    '/': 'home_view',
    '/vip': 'vip_view',
    '/match': 'match_view',
    '/free-picks': 'free_picks_view',
    '/concierge': 'concierge_view',
    '/kelly': 'kelly_view',
    '/guide': 'guide_view',
    '/stats': 'stats_view',
    '/results': 'results_view',
    '/live': 'live_view',
    '/admin': 'admin_view',
    '/profile': 'profile_view',
    '/payment': 'payment_view',
};

const resolvePageKey = (pathname: string): string => {
    if (pathname === '/') return 'home_view';
    const clean = pathname.split('?')[0];
    for (const [prefix, key] of Object.entries(PAGE_EVENTS)) {
        if (prefix !== '/' && clean.startsWith(prefix)) return key;
    }
    return 'other_view';
};

const writeDailyMetric = async (dateKey: string, field: string, by: number = 1) => {
    try {
        const ref = doc(db, 'analytics_daily', dateKey);
        await setDoc(ref, {
            date: dateKey,
            [field]: increment(by),
        }, { merge: true });
    } catch (e) {
        console.warn('[Analytics] write failed:', e);
    }
};

export const trackPageView = (pathname: string) => {
    try {
        const uid = auth.currentUser?.uid || getDeviceId();
        const key = resolvePageKey(pathname);
        const platform = detectPlatform();
        const dateKey = getLagosTodayKey();
        writeDailyMetric(dateKey, 'total_page_views');
        writeDailyMetric(dateKey, `page_${key}`);
        writeDailyMetric(dateKey, `platform_${platform}`);
        const userRef = doc(db, 'analytics_daily_users', `${dateKey}_${uid}`);
        setDoc(userRef, { date: dateKey, uid, platform, last_seen: new Date().toISOString() }, { merge: true })
            .catch(() => {});
    } catch (e) {
        console.warn('[Analytics] page view failed:', e);
    }
};

export const trackEvent = (eventName: string, metadata: Record<string, any> = {}) => {
    try {
        const uid = auth.currentUser?.uid || getDeviceId();
        const platform = detectPlatform();
        const dateKey = getLagosTodayKey();
        writeDailyMetric(dateKey, `event_${eventName}`);
        writeDailyMetric(dateKey, `platform_${platform}`);
        writeDailyMetric(dateKey, 'total_events');
        const eventRef = doc(db, 'analytics_events', `${dateKey}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`);
        setDoc(eventRef, {
            date: dateKey,
            uid,
            platform,
            event: eventName,
            path: window.location.pathname,
            metadata,
            timestamp: new Date().toISOString(),
        }).catch(() => {});
    } catch (e) {
        console.warn('[Analytics] event failed:', e);
    }
};

export interface DailyAnalytics {
    date: string;
    total_page_views: number;
    total_events: number;
    [key: string]: any;
}

export const getAnalyticsRange = async (days: number = 7): Promise<DailyAnalytics[]> => {
    const results: DailyAnalytics[] = [];
    for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateKey = d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
        const snap = await getDoc(doc(db, 'analytics_daily', dateKey));
        if (snap.exists()) {
            results.push(snap.data() as DailyAnalytics);
        } else {
            results.push({ date: dateKey, total_page_views: 0, total_events: 0 });
        }
    }
    return results;
};

export const getAnalyticsUserCount = async (dateKey?: string): Promise<number> => {
    const key = dateKey || getLagosTodayKey();
    try {
        const snap = await getDoc(doc(db, 'analytics_daily', key));
        const data = snap.data();
        return data?.active_users || 0;
    } catch {
        return 0;
    }
};

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Shield, Users, Crown, Search, RefreshCw, ChevronLeft, CheckCircle2, XCircle, ShieldAlert, Trash2, StopCircle, Ban, Lock, AlertTriangle, Database, Activity, Server, Zap, Globe, Cpu, ChevronDown, ChevronUp, Play, Coins, Wallet, BookCheck, ImagePlus, Link, Layers, Send, Bell, Gift, Save, BarChart3 } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { useAuth } from '../context/AuthContext';
import { UserProfile, NavigationTab, Match, PayoutRequest, TeamAsset } from '../types';
import { useAppContext } from '../context/AppContext';
import { useData } from '../context/DataContext';
import { testGeminiConnection, enrichMatchStats, setGeminiModel, getGeminiModel, AVAILABLE_MODELS } from '../services/gemini';
import { getFirestorePredictionsOnly, getGlobalTodayKey, getGlobalYesterdayKey, saveTodaysPredictions, saveTeamAsset, deleteTeamAsset, getAllTeamAssets, getAppSettings, saveAppSettings, getUserCount, getInternalSettings, saveInternalSettings } from '../services/db';
import { auth } from '../firebaseConfig';
import { TeamLogo } from '../components/TeamLogo';
import { adminFetch } from '../services/adminApi';

interface AdminProps {}

export const Admin: React.FC<AdminProps> = () => {
    const navigate = useNavigate();
    const { t } = useAppContext();
    const { getAllUsers, toggleUserVip, toggleUserAdmin, toggleUserBlock, getPayoutRequests, processPayout } = useAuth();
    const { clearData, generateData, generateAccumulators, generateBasketballData, isSystemGenerating, setIsSystemGenerating, isBasketballGenerating, setIsBasketballGenerating, cancelAnalysis, systemError, predictions } = useData();

    const [activeAdminTab, setActiveAdminTab] = useState<'users' | 'payouts' | 'assets' | 'bots'>('users');
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [userLastDoc, setUserLastDoc] = useState<any>(null);
    const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
    const [assets, setAssets] = useState<TeamAsset[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [selectPlanFor, setSelectPlanFor] = useState<string | null>(null);

    // Mounted Ref for Async Safety
    const isMounted = useRef(false);
    const lastCursorRef = useRef<any>(null);

    // Gemini & DB State
    const [geminiTest, setGeminiTest] = useState<{ status: 'OK' | 'ERROR'; latency: number; message: string } | null>(null);
    const [testingGemini, setTestingGemini] = useState(false);
    const [selectedModel, setSelectedModel] = useState(getGeminiModel());
    const [savedMatches, setSavedMatches] = useState<Match[] | null>(null);
    const [loadingMatches, setLoadingMatches] = useState(false);
    const [showDbInspector, setShowDbInspector] = useState(false);
    // OpenAI Test State
    const [openAITest, setOpenAITest] = useState<{ status: 'success' | 'error'; latency: number; model: string; message: string } | null>(null);
    const [testingOpenAI, setTestingOpenAI] = useState(false);
    // Admin JWT for backend API auth
    const [adminJwt, setAdminJwt] = useState<string | null>(() => sessionStorage.getItem('admin_jwt'));
    // Enrich Stats State
    const [isEnrichingStats, setIsEnrichingStats] = useState(false);
    const [enrichResult, setEnrichResult] = useState<string | null>(null);

    // Grading State
    const [isGrading, setIsGrading] = useState(false);
    const [gradingResult, setGradingResult] = useState<string | null>(null);
    const [autoGrade, setAutoGrade] = useState(() => localStorage.getItem('vantage_auto_grade') === 'true');

    // Asset Form State
    const [newTeamName, setNewTeamName] = useState('');
    const [newLogoUrl, setNewLogoUrl] = useState('');

    // WhatsApp & Bot Settings
    const [whatsappUrl, setWhatsappUrl] = useState('');
    const [telegramBotToken, setTelegramBotToken] = useState('');
    const [telegramChannelId, setTelegramChannelId] = useState('');
    const [telegramEnabled, setTelegramEnabled] = useState(false);
    const [telegramSendTime, setTelegramSendTime] = useState('08:30');
    const [telegramLastSentAt, setTelegramLastSentAt] = useState<string | null>(null);
    const [telegramLastSentCount, setTelegramLastSentCount] = useState<number | null>(null);
    const [telegramActionResult, setTelegramActionResult] = useState<string | null>(null);
    const [isTelegramActing, setIsTelegramActing] = useState(false);
    const [referralRewardDays, setReferralRewardDays] = useState(2);
    const [savingWhatsapp, setSavingWhatsapp] = useState(false);
    const [savingBotSettings, setSavingBotSettings] = useState(false);
    const [whatsappSaved, setWhatsappSaved] = useState(false);
    const [botSettingsSaved, setBotSettingsSaved] = useState(false);

    // App Download Link
    const [appDownloadUrl, setAppDownloadUrl] = useState('');
    const [savingDownloadUrl, setSavingDownloadUrl] = useState(false);
    const [downloadUrlSaved, setDownloadUrlSaved] = useState(false);

    // Auto-scheduler Settings
    // Scheduler & SEO Settings
    const [footballGenTime, setFootballGenTime] = useState('19:00');
    const [basketballGenTime, setBasketballGenTime] = useState('10:00');
    const [cricketGenTime, setCricketGenTime] = useState('10:30');
    const [gradingTime, setGradingTime] = useState('06:00');
    const [blogGenTime, setBlogGenTime] = useState('09:00');
    const [googleSiteVerificationTag, setGoogleSiteVerificationTag] = useState('');
    const [savingSchedules, setSavingSchedules] = useState(false);
    const [schedulesSaved, setSchedulesSaved] = useState(false);
    const [savingSeo, setSavingSeo] = useState(false);
    const [seoSaved, setSeoSaved] = useState(false);
    const [freePicksCount, setFreePicksCount] = useState(2);
    const [savingFreePicks, setSavingFreePicks] = useState(false);
    const [freePicksSaved, setFreePicksSaved] = useState(false);

    useEffect(() => {
        isMounted.current = true;
        // Load public settings
        getAppSettings().then(s => {
            if (!isMounted.current) return;
            if (s.telegramEnabled !== undefined) setTelegramEnabled(s.telegramEnabled);
            if (s.telegramSendTime) setTelegramSendTime(s.telegramSendTime);
            if (s.telegramLastSentAt) setTelegramLastSentAt(s.telegramLastSentAt);
            if (s.telegramLastSentCount !== undefined) setTelegramLastSentCount(s.telegramLastSentCount);
            if (s.referralRewardDays !== undefined) setReferralRewardDays(s.referralRewardDays);

            // Scheduler Times & SEO
            if (s.footballGenTime) setFootballGenTime(s.footballGenTime);
            if (s.basketballGenTime) setBasketballGenTime(s.basketballGenTime);
            if (s.cricketGenTime) setCricketGenTime(s.cricketGenTime);
            if (s.gradingTime) setGradingTime(s.gradingTime);
            if (s.blogGenTime) setBlogGenTime(s.blogGenTime);
            if (s.googleSiteVerificationTag) setGoogleSiteVerificationTag(s.googleSiteVerificationTag);
            if (s.freePicksCount !== undefined) setFreePicksCount(s.freePicksCount);
            if (s.appDownloadUrl) setAppDownloadUrl(s.appDownloadUrl);
        });
        // Load internal (secret) settings
        getInternalSettings().then(s => {
            if (!isMounted.current) return;
            if (s.whatsappGroupUrl) setWhatsappUrl(s.whatsappGroupUrl);
            if (s.telegramBotToken) setTelegramBotToken(s.telegramBotToken);
            if (s.telegramChannelId) setTelegramChannelId(s.telegramChannelId);
        });
        return () => { isMounted.current = false; };
    }, []);

    // Fetch a fresh JWT on mount using the current user's Firebase ID token.
    useEffect(() => {
        if (adminJwt) return; // Already have one (from sessionStorage)
        const backendUrl = import.meta.env.VITE_BACKEND_URL;
        if (!backendUrl) return;

        const currentUser = auth.currentUser;
        if (!currentUser) return;

        currentUser.getIdToken()
            .then(idToken =>
                fetch(`${backendUrl}/api/admin/token`, {
                    headers: { 'Authorization': `Bearer ${idToken}` },
                })
            )
            .then(r => r.json())
            .then(data => {
                if (data.token) {
                    setAdminJwt(data.token);
                    sessionStorage.setItem('admin_jwt', data.token);
                } else {
                    console.warn('[Admin] JWT request denied:', data.error);
                }
            })
            .catch(e => console.warn('[Admin] Failed to fetch admin JWT:', e));
    }, [adminJwt]);

    const handleSaveWhatsApp = async () => {
        setSavingWhatsapp(true);
        try {
            await saveInternalSettings({ whatsappGroupUrl: whatsappUrl.trim() });
            setWhatsappSaved(true);
            setTimeout(() => setWhatsappSaved(false), 3000);
        } catch (e) {
            console.error('Failed to save WhatsApp link', e);
        } finally {
            setSavingWhatsapp(false);
        }
    };

    const handleSaveBotSettings = async () => {
        setSavingBotSettings(true);
        try {
            await Promise.all([
                saveAppSettings({ telegramEnabled, telegramSendTime: telegramSendTime.trim(), referralRewardDays }),
                saveInternalSettings({ telegramBotToken: telegramBotToken.trim(), telegramChannelId: telegramChannelId.trim() }),
            ]);
            setBotSettingsSaved(true);
            setTimeout(() => setBotSettingsSaved(false), 3000);
        } catch (e) {
            console.error('Failed to save bot settings', e);
        } finally {
            setSavingBotSettings(false);
        }
    };

    const handleSaveDownloadUrl = async () => {
        setSavingDownloadUrl(true);
        try {
            await saveAppSettings({ appDownloadUrl: appDownloadUrl.trim() });
            setDownloadUrlSaved(true);
            setTimeout(() => setDownloadUrlSaved(false), 3000);
        } catch (e) {
            console.error('Failed to save download URL', e);
        } finally {
            setSavingDownloadUrl(false);
        }
    };

    const handleSaveSchedules = async () => {
        setSavingSchedules(true);
        try {
            await saveAppSettings({
                footballGenTime,
                basketballGenTime,
                cricketGenTime,
                gradingTime,
                blogGenTime
            });
            setSchedulesSaved(true);
            setTimeout(() => setSchedulesSaved(false), 3000);
        } catch (e) {
            console.error('Failed to save scheduler settings', e);
        } finally {
            setSavingSchedules(false);
        }
    };

    const handleSaveSeo = async () => {
        setSavingSeo(true);
        try {
            await saveAppSettings({
                googleSiteVerificationTag: googleSiteVerificationTag.trim()
            });
            setSeoSaved(true);
            setTimeout(() => setSeoSaved(false), 3000);
        } catch (e) {
            console.error('Failed to save SEO settings', e);
        } finally {
            setSavingSeo(false);
        }
    };

    const handleSaveFreePicks = async () => {
        setSavingFreePicks(true);
        try {
            await saveAppSettings({ freePicksCount });
            setFreePicksSaved(true);
            setTimeout(() => setFreePicksSaved(false), 3000);
        } catch (e) {
            console.error('Failed to save free picks count', e);
        } finally {
            setSavingFreePicks(false);
        }
    };

    const [userStats, setUserStats] = useState({ total: 0, vip: 0, admin: 0, free: 0 });

    const fetchUsers = useCallback(async (append = false) => {
        if (!append) setLoading(true); else setLoadingMore(true);
        try {
            const cursorDoc = append ? lastCursorRef.current : null;
            const [result, countData] = await Promise.all([
                getAllUsers(cursorDoc, 50),
                append ? Promise.resolve(null) : getUserCount()
            ]);
            const data: UserProfile[] = Array.isArray((result as any)?.users)
                ? (result as any).users
                : Array.isArray(result)
                    ? (result as any)
                    : [];
            const nextDoc = (result as any)?.lastDoc || null;
            lastCursorRef.current = nextDoc;
            if (isMounted.current) {
                if (append) {
                    setUsers(prev => [...prev, ...data]);
                } else {
                    setUsers(data);
                }
                setUserLastDoc(nextDoc);
                if (countData) {
                    setUserStats({
                        total: countData.total,
                        vip: countData.vip,
                        admin: data.filter(u => u.isAdmin).length,
                        free: countData.total - countData.vip
                    });
                }
            }
        } catch (e) {
            console.error("Failed to load users in Admin page", e);
        } finally {
            if (isMounted.current) { setLoading(false); setLoadingMore(false); }
        }
    }, [getAllUsers]);

    const loadMoreUsers = useCallback(() => {
        if (userLastDoc) fetchUsers(true);
    }, [fetchUsers, userLastDoc]);

    const fetchPayouts = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getPayoutRequests();
            if (isMounted.current) setPayouts(data);
        } catch (e) {
            console.error("Failed to load payouts", e);
        } finally {
            if (isMounted.current) setLoading(false);
        }
    }, [getPayoutRequests]);

    const fetchAssets = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getAllTeamAssets();
            if (isMounted.current) setAssets(data);
        } catch (e) {
            console.error("Failed to load assets", e);
        } finally {
            if (isMounted.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (activeAdminTab === 'users') fetchUsers();
        else if (activeAdminTab === 'payouts') fetchPayouts();
        else if (activeAdminTab === 'assets') fetchAssets();
    }, [activeAdminTab, fetchUsers, fetchPayouts, fetchAssets]);

    const handleToggleVip = async (user: UserProfile) => {
        if (processingId) return;
        
        // If revoking, do it immediately. If granting, show plan dropdown.
        if (user.isVip) {
            setProcessingId(user.uid);
            try {
                await toggleUserVip(user.uid, user.isVip);
                setUsers(prev => prev.map(u => u.uid === user.uid ? { ...u, isVip: false, vipPlan: undefined } : u));
                setUserStats(prev => ({ ...prev, vip: prev.vip - 1, free: prev.free + 1 }));
            } catch (e) { console.error(e); }
            finally { setProcessingId(null); }
        } else {
            setSelectPlanFor(user.uid);
        }
    };

    const handleSelectPlan = async (user: UserProfile, plan: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual') => {
        setSelectPlanFor(null);
        setProcessingId(user.uid);
        try {
            await toggleUserVip(user.uid, user.isVip, plan);
            setUsers(prev => prev.map(u => u.uid === user.uid ? { ...u, isVip: true, vipPlan: plan } : u));
            setUserStats(prev => ({ ...prev, vip: prev.vip + 1, free: prev.free - 1 }));
        } catch (e) { console.error(e); }
        finally { setProcessingId(null); }
    };

    const handleToggleAdmin = async (user: UserProfile) => {
        if (processingId) return;
        if (window.confirm(`Are you sure you want to ${user.isAdmin ? 'REVOKE' : 'GRANT'} Admin privileges for ${user.email}?`)) {
            setProcessingId(user.uid);
            try {
                await toggleUserAdmin(user.uid, user.isAdmin || false);
                // Optimistic update
                setUsers(prev => prev.map(u => u.uid === user.uid ? { ...u, isAdmin: !u.isAdmin } : u));
                setUserStats(prev => ({
                    ...prev,
                    admin: prev.admin + (user.isAdmin ? -1 : 1)
                }));
            } catch (e) {
                alert("Error updating user Admin status");
            } finally {
                if (isMounted.current) setProcessingId(null);
            }
        }
    };

    const handleToggleBlock = async (user: UserProfile) => {
        if (processingId) return;
        if (window.confirm(`Are you sure you want to ${user.isBlocked ? 'UNBLOCK' : 'BLOCK'} user ${user.email}?`)) {
            setProcessingId(user.uid);
            try {
                await toggleUserBlock(user.uid, user.isBlocked || false);
                setUsers(prev => prev.map(u => u.uid === user.uid ? { ...u, isBlocked: !u.isBlocked } : u));
            } catch (e) {
                alert("Error updating block status");
            } finally {
                if (isMounted.current) setProcessingId(null);
            }
        }
    };

    const handlePayout = async (payout: PayoutRequest, action: 'paid' | 'rejected') => {
        if (!window.confirm(`Are you sure you want to mark this request as ${action.toUpperCase()}?`)) return;
        setProcessingId(payout.id);
        try {
            await processPayout(payout.id, action);
            setPayouts(prev => prev.map(p => p.id === payout.id ? { ...p, status: action } : p));
        } catch (e) {
            alert("Error processing payout");
        } finally {
            if (isMounted.current) setProcessingId(null);
        }
    };

    const handleClearData = async () => {
        if (window.confirm("WARNING: This will DELETE all predictions from the database for today. Users will see an empty screen until you regenerate.")) {
            await clearData();
        }
    };

    const handleGenerateData = async () => {
        setIsSystemGenerating(true);
        try {
            const result = await adminFetch('/api/admin/trigger-quant', {
                method: 'POST',
                body: JSON.stringify({})
            });

            if (result.status === 'error') {
                alert(`❌ Quant Pipeline failed: ${result.error || result.message || 'Unknown error'}`);
            } else {
                alert(`✅ Quant Pipeline complete: ${result.generated ?? 0} predictions saved for ${result.date || 'today'}.`);
            }

        } catch (error: any) {
            console.error("Error triggering quant pipeline:", error);
            alert(`Failed to run Quant Pipeline: ${error.message}`);
        } finally {
            setIsSystemGenerating(false);
        }
    };

    const handleGenerateAccas = async () => {
        if (predictions.length === 0) {
            alert("Please generate match predictions first.");
            return;
        }
        await generateAccumulators();
    };

    // Basketball Quant Pipeline
    const [isBasketballPipelineRunning, setIsBasketballPipelineRunning] = useState(false);
    const handleGenerateBasketball = async () => {
        setIsBasketballPipelineRunning(true);
        try {
            const result = await adminFetch('/api/admin/generate-basketball', {
                method: 'POST',
                body: JSON.stringify({})
            });

            if (result.status === 'success') {
                alert(`✅ Basketball Quant Pipeline complete: ${result.generated ?? 0} picks saved for ${result.date || 'today'}.`);
            } else if (result.status === 'no_games') {
                alert(`⚠️ No NBA games found today — OpenAI fallback predictions were used instead.`);
            } else {
                alert(`❌ Basketball pipeline error: ${result.error || result.message || 'Unknown error'}`);
            }
        } catch (error: any) {
            console.error('Basketball pipeline error:', error);
            alert(`❌ Failed to run Basketball Pipeline: ${error.message}`);
        } finally {
            setIsBasketballPipelineRunning(false);
        }
    };

    const [isCricketPipelineRunning, setIsCricketPipelineRunning] = useState(false);
    const handleGenerateCricket = async () => {
        setIsCricketPipelineRunning(true);
        try {
            const result = await adminFetch('/api/admin/generate-cricket', {
                method: 'POST',
                body: JSON.stringify({})
            });

            if (result.status === 'success') {
                alert(`✅ Cricket Quant Pipeline complete: ${result.generated ?? 0} picks saved for ${result.date || 'today'}.`);
            } else {
                alert(`❌ Cricket pipeline error: ${result.error || result.message || 'Unknown error'}`);
            }
        } catch (error: any) {
            console.error('Cricket pipeline error:', error);
            alert(`❌ Failed to run Cricket Pipeline: ${error.message}`);
        } finally {
            setIsCricketPipelineRunning(false);
        }
    };

    const handleQuantPerformance = async () => {
        setIsBasketballGenerating(true);
        try {
            const result = await adminFetch('/api/admin/quant-performance', {
                method: 'POST'
            });

            if (result.status === 'success') {
                alert(`✅ Quant performance metrics updated successfully.`);
            } else {
                alert(`❌ Quant performance error: ${result.error || result.message || 'Unknown error'}`);
            }
        } catch (e) {
            alert('Failed to trigger quant performance update');
            console.error(e);
        } finally {
            setIsBasketballGenerating(false);
        }
    };

    const [gradingDate, setGradingDate] = useState('');
    const [forceRegrade, setForceRegrade] = useState(false);

    const handleGradeYesterday = useCallback(async (isAuto: boolean = false) => {
        const auto = typeof isAuto === 'boolean' ? isAuto : false;

        let targetDate = gradingDate;
        if (!targetDate) {
            targetDate = getGlobalYesterdayKey();
        }

        if (!auto && !window.confirm(`Start Quant Grading for ${targetDate}?`)) return;

        if (isMounted.current) {
            setIsGrading(true);
            setGradingResult(auto ? `Auto-grading ${targetDate}...` : `Running Quant Grading for ${targetDate}...`);
        }

        try {
            const res = await adminFetch('/api/admin/grade-quant', {
                method: 'POST',
                body: JSON.stringify({ date: targetDate })
            });

            if (isMounted.current) {
                const resultMsg = res.status === 'success' || res.graded !== undefined
                    ? `✅ Quant Graded ${res.graded ?? 0}/${res.total ?? 0} bets`
                    : `Response: ${res.message || res.error || JSON.stringify(res)}`;
                setGradingResult(resultMsg);
                if (!auto) alert(resultMsg);
            }
        } catch (e: any) {
            if (isMounted.current) {
                const errorMsg = `Error: ${e.message}`;
                setGradingResult(errorMsg);
                console.error("Quant Grading failed", e);
                if (!auto) alert(errorMsg);
            }
        } finally {
            if (isMounted.current) setIsGrading(false);
        }
    }, [gradingDate]);

    const toggleAutoGrade = () => {
        const newValue = !autoGrade;
        setAutoGrade(newValue);
        localStorage.setItem('vantage_auto_grade', String(newValue));
    };

    useEffect(() => {
        if (autoGrade) {
            handleGradeYesterday(true);
        }
    }, [autoGrade, handleGradeYesterday]);

    const runGeminiTest = async () => {
        setTestingGemini(true);
        try {
            const result = await testGeminiConnection();
            if (isMounted.current) setGeminiTest(result);
        } catch (e) {
            console.error("Gemini Test Failed", e);
        } finally {
            if (isMounted.current) setTestingGemini(false);
        }
    };

    const runOpenAITest = async () => {
        setTestingOpenAI(true);
        try {
            const data = await adminFetch('/api/admin/test-openai', {
                method: 'POST'
            });
            if (isMounted.current) setOpenAITest(data);
        } catch (e: any) {
            if (isMounted.current) setOpenAITest({ status: 'error', latency: 0, model: 'gpt-4o-mini', message: e.message });
        } finally {
            if (isMounted.current) setTestingOpenAI(false);
        }
    };

    const handleEnrichStats = async () => {
        const todayKey = getGlobalTodayKey();
        const existing = await getFirestorePredictionsOnly();
        if (!existing || existing.length === 0) {
            alert('No predictions found for today. Generate football predictions first.');
            return;
        }
        setIsEnrichingStats(true);
        setEnrichResult('Enriching stats via Gemini + Google Search...');
        try {
            const enriched = await enrichMatchStats(existing);
            await saveTodaysPredictions(enriched);
            if (isMounted.current) setEnrichResult(`✅ Enriched ${enriched.length} matches with H2H & team stats.`);
        } catch (e: any) {
            if (isMounted.current) setEnrichResult(`❌ Enrichment failed: ${e.message}`);
        } finally {
            if (isMounted.current) setIsEnrichingStats(false);
        }
    };

    const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newModel = e.target.value;
        setSelectedModel(newModel);
        setGeminiModel(newModel);
    };

    const inspectDatabase = async () => {
        if (showDbInspector && savedMatches) {
            setShowDbInspector(false);
            return;
        }
        setLoadingMatches(true);
        setShowDbInspector(true);
        try {
            const matches = await getFirestorePredictionsOnly();
            if (isMounted.current) setSavedMatches(matches || []);
        } catch (e) {
            console.error("DB Inspect Error", e);
        } finally {
            if (isMounted.current) setLoadingMatches(false);
        }
    };

    const handleSaveAsset = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTeamName || !newLogoUrl) return;

        setProcessingId('new-asset');
        try {
            await saveTeamAsset(newTeamName, newLogoUrl);
            setNewTeamName('');
            setNewLogoUrl('');
            fetchAssets();
        } catch (e) {
            alert("Error saving asset");
        } finally {
            setProcessingId(null);
        }
    };

    const handleDeleteAsset = async (id: string) => {
        if (!window.confirm("Delete this team asset?")) return;
        setProcessingId(id);
        try {
            await deleteTeamAsset(id);
            setAssets(prev => prev.filter(a => a.id !== id));
        } catch (e) {
            alert("Error deleting asset");
        } finally {
            setProcessingId(null);
        }
    };

    const filteredUsers = users.filter(u => {
        const s = searchTerm.toLowerCase();
        const email = u.email ? u.email.toLowerCase() : '';
        const name = u.displayName ? u.displayName.toLowerCase() : '';
        return email.includes(s) || name.includes(s);
    });

    const stats = userStats;

    return (
        <div className="space-y-6 pb-24">
            {/* Header */}
            <div className="flex items-center space-x-3">
                <button
                    onClick={() => navigate('/profile')}
                    className="p-2 rounded-full hover:bg-white/10 transition-colors"
                >
                    <ChevronLeft size={24} />
                </button>
                <div>
                    <h1 className="text-2xl font-bold font-orbitron text-slate-900 dark:text-white">ADMIN <span className="text-red-500">PANEL</span></h1>
                    <p className="text-xs text-gray-500">System Management</p>
                </div>
            </div>

            {/* Tab Switcher */}
            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-200 dark:bg-white/5 rounded-xl">
                <button onClick={() => setActiveAdminTab('users')} className={`py-2 rounded-lg text-[10px] font-bold transition-colors ${activeAdminTab === 'users' ? 'bg-white dark:bg-white/10 shadow text-slate-900 dark:text-white' : 'text-gray-500'}`}>System</button>
                <button onClick={() => setActiveAdminTab('payouts')} className={`py-2 rounded-lg text-[10px] font-bold transition-colors ${activeAdminTab === 'payouts' ? 'bg-white dark:bg-white/10 shadow text-slate-900 dark:text-white' : 'text-gray-500'}`}>Payouts</button>
                <button onClick={() => setActiveAdminTab('assets')} className={`py-2 rounded-lg text-[10px] font-bold transition-colors ${activeAdminTab === 'assets' ? 'bg-white dark:bg-white/10 shadow text-slate-900 dark:text-white' : 'text-gray-500'}`}>Teams</button>
                <button onClick={() => setActiveAdminTab('bots')} className={`py-2 rounded-lg text-[10px] font-bold transition-colors ${activeAdminTab === 'bots' ? 'bg-white dark:bg-white/10 shadow text-vantage-cyan' : 'text-gray-500'}`}>Bots</button>
            </div>

            {activeAdminTab === 'users' && (
                <div className="space-y-6 animate-in slide-in-from-left duration-300">
                    {/* Error Alert */}
                    {systemError && (
                        // @ts-ignore
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl flex items-start space-x-3"
                        >
                            <AlertTriangle className="text-red-500 shrink-0" size={20} />
                            <div>
                                <h3 className="text-sm font-bold text-red-500">System Alert</h3>
                                <p className="text-xs text-red-400">{systemError}</p>
                            </div>
                        </motion.div>
                    )}

                    {/* Stats Grid */}
                    <div className="grid grid-cols-3 gap-3">
                        <GlassCard className="flex flex-col items-center justify-center p-3 border-slate-200 dark:border-white/10">
                            <Users size={20} className="text-vantage-cyan mb-1" />
                            <span className="text-xl font-bold">{stats.total}</span>
                            <span className="text-[10px] text-gray-500 uppercase">Users</span>
                        </GlassCard>
                        <GlassCard className="flex flex-col items-center justify-center p-3 border-vantage-purple/30 bg-vantage-purple/5">
                            <Crown size={20} className="text-vantage-purple mb-1" />
                            <span className="text-xl font-bold text-vantage-purple">{stats.vip}</span>
                            <span className="text-[10px] text-gray-500 uppercase">VIPs</span>
                        </GlassCard>
                        <GlassCard className="flex flex-col items-center justify-center p-3 border-red-500/30 bg-red-500/5">
                            <Shield size={20} className="text-red-500 mb-1" />
                            <span className="text-xl font-bold text-red-500">{stats.admin}</span>
                            <span className="text-[10px] text-gray-500 uppercase">Admins</span>
                        </GlassCard>
                    </div>

                    {/* AI Grading Section */}
                    <GlassCard className="border-green-500/30 bg-green-500/5">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="text-sm font-bold text-green-500 uppercase flex items-center gap-2">
                                <BookCheck size={16} /> History & Grading
                            </h3>
                            <div
                                onClick={toggleAutoGrade}
                                className="flex items-center gap-2 cursor-pointer bg-black/20 px-2 py-1 rounded-full border border-white/5 hover:bg-black/30 transition-colors"
                                title="Run grading automatically when you visit this page"
                            >
                                <span className="text-[10px] font-bold text-gray-400 uppercase">Auto</span>
                                <div className={`w-6 h-3 rounded-full relative transition-colors ${autoGrade ? 'bg-green-500' : 'bg-gray-600'}`}>
                                    <div className={`absolute top-0.5 w-2 h-2 rounded-full bg-white transition-all ${autoGrade ? 'left-3.5' : 'left-0.5'}`} />
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-3">
                            <p className="text-xs text-gray-400">
                                Check scores for the selected date and update history. Defaults to yesterday ({getGlobalYesterdayKey()}) if empty.
                            </p>

                            <div className="flex items-center gap-2">
                                <input
                                    type="date"
                                    value={gradingDate}
                                    onChange={(e) => setGradingDate(e.target.value)}
                                    className="flex-1 bg-black/20 border border-white/10 text-white rounded-lg text-xs px-2 py-2 outline-none focus:ring-1 focus:ring-green-500 custom-date-input"
                                />
                                <div
                                    onClick={() => setForceRegrade(!forceRegrade)}
                                    className={`flex items-center gap-2 cursor-pointer px-2 py-2 rounded-lg border transition-colors ${forceRegrade ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-black/20 text-gray-400 border-white/5 hover:bg-black/30'}`}
                                    title="If enabled, it will grade ALL matches for this day, even if already marked as Won/Lost."
                                >
                                    <span className="text-[10px] font-bold uppercase whitespace-nowrap">Force Regrade</span>
                                    <div className={`w-5 h-2.5 rounded-full relative transition-colors ${forceRegrade ? 'bg-red-500' : 'bg-gray-600'}`}>
                                        <div className={`absolute top-0.5 w-1.5 h-1.5 rounded-full bg-white transition-all ${forceRegrade ? 'left-3' : 'left-0.5'}`} />
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={() => handleGradeYesterday(false)}
                                disabled={isGrading}
                                className="w-full py-3 bg-green-500/10 hover:bg-green-500/20 text-green-500 font-bold rounded-xl border border-green-500/20 flex items-center justify-center space-x-2 disabled:opacity-50 transition-all active:scale-95"
                            >
                                {isGrading ? <RefreshCw className="animate-spin" size={18} /> : <BookCheck size={18} />}
                                <span>{isGrading ? "Analyzing Scores..." : "Grade Matches"}</span>
                            </button>
                            {gradingResult && (
                                <div className={`text-xs text-center p-2 rounded-lg font-mono ${gradingResult.startsWith('Error') ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'}`}>
                                    {gradingResult}
                                </div>
                            )}
                        </div>
                    </GlassCard>

                    {/* Manual Generation Controls */}
                    <GlassCard className="border-orange-500/30 bg-orange-500/5">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="text-sm font-bold text-orange-500 uppercase flex items-center gap-2">
                                <Activity size={16} /> Manual Data Generation
                            </h3>
                        </div>
                        <p className="text-xs text-gray-400 mb-4">
                            Manually trigger data generation for today. Note: The Railway backend auto-runs these schedules daily.
                        </p>

                        <div className="space-y-3">
                            <button
                                onClick={async () => {
                                    if (!window.confirm("Are you sure you want to generate today's SEO blog? Ensure football and basketball are generated first.")) return;
                                    setLoadingMatches(true);
                                    try {
                                        const data = await adminFetch('/api/admin/generate-blog', {
                                            method: 'POST'
                                        });
                                        alert(`Blog generated successfully! Status: ${data.status}`);
                                    } catch (e: any) {
                                        alert(`Blog generation error: ${e.message}`);
                                    } finally {
                                        setLoadingMatches(false);
                                    }
                                }}
                                disabled={isSystemGenerating || isBasketballGenerating || loadingMatches}
                                className="w-full py-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-500 rounded-lg text-xs font-bold border border-purple-500/20 flex items-center justify-center gap-2 transition-colors active:scale-[0.98] disabled:opacity-50"
                            >
                                <BookCheck size={14} /> Generate SEO Blog
                            </button>

                            {/* Clear Data */}
                            <button
                                onClick={handleClearData}
                                className="w-full py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg text-xs font-bold border border-red-500/20 flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
                            >
                                <Trash2 size={14} /> Clear Today's Data
                            </button>

                            <div className="flex gap-2">
                                {/* Quant Pipeline */}
                                <button
                                    onClick={handleGenerateData}
                                    disabled={isSystemGenerating || isBasketballGenerating}
                                    className="flex-1 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 rounded-lg text-xs font-bold border border-emerald-500/20 flex items-center justify-center gap-2 transition-colors disabled:opacity-50 active:scale-[0.98]"
                                >
                                    {isSystemGenerating ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                                    {isSystemGenerating ? "Running..." : "⚙ Run Quant Pipeline"}
                                </button>

                                {/* Quant Performance */}
                                <button
                                    onClick={handleQuantPerformance}
                                    disabled={isSystemGenerating || isBasketballGenerating}
                                    className="flex-1 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg text-xs font-bold border border-blue-500/20 flex items-center justify-center gap-2 transition-colors disabled:opacity-50 active:scale-[0.98]"
                                >
                                    {isBasketballGenerating ? <RefreshCw size={14} className="animate-spin" /> : <BarChart3 size={14} />}
                                    {isBasketballGenerating ? "Updating..." : "📊 Quant Performance"}
                                </button>
                            </div>

                            {/* Basketball Quant Pipeline */}
                            <button
                                onClick={handleGenerateBasketball}
                                disabled={isSystemGenerating || isBasketballGenerating || isBasketballPipelineRunning}
                                className="w-full py-2 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 rounded-lg text-xs font-bold border border-orange-500/20 flex items-center justify-center gap-2 transition-colors disabled:opacity-50 active:scale-[0.98]"
                            >
                                {isBasketballPipelineRunning ? <RefreshCw size={14} className="animate-spin" /> : <span>🏀</span>}
                                {isBasketballPipelineRunning ? 'Generating Picks...' : '🏀 Basketball Quant Picks'}
                            </button>

                            <button
                                onClick={handleGenerateCricket}
                                disabled={isSystemGenerating || isBasketballGenerating || isCricketPipelineRunning}
                                className="w-full py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg text-xs font-bold border border-emerald-500/20 flex items-center justify-center gap-2 transition-colors disabled:opacity-50 active:scale-[0.98]"
                            >
                                {isCricketPipelineRunning ? <RefreshCw size={14} className="animate-spin" /> : <span>🏏</span>}
                                {isCricketPipelineRunning ? 'Generating Picks...' : '🏏 Cricket Quant Picks'}
                            </button>

                            <button
                                onClick={handleGenerateAccas}
                                disabled={isSystemGenerating || isBasketballGenerating}
                                className="w-full py-2 bg-vantage-cyan/10 hover:bg-vantage-cyan/20 text-vantage-cyan rounded-lg text-xs font-bold border border-vantage-cyan/20 flex items-center justify-center gap-2 transition-colors disabled:opacity-50 active:scale-[0.98]"
                            >
                                <Layers size={14} /> Generate Smart Accumulators
                            </button>

                            {/* Enrich H2H & Stats */}
                            <button
                                onClick={handleEnrichStats}
                                disabled={isSystemGenerating || isBasketballGenerating || isEnrichingStats}
                                className="w-full py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg text-xs font-bold border border-blue-500/20 flex items-center justify-center gap-2 transition-colors disabled:opacity-50 active:scale-[0.98]"
                            >
                                {isEnrichingStats ? <RefreshCw size={14} className="animate-spin" /> : <BarChart3 size={14} />}
                                {isEnrichingStats ? 'Enriching Stats...' : 'Enrich H2H & Team Stats'}
                            </button>
                            {enrichResult && (
                                <div className={`text-xs text-center p-2 rounded-lg font-mono ${enrichResult.startsWith('❌') ? 'bg-red-500/10 text-red-400 border border-red-500/20' : enrichResult.startsWith('✅') ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-slate-500/10 text-gray-400 border border-white/10'}`}>
                                    {enrichResult}
                                </div>
                            )}
                        </div>

                        <div className="mt-3">
                            <button
                                onClick={async () => {
                                    if (!window.confirm("Are you sure you want to run the static data seed? This uses up to 50 API calls to cache all team/league data.")) return;
                                    setLoadingMatches(true);
                                    try {
                                        const data = await adminFetch('/api/admin/seed-static', {
                                            method: 'POST',
                                            body: JSON.stringify({ force: true })
                                        });
                                        alert(`Seed started in background. Check server logs.`);
                                    } catch (e: any) {
                                        alert(`Seed trigger error: ${e.message}`);
                                    } finally {
                                        setLoadingMatches(false);
                                    }
                                }}
                                disabled={isSystemGenerating || loadingMatches}
                                className="w-full py-2 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 rounded-lg text-xs font-bold border border-yellow-500/20 flex items-center justify-center gap-2 transition-colors active:scale-[0.98] disabled:opacity-50"
                            >
                                <Database size={14} /> Force Run Static Cache Seed
                            </button>
                        </div>
                    </GlassCard>

                    {/* Vantage Intelligence Unit */}
                    <GlassCard className="border-vantage-cyan/30 bg-vantage-cyan/5">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-sm font-bold text-vantage-cyan uppercase flex items-center gap-2">
                                <Zap size={16} /> Vantage AI Engine
                            </h3>
                            <div className="flex gap-2">
                                <button
                                    onClick={runGeminiTest}
                                    disabled={testingGemini || testingOpenAI}
                                    className="text-xs bg-vantage-cyan/20 hover:bg-vantage-cyan/30 text-vantage-cyan px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors disabled:opacity-50"
                                >
                                    <Globe size={12} className={testingGemini ? "animate-spin" : ""} />
                                    {testingGemini ? "Probing..." : "Test Gemini"}
                                </button>
                                <button
                                    onClick={runOpenAITest}
                                    disabled={testingGemini || testingOpenAI}
                                    className="text-xs bg-green-500/20 hover:bg-green-500/30 text-green-400 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors disabled:opacity-50"
                                >
                                    <Zap size={12} className={testingOpenAI ? "animate-spin" : ""} />
                                    {testingOpenAI ? "Probing..." : "Test OpenAI"}
                                </button>
                            </div>
                        </div>

                        <div className="mb-4 bg-white/50 dark:bg-black/20 p-3 rounded-xl border border-white/10 flex items-center justify-between">
                            <div className="flex items-center gap-2 text-slate-700 dark:text-gray-300">
                                <Cpu size={16} />
                                <span className="text-xs font-bold uppercase">Gemini Model</span>
                            </div>
                            <select
                                value={selectedModel}
                                onChange={handleModelChange}
                                className="bg-slate-200 dark:bg-black/40 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-xs rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-vantage-cyan max-w-[150px]"
                            >
                                {AVAILABLE_MODELS.map(m => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Gemini Test Result */}
                        {geminiTest && (
                            <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5 mb-2">
                                <div className="flex items-center gap-3">
                                    {geminiTest.status === 'OK' ? <CheckCircle2 size={18} className="text-green-500" /> : <XCircle size={18} className="text-red-500" />}
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-slate-200">Gemini: {geminiTest.status}</span>
                                        <span className="text-[10px] text-gray-400 font-mono truncate max-w-[180px]">"{geminiTest.message}"</span>
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="text-xs font-bold text-vantage-cyan">{geminiTest.latency}ms</div>
                                    <div className="text-[9px] text-gray-500">Latency</div>
                                </div>
                            </div>
                        )}

                        {/* OpenAI Test Result */}
                        {openAITest && (
                            <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5">
                                <div className="flex items-center gap-3">
                                    {openAITest.status === 'success' ? <CheckCircle2 size={18} className="text-green-500" /> : <XCircle size={18} className="text-red-500" />}
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-slate-200">OpenAI ({openAITest.model}): {openAITest.status === 'success' ? 'OK' : 'ERROR'}</span>
                                        <span className="text-[10px] text-gray-400 font-mono truncate max-w-[180px]">"{openAITest.message}"</span>
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="text-xs font-bold text-green-400">{openAITest.latency}ms</div>
                                    <div className="text-[9px] text-gray-500">Latency</div>
                                </div>
                            </div>
                        )}
                    </GlassCard>

                    {/* Database Inspector */}
                    <GlassCard className="border-vantage-purple/30 bg-vantage-purple/5">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="text-sm font-bold text-vantage-purple uppercase flex items-center gap-2">
                                <Database size={16} /> Database Inspector
                            </h3>
                            <button
                                onClick={inspectDatabase}
                                className="text-xs bg-vantage-purple/20 hover:bg-vantage-purple/30 text-vantage-purple px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors"
                            >
                                {loadingMatches ? <RefreshCw size={12} className="animate-spin" /> : (showDbInspector ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                                {showDbInspector ? "Hide Data" : "View Stored Data"}
                            </button>
                        </div>

                        <AnimatePresence>
                            {showDbInspector && (
                                // @ts-ignore
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                >
                                    <div className="bg-black/20 rounded-xl p-3 border border-white/5 mt-2">
                                        <div className="flex justify-between text-xs text-gray-400 mb-2 border-b border-white/5 pb-2">
                                            <span>Date Key: {getGlobalTodayKey()}</span>
                                            <span>Records: {savedMatches?.length || 0}</span>
                                        </div>

                                        {savedMatches && savedMatches.length > 0 ? (
                                            <div className="max-h-[300px] overflow-y-auto custom-scrollbar space-y-2">
                                                {savedMatches.map(m => (
                                                    <div key={m.id} className="flex items-center justify-between p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
                                                        <div className="flex items-center gap-2 overflow-hidden">
                                                            <div className="flex -space-x-1 shrink-0">
                                                                <TeamLogo src={m.homeTeamLogo} teamName={m.homeTeam} className="w-5 h-5" />
                                                                <TeamLogo src={m.awayTeamLogo} teamName={m.awayTeam} className="w-5 h-5" />
                                                            </div>
                                                            <div className="flex flex-col min-w-0">
                                                                <span className="text-xs font-bold text-white truncate">{m.homeTeam} vs {m.awayTeam}</span>
                                                                <span className="text-[10px] text-gray-400">{m.league} • {m.prediction}</span>
                                                            </div>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <span className={`text-xs font-bold ${m.category === 'safe' ? 'text-green-500' : (m.category === 'value' ? 'text-vantage-cyan' : 'text-orange-500')}`}>
                                                                {m.confidence}%
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-center py-4 text-xs text-gray-500">
                                                {loadingMatches ? "Fetching data..." : "No predictions found in Firestore for today."}
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </GlassCard>

                    {/* Auto-Scheduler Settings */}
                    <GlassCard className="border-blue-500/30 bg-blue-500/5">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="text-sm font-bold text-blue-500 uppercase flex items-center gap-2">
                                <Activity size={16} /> Auto-Generation Scheduler (Railway)
                            </h3>
                            <button
                                onClick={handleSaveSchedules}
                                disabled={savingSchedules}
                                className={`text-xs px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors disabled:opacity-50 ${schedulesSaved ? 'bg-blue-500 text-white' : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-500'}`}
                            >
                                {savingSchedules ? <RefreshCw size={12} className="animate-spin" /> : schedulesSaved ? '✓ Saved' : 'Save Times'}
                            </button>
                        </div>
                        <p className="text-xs text-gray-400 mb-4">
                            Set the time (HH:MM) when Railway should automatically trigger prediction fetching and grading. Ensure you've provided the Firebase Admin service account to your Railway variables.
                        </p>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="flex flex-col bg-black/20 p-3 rounded-lg border border-white/5">
                                <span className="text-[10px] text-gray-500 uppercase font-bold mb-1">⚽ Football Gen (Lagos)</span>
                                <input
                                    type="time"
                                    value={footballGenTime}
                                    onChange={e => setFootballGenTime(e.target.value)}
                                    className="bg-transparent text-white text-sm outline-none font-mono"
                                />
                            </div>
                            <div className="flex flex-col bg-black/20 p-3 rounded-lg border border-white/5">
                                <span className="text-[10px] text-gray-500 uppercase font-bold mb-1">🏀 Basketball Gen (Lagos)</span>
                                <input
                                    type="time"
                                    value={basketballGenTime}
                                    onChange={e => setBasketballGenTime(e.target.value)}
                                    className="bg-transparent text-white text-sm outline-none font-mono"
                                />
                            </div>
                            <div className="flex flex-col bg-black/20 p-3 rounded-lg border border-white/5">
                                <span className="text-[10px] text-gray-500 uppercase font-bold mb-1">🏏 Cricket Gen (Lagos)</span>
                                <input
                                    type="time"
                                    value={cricketGenTime}
                                    onChange={e => setCricketGenTime(e.target.value)}
                                    className="bg-transparent text-white text-sm outline-none font-mono"
                                />
                            </div>
                            <div className="flex flex-col bg-black/20 p-3 rounded-lg border border-white/5">
                                <span className="text-[10px] text-gray-500 uppercase font-bold mb-1">✍️ Auto-Blog Gen (Lagos)</span>
                                <input
                                    type="time"
                                    value={blogGenTime}
                                    onChange={e => setBlogGenTime(e.target.value)}
                                    className="bg-transparent text-white text-sm outline-none font-mono"
                                />
                            </div>
                            <div className="flex flex-col bg-black/20 p-3 rounded-lg border border-white/5">
                                <span className="text-[10px] text-gray-500 uppercase font-bold mb-1">📊 Grading Check (Lagos)</span>
                                <input
                                    type="time"
                                    value={gradingTime}
                                    onChange={e => setGradingTime(e.target.value)}
                                    className="bg-transparent text-white text-sm outline-none font-mono"
                                />
                            </div>
                        </div>
                    </GlassCard>

                    {/* Content & Growth Settings */}
                    <GlassCard className="border-emerald-500/30 bg-emerald-500/5">
                        <h3 className="text-sm font-bold text-emerald-500 uppercase mb-3 flex items-center gap-2">
                            <Activity size={16} /> Content Settings
                        </h3>
                        <div className="flex flex-col gap-3">
                            <div>
                                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Free Picks Count</label>
                                <p className="text-xs text-gray-400 mb-2">
                                    Number of unblurred predictions shown to non-VIP users on the Free Picks page.
                                </p>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        min={0}
                                        max={20}
                                        value={freePicksCount}
                                        onChange={(e) => setFreePicksCount(Number(e.target.value))}
                                        className="flex-1 bg-slate-200 dark:bg-black/40 border border-slate-300 dark:border-white/10 rounded-lg py-2 px-3 text-sm focus:ring-1 focus:ring-emerald-500 outline-none text-slate-900 dark:text-white"
                                    />
                                    <button
                                        onClick={handleSaveFreePicks}
                                        disabled={savingFreePicks}
                                        className={`px-4 font-bold rounded-lg text-sm transition-colors disabled:opacity-50 ${freePicksSaved ? 'bg-emerald-500 text-white' : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-500 border border-emerald-500/30'}`}
                                    >
                                        {savingFreePicks ? <RefreshCw size={14} className="animate-spin" /> : freePicksSaved ? '✓ Saved' : 'Save Config'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </GlassCard>

                    {/* SEO Configurator */}
                    <GlassCard className="border-indigo-500/30 bg-indigo-500/5">
                        <h3 className="text-sm font-bold text-indigo-500 uppercase mb-3 flex items-center gap-2">
                            <Search size={16} /> SEO & Tracking Configurations
                        </h3>
                        <p className="text-xs text-gray-400 mb-3">
                            Paste your Google Search Console Verification ID here. E.g. <code>content="YOUR_VERIFICATION_CODE"</code> (Just paste the code string inside)
                        </p>
                        <div className="flex gap-2 mb-2">
                            <input
                                type="text"
                                placeholder="Verification hash string only..."
                                value={googleSiteVerificationTag}
                                onChange={(e) => setGoogleSiteVerificationTag(e.target.value)}
                                className="flex-1 bg-slate-200 dark:bg-black/40 border border-slate-300 dark:border-white/10 rounded-lg py-2 px-3 text-sm focus:ring-1 focus:ring-indigo-500 outline-none text-slate-900 dark:text-white"
                            />
                            <button
                                onClick={handleSaveSeo}
                                disabled={savingSeo}
                                className={`px-4 font-bold rounded-lg text-sm transition-colors disabled:opacity-50 ${seoSaved ? 'bg-indigo-500 text-white' : 'bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-500 border border-indigo-500/30'}`}
                            >
                                {savingSeo ? <RefreshCw size={14} className="animate-spin" /> : seoSaved ? '✓ Saved' : 'Save Config'}
                            </button>
                        </div>
                    </GlassCard>

                    {/* WhatsApp Community */}
                    <GlassCard className="border-green-500/30 bg-green-500/5">
                        <h3 className="text-sm font-bold text-green-500 uppercase mb-3 flex items-center gap-2">
                            <Link size={16} /> WhatsApp Community
                        </h3>
                        <p className="text-xs text-gray-400 mb-3">
                            Paste your VIP WhatsApp group invite link. Members will see a join button after upgrading.
                        </p>
                        <div className="flex gap-2">
                            <input
                                type="url"
                                placeholder="https://chat.whatsapp.com/..."
                                value={whatsappUrl}
                                onChange={(e) => setWhatsappUrl(e.target.value)}
                                className="flex-1 bg-slate-200 dark:bg-black/40 border border-slate-300 dark:border-white/10 rounded-lg py-2 px-3 text-sm focus:ring-1 focus:ring-green-500 outline-none text-slate-900 dark:text-white"
                            />
                            <button
                                onClick={handleSaveWhatsApp}
                                disabled={savingWhatsapp}
                                className={`px-4 font-bold rounded-lg text-sm transition-colors disabled:opacity-50 ${whatsappSaved ? 'bg-green-500 text-white' : 'bg-green-500/20 hover:bg-green-500/30 text-green-500 border border-green-500/30'}`}
                            >
                                {savingWhatsapp ? <RefreshCw size={14} className="animate-spin" /> : whatsappSaved ? '✓ Saved' : 'Save'}
                            </button>
                        </div>
                        {whatsappUrl && (
                            <button
                                onClick={() => { setWhatsappUrl(''); saveInternalSettings({ whatsappGroupUrl: '' }); }}
                                className="mt-2 text-xs text-red-400 hover:text-red-500"
                            >
                                Remove link
                            </button>
                        )}
                    </GlassCard>

                    {/* User Management */}
                    <GlassCard className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                User Database
                                <span className="bg-slate-100 dark:bg-white/10 text-xs px-2 py-0.5 rounded-full">{filteredUsers.length}</span>
                            </h2>
                            <button onClick={() => fetchUsers()} className="p-2 bg-slate-100 dark:bg-white/5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10">
                                <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                            </button>
                        </div>

                        {/* Search */}
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-3 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search email..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-vantage-cyan/50 outline-none text-slate-900 dark:text-white"
                            />
                        </div>

                        {/* List */}
                        <div className="max-h-[400px] overflow-y-auto custom-scrollbar space-y-2 pr-1">
                            {loading ? (
                                <div className="text-center py-10 text-gray-500">Loading database...</div>
                            ) : filteredUsers.length === 0 ? (
                                <div className="text-center py-10 text-gray-500">No users found</div>
                            ) : (
                                filteredUsers.map((u) => (
                                    // @ts-ignore
                                    <motion.div
                                        key={u.uid}
                                        layout
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className={`flex items-center justify-between p-3 rounded-xl border ${u.isBlocked ? 'bg-red-900/10 border-red-500/20' : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/5'}`}
                                    >
                                        <div className="flex items-center space-x-3 overflow-hidden">
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${u.isAdmin ? 'bg-red-500 text-white' : (u.isVip ? 'bg-vantage-purple text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500')}`}>
                                                {u.email ? u.email.substring(0, 2).toUpperCase() : '??'}
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <span className={`text-sm font-medium truncate flex items-center gap-1 ${u.isBlocked ? 'text-red-500 line-through' : 'text-slate-900 dark:text-white'}`}>
                                                    {u.email}
                                                </span>
                                                <span className="text-[10px] text-gray-500 flex items-center gap-2">
                                                    {u.isVip ? (
                                                        <span className="text-vantage-purple flex items-center gap-1"><Crown size={10} /> VIP</span>
                                                    ) : 'Free'}
                                                    {u.isAdmin && (
                                                        <span className="text-red-500 flex items-center gap-1 border-l border-gray-600 pl-2"><Shield size={10} /> ADMIN</span>
                                                    )}
                                                    {u.isBlocked && <span className="text-red-500 font-bold">BLOCKED</span>}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex items-center space-x-2">
                                            {/* Block Toggle */}
                                            <button
                                                onClick={() => handleToggleBlock(u)}
                                                disabled={processingId === u.uid}
                                                className={`p-2 rounded-lg transition-colors ${u.isBlocked
                                                    ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
                                                    : 'bg-gray-200 dark:bg-white/5 text-gray-400 hover:text-red-500'
                                                    }`}
                                                title={u.isBlocked ? "Unblock User" : "Block User"}
                                            >
                                                {u.isBlocked ? <Lock size={16} /> : <Ban size={16} />}
                                            </button>

                                            {/* VIP Toggle */}
                                            <button
                                                onClick={() => handleToggleVip(u)}
                                                disabled={processingId === u.uid}
                                                className={`p-2 rounded-lg transition-colors ${u.isVip
                                                    ? 'bg-vantage-purple/10 text-vantage-purple hover:bg-vantage-purple/20'
                                                    : 'bg-gray-200 dark:bg-white/5 text-gray-400 hover:text-green-500'
                                                    }`}
                                                title={u.isVip ? "Revoke VIP" : "Grant VIP"}
                                            >
                                                {processingId === u.uid ? (
                                                    <RefreshCw size={16} className="animate-spin" />
                                                ) : u.isVip ? (
                                                    <XCircle size={16} />
                                                ) : (
                                                    <CheckCircle2 size={16} />
                                                )}
                                            </button>
                                            {selectPlanFor === u.uid && (
                                                <div className="flex gap-1 flex-wrap mt-1">
                                                    {(['daily', 'weekly', 'monthly', 'quarterly', 'annual'] as const).map(plan => (
                                                        <button
                                                            key={plan}
                                                            onClick={() => handleSelectPlan(u, plan)}
                                                            className="text-[9px] font-bold px-2 py-1 rounded-lg bg-vantage-cyan/10 text-vantage-cyan border border-vantage-cyan/20 hover:bg-vantage-cyan/20 transition-colors capitalize"
                                                        >
                                                            {plan}
                                                        </button>
                                                    ))}
                                                    <button
                                                        onClick={() => setSelectPlanFor(null)}
                                                        className="text-[9px] font-bold px-2 py-1 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                ))
                            )}
                        </div>
                        {userLastDoc && (
                            <div className="pt-2 flex justify-center">
                                <button
                                    onClick={() => loadMoreUsers()}
                                    disabled={loadingMore}
                                    className="px-6 py-2 text-xs font-bold bg-vantage-cyan/10 text-vantage-cyan border border-vantage-cyan/20 rounded-xl hover:bg-vantage-cyan/20 disabled:opacity-50 transition-colors"
                                >
                                    {loadingMore ? 'Loading...' : 'Load More Users'}
                                </button>
                            </div>
                        )}
                    </GlassCard>
                </div>
            )}

            {activeAdminTab === 'payouts' && (
                <div className="space-y-6 animate-in slide-in-from-right duration-300">
                    <GlassCard className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                Withdrawal Requests
                                <span className="bg-vantage-purple/20 text-vantage-purple text-xs px-2 py-0.5 rounded-full">
                                    {payouts.filter(p => p.status === 'pending').length} Pending
                                </span>
                            </h2>
                            <button onClick={fetchPayouts} className="p-2 bg-slate-100 dark:bg-white/5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10">
                                <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                            </button>
                        </div>

                        <div className="max-h-[500px] overflow-y-auto custom-scrollbar space-y-3">
                            {loading ? (
                                <div className="text-center py-10 text-gray-500">Loading payouts...</div>
                            ) : payouts.length === 0 ? (
                                <div className="text-center py-10 text-gray-500">No payout requests found.</div>
                            ) : (
                                payouts.map(p => (
                                    <div key={p.id} className="bg-slate-50 dark:bg-white/5 p-4 rounded-xl border border-slate-200 dark:border-white/5 flex flex-col gap-3">
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-slate-200 dark:bg-white/10 rounded-full text-slate-500 dark:text-gray-300">
                                                    <Wallet size={20} />
                                                </div>
                                                <div>
                                                    <span className="text-sm font-bold text-slate-900 dark:text-white block">{p.userEmail}</span>
                                                    <span className="text-xs text-gray-500">{new Date(p.date).toLocaleString()}</span>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-lg font-bold font-orbitron text-vantage-purple block">${p.amount}</span>
                                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${p.status === 'pending' ? 'bg-yellow-500/10 text-yellow-500' :
                                                    p.status === 'paid' ? 'bg-green-500/10 text-green-500' :
                                                        'bg-red-500/10 text-red-500'
                                                    }`}>
                                                    {p.status}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="bg-slate-100 dark:bg-black/30 p-2 rounded-lg text-xs font-mono text-slate-700 dark:text-gray-300 flex justify-between">
                                            <span>Mobile Money:</span>
                                            <span className="font-bold">{p.phoneNumber}</span>
                                        </div>

                                        {p.status === 'pending' && (
                                            <div className="flex gap-2 mt-1">
                                                <button
                                                    onClick={() => handlePayout(p, 'rejected')}
                                                    disabled={!!processingId}
                                                    className="flex-1 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg text-xs font-bold border border-red-500/20"
                                                >
                                                    Reject (Refund)
                                                </button>
                                                <button
                                                    onClick={() => handlePayout(p, 'paid')}
                                                    disabled={!!processingId}
                                                    className="flex-1 py-2 bg-green-500/10 hover:bg-green-500/20 text-green-500 rounded-lg text-xs font-bold border border-green-500/20"
                                                >
                                                    Mark Paid
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </GlassCard>
                </div>
            )}

            {activeAdminTab === 'assets' && (
                <div className="space-y-6 animate-in slide-in-from-bottom duration-300">
                    <GlassCard className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                Team Assets
                                <span className="bg-slate-100 dark:bg-white/10 text-xs px-2 py-0.5 rounded-full">{assets.length}</span>
                            </h2>
                            <button onClick={fetchAssets} className="p-2 bg-slate-100 dark:bg-white/5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10">
                                <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                            </button>
                        </div>

                        {/* Add New Asset Form */}
                        <form onSubmit={handleSaveAsset} className="bg-slate-50 dark:bg-black/20 p-4 rounded-xl border border-slate-200 dark:border-white/10 space-y-3">
                            <div className="flex items-center gap-2 mb-2">
                                <ImagePlus size={16} className="text-vantage-cyan" />
                                <span className="text-xs font-bold uppercase">Add New Team Logo</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <input
                                    type="text"
                                    placeholder="Team Name (e.g. Manchester United)"
                                    value={newTeamName}
                                    onChange={(e) => setNewTeamName(e.target.value)}
                                    className="w-full bg-slate-200 dark:bg-black/40 border border-slate-300 dark:border-white/10 rounded-lg py-2 px-3 text-sm focus:ring-1 focus:ring-vantage-cyan outline-none text-slate-900 dark:text-white"
                                    required
                                />
                                <div className="flex gap-2">
                                    <input
                                        type="url"
                                        placeholder="Logo URL (https://...)"
                                        value={newLogoUrl}
                                        onChange={(e) => setNewLogoUrl(e.target.value)}
                                        className="flex-1 bg-slate-200 dark:bg-black/40 border border-slate-300 dark:border-white/10 rounded-lg py-2 px-3 text-sm focus:ring-1 focus:ring-vantage-cyan outline-none text-slate-900 dark:text-white"
                                        required
                                    />
                                    <button
                                        type="submit"
                                        disabled={!!processingId}
                                        className="px-4 bg-vantage-cyan text-slate-900 font-bold rounded-lg hover:bg-cyan-400 transition-colors disabled:opacity-50"
                                    >
                                        Save
                                    </button>
                                </div>
                            </div>
                        </form>

                        {/* Assets List */}
                        <div className="max-h-[500px] overflow-y-auto custom-scrollbar space-y-2">
                            {loading ? (
                                <div className="text-center py-10 text-gray-500">Loading assets...</div>
                            ) : assets.length === 0 ? (
                                <div className="text-center py-10 text-gray-500">No custom team logos found.</div>
                            ) : (
                                assets.map((asset) => (
                                    <div key={asset.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/5">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-slate-200 dark:bg-white/10 rounded-full p-2 flex items-center justify-center border border-slate-300 dark:border-white/10">
                                                <TeamLogo src={asset.logoUrl} teamName={asset.name} className="w-full h-full object-contain" />
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-slate-900 dark:text-white">{asset.name}</span>
                                                <span className="text-[10px] text-gray-500 font-mono truncate max-w-[200px] flex items-center gap-1">
                                                    <Link size={8} /> {asset.logoUrl}
                                                </span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleDeleteAsset(asset.id)}
                                            className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </GlassCard>
                </div>
            )}

            {/* ─── BOTS & NOTIFICATIONS TAB ─── */}
            {activeAdminTab === 'bots' && (
                <div className="space-y-4 animate-in slide-in-from-right duration-300">
                    {/* Telegram Bot */}
                    <GlassCard className="border-blue-500/20 bg-blue-500/5">
                        <div className="flex items-center gap-2 mb-4">
                            <Send size={18} className="text-blue-400" />
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Telegram Bot</h3>
                                <p className="text-[10px] text-gray-500">Auto-posts today's top pick to your Telegram channel</p>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Bot Token</label>
                                <input
                                    type="password"
                                    placeholder="123456789:ABCdef..."
                                    value={telegramBotToken}
                                    onChange={e => setTelegramBotToken(e.target.value)}
                                    className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-lg py-2 px-3 text-sm font-mono focus:ring-1 focus:ring-blue-400 outline-none text-slate-900 dark:text-white"
                                />
                                <p className="text-[9px] text-gray-400 mt-1">Get from @BotFather on Telegram. Type /newbot to create one.</p>
                            </div>
                            <div>
                                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Channel / Group ID</label>
                                <input
                                    type="text"
                                    placeholder="-1001234567890 or @channelname"
                                    value={telegramChannelId}
                                    onChange={e => setTelegramChannelId(e.target.value)}
                                    className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-lg py-2 px-3 text-sm font-mono focus:ring-1 focus:ring-blue-400 outline-none text-slate-900 dark:text-white"
                                />
                                <p className="text-[9px] text-gray-400 mt-1">Forward a message from your channel to @userinfobot to get the ID.</p>
                            </div>

                            {/* Send Time */}
                            <div>
                                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Daily Send Time (WAT / Lagos)</label>
                                <input
                                    type="time"
                                    value={telegramSendTime}
                                    onChange={e => setTelegramSendTime(e.target.value)}
                                    className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-lg py-2 px-3 text-sm font-mono focus:ring-1 focus:ring-blue-400 outline-none text-slate-900 dark:text-white"
                                />
                                <p className="text-[9px] text-gray-400 mt-1">Predictions are sent every day at this time (set after football gen time).</p>
                            </div>

                            {/* Enable toggle */}
                            <div className="flex items-center justify-between p-3 bg-white/50 dark:bg-white/5 rounded-lg border border-slate-200 dark:border-white/10">
                                <div>
                                    <p className="text-xs font-bold text-slate-900 dark:text-white">Enable Telegram</p>
                                    <p className="text-[10px] text-gray-500">Automatically post predictions daily</p>
                                </div>
                                <button
                                    onClick={() => setTelegramEnabled(v => !v)}
                                    className={`w-11 h-6 rounded-full transition-colors relative ${telegramEnabled ? 'bg-blue-500' : 'bg-slate-300 dark:bg-white/20'}`}
                                >
                                    <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${telegramEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                </button>
                            </div>

                            {/* Last sent info */}
                            {telegramLastSentAt && (
                                <div className="text-[10px] text-gray-500 px-1">
                                    ✅ Last sent: {new Date(telegramLastSentAt).toLocaleString()} · {telegramLastSentCount ?? 0} picks shown
                                </div>
                            )}

                            {/* Test & Send Now */}
                            <div className="flex gap-2">
                                <button
                                    disabled={isTelegramActing}
                                    onClick={async () => {
                                        setIsTelegramActing(true);
                                        setTelegramActionResult(null);
                                        try {
                                            const data = await adminFetch('/api/admin/telegram-test', {
                                                method: 'POST'
                                            });
                                            setTelegramActionResult(data.status === 'success' ? '✅ Test message sent!' : `❌ ${data.error}`);
                                        } catch (e: any) {
                                            setTelegramActionResult(`❌ ${e.message}`);
                                        } finally {
                                            setIsTelegramActing(false);
                                        }
                                    }}
                                    className="flex-1 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg text-xs font-bold border border-blue-500/20 flex items-center justify-center gap-2 transition-colors disabled:opacity-50 active:scale-[0.98]"
                                >
                                    <Send size={12} /> Test Bot
                                </button>
                                <button
                                    disabled={isTelegramActing}
                                    onClick={async () => {
                                        if (!window.confirm("Send today's predictions to Telegram right now?")) return;
                                        setIsTelegramActing(true);
                                        setTelegramActionResult(null);
                                        try {
                                            const data = await adminFetch('/api/admin/telegram-broadcast', {
                                                method: 'POST'
                                            });
                                            if (data.status === 'success') {
                                                setTelegramActionResult(`✅ Sent ${data.sent} picks!`);
                                                setTelegramLastSentAt(new Date().toISOString());
                                                setTelegramLastSentCount(data.sent);
                                            } else {
                                                setTelegramActionResult(`⚠️ ${data.reason || data.error}`);
                                            }
                                        } catch (e: any) {
                                            setTelegramActionResult(`❌ ${e.message}`);
                                        } finally {
                                            setIsTelegramActing(false);
                                        }
                                    }}
                                    className="flex-1 py-2 bg-green-500/10 hover:bg-green-500/20 text-green-400 rounded-lg text-xs font-bold border border-green-500/20 flex items-center justify-center gap-2 transition-colors disabled:opacity-50 active:scale-[0.98]"
                                >
                                    <Send size={12} /> Send Now
                                </button>
                            </div>

                            {telegramActionResult && (
                                <div className={`text-xs font-mono text-center p-2 rounded-lg ${telegramActionResult.startsWith('✅') ? 'bg-green-500/10 text-green-400 border border-green-500/20' : telegramActionResult.startsWith('⚠️') ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                                    {telegramActionResult}
                                </div>
                            )}

                            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-[10px] text-yellow-700 dark:text-yellow-400 space-y-1">
                                <p className="font-bold">📋 Setup Instructions:</p>
                                <ol className="list-decimal pl-3 space-y-0.5">
                                    <li>Create a bot via @BotFather → /newbot</li>
                                    <li>Add the bot as admin to your channel</li>
                                    <li>Paste the token and channel ID above</li>
                                    <li>Set the send time, enable, and Save Settings</li>
                                    <li>Use "Test Bot" to verify the connection works</li>
                                </ol>
                            </div>
                        </div>
                    </GlassCard>

                    {/* Referral Settings */}
                    <GlassCard className="border-vantage-purple/20 bg-vantage-purple/5">
                        <div className="flex items-center gap-2 mb-4">
                            <Gift size={18} className="text-vantage-purple" />
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Referral Program</h3>
                                <p className="text-[10px] text-gray-500">Free VIP days awarded per successful referral</p>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                <div className="flex-1">
                                    <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Reward Days per Referral</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={30}
                                        value={referralRewardDays}
                                        onChange={e => setReferralRewardDays(Number(e.target.value))}
                                        className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-lg py-2 px-3 text-sm focus:ring-1 focus:ring-vantage-purple outline-none text-slate-900 dark:text-white"
                                    />
                                </div>
                                <div className="text-center pt-4">
                                    <p className="text-xl font-bold font-orbitron text-vantage-purple">{referralRewardDays}d</p>
                                    <p className="text-[9px] text-gray-500">free VIP</p>
                                </div>
                            </div>
                            <p className="text-[10px] text-gray-500 bg-slate-100 dark:bg-white/5 rounded-lg p-2">
                                When a user signs up using another user's referral link, the referrer earns {referralRewardDays} free VIP day(s). You can fulfil these manually from the Users tab by toggling their VIP status.
                            </p>
                        </div>
                    </GlassCard>

                    {/* App Download Link */}
                    <GlassCard className="border-vantage-cyan/20 bg-vantage-cyan/5">
                        <div className="flex items-center gap-2 mb-3">
                            <Link size={16} className="text-vantage-cyan" />
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white">App Download / Install Link</h3>
                                <p className="text-[10px] text-gray-500">Shown when users tap "Install" on the home screen. Paste an APK, Play Store, or PWA URL.</p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="url"
                                placeholder="https://play.google.com/... or https://yourapp.com/app.apk"
                                value={appDownloadUrl}
                                onChange={e => setAppDownloadUrl(e.target.value)}
                                className="flex-1 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-lg py-2 px-3 text-sm font-mono focus:ring-1 focus:ring-vantage-cyan outline-none text-slate-900 dark:text-white"
                            />
                            <button
                                onClick={handleSaveDownloadUrl}
                                disabled={savingDownloadUrl}
                                className={`px-4 font-bold rounded-lg text-sm transition-colors disabled:opacity-50 ${downloadUrlSaved ? 'bg-vantage-cyan text-slate-900' : 'bg-vantage-cyan/20 hover:bg-vantage-cyan/30 text-vantage-cyan border border-vantage-cyan/30'}`}
                            >
                                {savingDownloadUrl ? <RefreshCw size={14} className="animate-spin" /> : downloadUrlSaved ? '✓ Saved' : 'Save'}
                            </button>
                        </div>
                        {appDownloadUrl && (
                            <p className="mt-2 text-[10px] text-gray-500 truncate">
                                Current: <span className="text-vantage-cyan font-mono">{appDownloadUrl}</span>
                            </p>
                        )}
                    </GlassCard>

                    {/* WhatsApp Group */}
                    <GlassCard className="border-green-500/20 bg-green-500/5">
                        <div className="flex items-center gap-2 mb-3">
                            <Bell size={16} className="text-green-500" />
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">WhatsApp Group Link</h3>
                        </div>
                        <input
                            type="url"
                            placeholder="https://chat.whatsapp.com/..."
                            value={whatsappUrl}
                            onChange={e => setWhatsappUrl(e.target.value)}
                            className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-lg py-2 px-3 text-sm focus:ring-1 focus:ring-green-400 outline-none text-slate-900 dark:text-white mb-3"
                        />
                        <button
                            onClick={handleSaveWhatsApp}
                            disabled={savingWhatsapp}
                            className="w-full py-2 bg-green-500 text-white text-xs font-bold rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
                        >
                            {whatsappSaved ? '✅ Saved!' : savingWhatsapp ? 'Saving...' : 'Save WhatsApp Link'}
                        </button>
                    </GlassCard>

                    {/* Save Bot Settings Button */}
                    <button
                        onClick={handleSaveBotSettings}
                        disabled={savingBotSettings}
                        className="w-full py-3 bg-gradient-to-r from-blue-500 to-vantage-purple text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                        <Save size={16} />
                        {botSettingsSaved ? '✅ Settings Saved!' : savingBotSettings ? 'Saving...' : 'Save Bot & Referral Settings'}
                    </button>
                </div>
            )}
        </div>
    );
};

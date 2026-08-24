

import React, { useState, useEffect } from 'react';
import { Settings, LogOut, ChevronRight, Moon, Sun, User, AlertTriangle, X, Mail, Lock, ArrowRight, CheckCircle2, Crown, ShieldAlert, Globe, FileText, Calendar, CreditCard, MessageCircle, ChevronLeft, Shield, Ticket, Copy, Share2, Coins, Wallet, History, Sparkles, BookOpen, TrendingUp, Target, BarChart3, Activity, PlayCircle, ExternalLink, RefreshCw, Zap } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { LegalDoc } from '../components/LegalDoc';
import { AppGuide } from '../components/AppGuide';
import { ensureReferralCode } from '../services/db';
import { useNavigate } from 'react-router-dom';

interface ProfileProps {
    initialMode?: 'login' | 'signup';
    onBack?: () => void;
}

export const Profile: React.FC<ProfileProps> = ({ initialMode, onBack }) => {
    const { t, language, setLanguage, theme, toggleTheme } = useAppContext();
    const { user, userProfile, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, logout, deleteAccount, error, clearError, loading: authLoading, requestPayout } = useAuth();
    const navigate = useNavigate();

    const [isLoginMode, setIsLoginMode] = useState(true);
    const [isForgotMode, setIsForgotMode] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [referralCodeInput, setReferralCodeInput] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [resetSent, setResetSent] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [legalPage, setLegalPage] = useState<'privacy' | 'terms' | null>(null);
    const [copiedCode, setCopiedCode] = useState(false);

    // Payout State
    const [showPayoutModal, setShowPayoutModal] = useState(false);
    const [payoutPhone, setPayoutPhone] = useState('');
    const [payoutAmount, setPayoutAmount] = useState('');
    const [payoutLoading, setPayoutLoading] = useState(false);


    // Sync initial mode prop with internal state & Check for Saved Referral
    useEffect(() => {
        // 1. Set mode
        if (initialMode) {
            setIsLoginMode(initialMode === 'login');
        }

        // 2. Check for saved referral code (on unauthenticated sign-up form)
        const savedRef = localStorage.getItem('vantage_referral_code');
        if (savedRef) {
            setReferralCodeInput(savedRef);
            if (!initialMode) {
                setIsLoginMode(false);
            }
        }
    }, [initialMode]);

    // 3. Auto-generate referral code for authenticated users who don't have one yet
    useEffect(() => {
        if (user && userProfile && !userProfile.referralCode) {
            ensureReferralCode(user.uid);
        }
    }, [user, userProfile]);

    const handleEmailAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;
        if (!isForgotMode && !password) return;

        setIsSubmitting(true);
        setResetSent(false);

        try {
            if (isForgotMode) {
                await resetPassword(email);
                setResetSent(true);
            } else if (isLoginMode) {
                await signInWithEmail(email, password);
            } else {
                await signUpWithEmail(email, password, referralCodeInput);
                try {
                    if (typeof window !== 'undefined' && (window as any).fbq) {
                        (window as any).fbq('track', 'CompleteRegistration');
                    }
                } catch (err) { console.error('Pixel error', err); }
            }
        } catch (e) {
            // Error handled by AuthContext
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleGoogleAuth = async () => {
        setIsSubmitting(true);
        try {
            await signInWithGoogle(referralCodeInput);
        } catch (e) {
            // Error handled in context
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteAccount = async () => {
        const confirmMessage = language === 'fr'
            ? "Êtes-vous sûr de vouloir supprimer votre compte ? Cette action est irréversible."
            : "Are you sure you want to delete your account? This action cannot be undone.";

        if (window.confirm(confirmMessage)) {
            try {
                await deleteAccount();
            } catch (e: any) {
                alert(e.message || "Error deleting account. You may need to re-login recently.");
            }
        }
    };

    const toggleLanguage = () => {
        setLanguage(language === 'fr' ? 'en' : 'fr');
    };

    const openWhatsApp = () => {
        window.open('https://wa.me/237688203629', '_blank');
    };

    const copyReferralCode = () => {
        if (userProfile?.referralCode) {
            navigator.clipboard.writeText(userProfile.referralCode);
            setCopiedCode(true);
            setTimeout(() => setCopiedCode(false), 2000);
        }
    };

const shareReferral = () => {
        const code = userProfile?.referralCode;
        if (!code) return;
        const shareUrl = `${window.location.origin}?ref=${code}`;
        if (navigator.share) {
            navigator.share({
                title: 'Vantage AI — AI Football Picks',
                text: language === 'fr'
                    ? `J'utilise Vantage AI pour mes pronostics. Inscris-toi avec mon lien et gagne des accès VIP !`
                    : `I use Vantage AI for football predictions. Sign up with my link and get VIP access!`,
                url: shareUrl
            }).catch((err) => {
                if (err.name !== 'AbortError') console.error('Share error:', err);
            });
        } else {
            navigator.clipboard.writeText(shareUrl);
            setCopiedCode(true);
            setTimeout(() => setCopiedCode(false), 2000);
        }
    };

    const replayTutorial = () => {
        localStorage.removeItem('vantage_onboarded');
        window.location.reload();
    };

    const handleRequestPayout = async (e: React.FormEvent) => {
        e.preventDefault();
        const amountNum = parseInt(payoutAmount);
        const balance = userProfile?.referralEarnings || 0;

        if (!payoutPhone) return;
        if (isNaN(amountNum) || amountNum < 1000) {
            alert(language === 'fr' ? "Le montant minimum est de 1000 FCFA" : "Minimum amount is 1000 FCFA");
            return;
        }
        if (amountNum > balance) {
            alert(language === 'fr' ? "Solde insuffisant" : "Insufficient balance");
            return;
        }

        setPayoutLoading(true);
        try {
            await requestPayout(amountNum, payoutPhone);
            alert(t('profile.payout_success'));
            setShowPayoutModal(false);
            setPayoutAmount('');
        } catch (e: any) {
            alert(e.message);
        } finally {
            setPayoutLoading(false);
        }
    };

    if (authLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-10 h-10 border-4 border-vantage-cyan border-t-transparent rounded-full animate-spin" />
                <p className="text-gray-500 text-sm">Authentification...</p>
            </div>
        );
    }

    if (legalPage) {
        return (
            <div className="pb-24 relative min-h-screen">
                <LegalDoc type={legalPage} onBack={() => setLegalPage(null)} />
            </div>
        );
    }

    // Removed: AppGuide + Learn Center → moved to /learn

    // --- UNAUTHENTICATED VIEW ---
    if (!user) {
        return (
            <div className="min-h-[80vh] flex flex-col justify-center items-center relative px-2">
                <AnimatePresence>
                    {error && (
                        // @ts-ignore
                        <motion.div
                            initial={{ opacity: 0, y: -20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            className="absolute top-0 left-0 right-0 z-50 p-4"
                        >
                            <div className="bg-red-500/10 backdrop-blur-xl border border-red-500/50 rounded-2xl p-4 text-sm relative shadow-xl">
                                <button
                                    onClick={clearError}
                                    className="absolute top-2 right-2 p-1 rounded-full hover:bg-red-500/20 text-red-500 transition-colors"
                                >
                                    <X size={16} />
                                </button>
                                <div className="flex items-start space-x-3">
                                    <div className="p-2 bg-red-500/20 rounded-lg text-red-500 shrink-0">
                                        <AlertTriangle size={20} />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-red-500 mb-1">{t('auth.auth_error')}</h3>
                                        <p className="text-slate-700 dark:text-gray-300">{error}</p>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {
                    // @ts-ignore
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="w-full max-w-sm"
                    >
                        {onBack && (
                            <button
                                onClick={onBack}
                                className="absolute top-4 left-0 p-2 text-gray-500 hover:text-white transition-colors"
                            >
                                <ChevronLeft size={24} />
                            </button>
                        )}

                        <div className="text-center space-y-2 mb-8 mt-4">
                            <div className="w-20 h-20 bg-cyan-100 rounded-full flex items-center justify-center mx-auto mb-4 border border-cyan-200 dark:border-cyan-500/20 shadow-[0_0_30px_rgba(34,211,238,0.2)] dark:bg-vantage-cyan/10 dark:border-vantage-cyan/20">
                                <User size={40} className="text-cyan-600 dark:text-vantage-cyan" />
                            </div>
                            <h1 className="text-3xl font-bold font-orbitron text-slate-900 dark:text-white">
                                VANTAGE<span className="text-vantage-cyan">ID</span>
                            </h1>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {isForgotMode ? t('auth.reset_subtitle') : (isLoginMode ? t('auth.login_subtitle') : t('auth.signup_subtitle'))}
                            </p>
                        </div>

                        <GlassCard className="space-y-6 !p-6">
                            {resetSent ? (
                                <div className="text-center py-6">
                                    <div className="w-12 h-12 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-3">
                                        <CheckCircle2 size={24} />
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Check your email</h3>
                                    <p className="text-sm text-gray-500 mb-6">{t('auth.reset_success')}</p>
                                    <button onClick={() => { setResetSent(false); setIsForgotMode(false); }} className="text-vantage-cyan font-bold hover:underline">
                                        {t('auth.back_to_login')}
                                    </button>
                                </div>
                            ) : (
                                <form onSubmit={handleEmailAuth} className="space-y-4">
                                    <div className="space-y-1">
                                        <div className="relative">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                                                <Mail size={18} />
                                            </div>
                                            <input
                                                type="email"
                                                placeholder={t('auth.email_placeholder')}
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                className="w-full pl-10 pr-4 py-3 bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-vantage-cyan/50 focus:border-vantage-cyan/50 text-slate-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 transition-all outline-none text-sm"
                                                required
                                            />
                                        </div>
                                    </div>

                                    {!isForgotMode && (
                                        <div className="space-y-1">
                                            <div className="relative">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                                                    <Lock size={18} />
                                                </div>
                                                <input
                                                    type="password"
                                                    placeholder={t('auth.password_placeholder')}
                                                    value={password}
                                                    onChange={(e) => setPassword(e.target.value)}
                                                    className="w-full pl-10 pr-4 py-3 bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-vantage-cyan/50 focus:border-vantage-cyan/50 text-slate-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 transition-all outline-none text-sm"
                                                    required={!isForgotMode}
                                                    minLength={6}
                                                />
                                            </div>

                                            {/* Referral Code Input - Show in Signup Mode OR if user manually entered one */}
                                            {(!isLoginMode || referralCodeInput.length > 0) && (
                                                <div className="relative mt-2">
                                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                                                        <Ticket size={18} />
                                                    </div>
                                                    <input
                                                        type="text"
                                                        placeholder={t('auth.promo_placeholder')}
                                                        value={referralCodeInput}
                                                        onChange={(e) => setReferralCodeInput(e.target.value.toUpperCase())}
                                                        className="w-full pl-10 pr-4 py-3 bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-vantage-cyan/50 focus:border-vantage-cyan/50 text-slate-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 transition-all outline-none text-sm uppercase"
                                                        maxLength={8}
                                                    />
                                                </div>
                                            )}

                                            {isLoginMode && (
                                                <div className="flex justify-end">
                                                    <button type="button" onClick={() => setIsForgotMode(true)} className="text-xs text-vantage-cyan hover:text-cyan-400 transition-colors">
                                                        {t('auth.forgot_password')}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="w-full py-3 bg-vantage-cyan hover:bg-cyan-400 text-slate-900 font-bold rounded-xl shadow-[0_0_20px_rgba(34,211,238,0.3)] hover:shadow-[0_0_30px_rgba(34,211,238,0.5)] transition-all flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <span>{isForgotMode ? t('auth.reset_btn') : (isLoginMode ? t('auth.login_btn') : t('auth.signup_btn'))}</span>
                                        {!isSubmitting && <ArrowRight size={18} />}
                                        {isSubmitting && <div className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />}
                                    </button>

                                    {isForgotMode && (
                                        <button type="button" onClick={() => { setIsForgotMode(false); clearError(); }} className="w-full py-2 text-gray-500 hover:text-slate-900 dark:hover:text-white text-sm">
                                            {t('auth.back_to_login')}
                                        </button>
                                    )}
                                </form>
                            )}

                            {!isForgotMode && !resetSent && (
                                <>
                                    <div className="relative">
                                        <div className="absolute inset-0 flex items-center">
                                            <div className="w-full border-t border-slate-200 dark:border-white/10"></div>
                                        </div>
                                        <div className="relative flex justify-center text-xs uppercase">
                                            <span className="px-2 bg-white/50 dark:bg-black/50 text-gray-500 backdrop-blur-sm">{t('auth.or_continue')}</span>
                                        </div>
                                    </div>

                                    <button
                                        onClick={handleGoogleAuth}
                                        disabled={isSubmitting}
                                        className="w-full py-3 bg-white dark:bg-white text-slate-900 font-bold rounded-xl border border-slate-200 hover:bg-slate-50 transition-all flex items-center justify-center space-x-3 disabled:opacity-50"
                                    >
                                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                        </svg>
                                        <span>Google</span>
                                    </button>

                                    <div className="text-center">
                                        <button onClick={() => { setIsLoginMode(!isLoginMode); clearError(); }} className="text-xs text-slate-500 dark:text-gray-400 hover:text-vantage-cyan transition-colors">
                                            {isLoginMode ? t('auth.no_account') : t('auth.has_account')}
                                        </button>
                                    </div>
                                </>
                            )}
                        </GlassCard>
                    </motion.div>
                }
            </div>
        );
    }

    // --- AUTHENTICATED VIEW (SETTINGS) ---
    if (showSettings) {
        return (
            <div className="space-y-6 pb-24">
                {/* Header */}
                <div className="flex items-center space-x-3">
                    <button
                        onClick={() => setShowSettings(false)}
                        className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
                    >
                        <ChevronLeft size={24} className="text-slate-900 dark:text-white" />
                    </button>
                    <h1 className="text-2xl font-bold font-orbitron text-slate-900 dark:text-white">{t('profile.settings')}</h1>
                </div>

                {/* Preferences */}
                <GlassCard className="space-y-4">
                    <div className="flex items-center justify-between p-2">
                        <div className="flex items-center space-x-3 text-slate-700 dark:text-gray-300">
                            <Globe size={20} />
                            <span className="font-medium">{t('profile.language')}</span>
                        </div>
                        <button
                            onClick={toggleLanguage}
                            className="px-4 py-2 bg-slate-100 dark:bg-white/10 rounded-lg text-sm font-bold text-slate-900 dark:text-white border border-slate-200 dark:border-white/5"
                        >
                            {language === 'fr' ? 'Français' : 'English'}
                        </button>
                    </div>

                    <div className="w-full h-px bg-slate-200 dark:bg-white/5" />

                    <div className="flex items-center justify-between p-2">
                        <div className="flex items-center space-x-3 text-slate-700 dark:text-gray-300">
                            {theme === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
                            <span className="font-medium">{t('profile.theme')}</span>
                        </div>
                        <button
                            onClick={toggleTheme}
                            className="px-4 py-2 bg-slate-100 dark:bg-white/10 rounded-lg text-sm font-bold text-slate-900 dark:text-white border border-slate-200 dark:border-white/5"
                        >
                            {theme === 'dark' ? t('profile.theme_dark') : t('profile.theme_light')}
                        </button>
                    </div>
                </GlassCard>

                {/* Legal Links */}
                <GlassCard className="space-y-1">
                    <button
                        onClick={() => setLegalPage('privacy')}
                        className="w-full flex items-center justify-between p-3 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors group"
                    >
                        <div className="flex items-center space-x-3 text-slate-700 dark:text-gray-300">
                            <Shield size={20} />
                            <span className="font-medium">Privacy Policy</span>
                        </div>
                        <ChevronRight size={18} className="text-gray-400 group-hover:text-vantage-cyan" />
                    </button>

                    <button
                        onClick={() => setLegalPage('terms')}
                        className="w-full flex items-center justify-between p-3 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors group"
                    >
                        <div className="flex items-center space-x-3 text-slate-700 dark:text-gray-300">
                            <FileText size={20} />
                            <span className="font-medium">Terms of Service</span>
                        </div>
                        <ChevronRight size={18} className="text-gray-400 group-hover:text-vantage-cyan" />
                    </button>
                </GlassCard>

                {/* Danger Zone */}
                <div className="pt-8">
                    <h3 className="text-sm font-bold text-red-500 uppercase tracking-widest mb-3 ml-1 flex items-center gap-2">
                        <ShieldAlert size={14} /> Danger Zone
                    </h3>
                    <GlassCard className="border-red-500/30 bg-red-500/5">
                        <p className="text-xs text-gray-500 mb-4">
                            {language === 'fr'
                                ? "La suppression de votre compte est définitive. Toutes vos données, y compris votre statut VIP, seront effacées."
                                : "Deleting your account is permanent. All your data, including VIP status, will be wiped."}
                        </p>
                        <button
                            onClick={handleDeleteAccount}
                            className="w-full py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 font-bold rounded-xl border border-red-500/20 transition-colors flex items-center justify-center space-x-2"
                        >
                            <ShieldAlert size={18} />
                            <span>Delete Account</span>
                        </button>
                    </GlassCard>
                </div>
            </div>
        );
    }

    // --- AUTHENTICATED VIEW (MAIN) ---
    return (
        <div className="space-y-6 pb-24 relative">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold font-orbitron text-slate-900 dark:text-white">
                    {t('profile.title')} <span className="text-cyan-600 dark:text-vantage-cyan">{t('profile.title_accent')}</span>
                </h1>
                <button
                    onClick={() => setShowSettings(true)}
                    className="p-2 rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-white transition-colors border border-slate-200 dark:border-white/5"
                >
                    <Settings size={20} />
                </button>
            </div>

            {/* Profile Card */}
            <GlassCard className="relative overflow-hidden">
                <div className="flex items-center space-x-4 relative z-10">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-vantage-cyan to-vantage-purple p-0.5 shrink-0">
                        {user.photoURL ? (
                            <img src={user.photoURL} alt="Profile" className="w-full h-full rounded-full object-cover border-2 border-black" />
                        ) : (
                            <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center text-white font-bold text-xl">
                                {user.email?.charAt(0).toUpperCase()}
                            </div>
                        )}
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{user.displayName || user.email?.split('@')[0]}</h2>
                        <div className="flex flex-col mt-1 space-y-1">
                            {userProfile?.isVip ? (
                                <>
                                    <span className="flex items-center w-fit text-xs font-bold text-vantage-purple bg-vantage-purple/10 px-2 py-0.5 rounded border border-vantage-purple/20">
                                        <Crown size={12} className="mr-1" />
                                        {t('profile.member_vip')}
                                    </span>
                                    {userProfile.vipExpiry && (
                                        <span className="text-[10px] text-gray-500">
                                            {t('profile.expires_on')}: {new Date(userProfile.vipExpiry).toLocaleDateString()}
                                        </span>
                                    )}
                                </>
                            ) : (
                                <span className="flex items-center w-fit text-xs font-bold text-gray-500 bg-gray-500/10 px-2 py-0.5 rounded border border-gray-500/20">
                                    <User size={12} className="mr-1" />
                                    {t('profile.member_free')}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Decor */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-vantage-cyan/10 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
            </GlassCard>

            {/* Referral Program Section */}
            <GlassCard className="border-vantage-purple/20 bg-vantage-purple/5">
                <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2 text-vantage-purple">
                        <Ticket size={20} />
                        <h3 className="text-sm font-bold uppercase tracking-wider">{t('profile.referral_program')}</h3>
                    </div>
                    <button onClick={shareReferral} className="p-1.5 bg-vantage-purple/10 rounded-lg hover:bg-vantage-purple/20 text-vantage-purple transition-colors">
                        <Share2 size={16} />
                    </button>
                </div>

                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{t('profile.referral_desc')}</p>

                {/* Code Display */}
                <div className="bg-slate-100 dark:bg-black/30 p-3 rounded-xl border border-slate-200 dark:border-white/10 flex items-center justify-between mb-4">
                    <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400 uppercase font-bold">{t('profile.referral_code')}</span>
                        <span className="text-lg font-bold font-orbitron text-slate-900 dark:text-white tracking-widest">
                            {userProfile?.referralCode || '...'}
                        </span>
                    </div>
                    <button onClick={copyReferralCode} className="p-2 bg-white dark:bg-white/10 rounded-lg shadow-sm hover:scale-105 transition-transform">
                        {copiedCode ? <CheckCircle2 size={18} className="text-green-500" /> : <Copy size={18} className="text-gray-500" />}
                    </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-white/50 dark:bg-white/5 rounded-xl p-3 flex flex-col items-center">
                        <span className="text-[10px] text-gray-500 uppercase">{t('profile.earnings')}</span>
                        <div className="flex items-center gap-1 text-vantage-purple">
                            <Coins size={14} />
                            <span className="text-xl font-bold">{userProfile?.referralEarnings || 0}</span>
                        </div>
                    </div>
                    <div className="bg-white/50 dark:bg-white/5 rounded-xl p-3 flex flex-col items-center">
                        <span className="text-[10px] text-gray-500 uppercase">{t('profile.lifetime_earnings')}</span>
                        <span className="text-xl font-bold text-slate-900 dark:text-white">{userProfile?.lifetimeEarnings || 0}</span>
                    </div>
                </div>

                {/* Payout Button */}
                <button
                    onClick={() => setShowPayoutModal(true)}
                    disabled={(userProfile?.referralEarnings || 0) < 1000}
                    className="w-full py-2.5 bg-vantage-purple/10 hover:bg-vantage-purple/20 text-vantage-purple border border-vantage-purple/30 font-bold rounded-lg transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Wallet size={16} />
                    <span>{t('profile.request_payout')}</span>
                </button>
            </GlassCard>

            {/* Payout Modal */}
            <AnimatePresence>
                {showPayoutModal && (
                    <>
                        {
                            // @ts-ignore
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => setShowPayoutModal(false)}
                                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                            />
                        }
                        {
                            // @ts-ignore
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xs bg-white dark:bg-vantage-bg border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-2xl z-50"
                            >
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">{t('profile.payout_modal_title')}</h3>
                                <form onSubmit={handleRequestPayout} className="space-y-4">
                                    <div>
                                        <input
                                            type="text"
                                            placeholder={t('profile.payout_phone_placeholder')}
                                            value={payoutPhone}
                                            onChange={(e) => setPayoutPhone(e.target.value)}
                                            className="w-full p-3 bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-vantage-purple outline-none"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <input
                                            type="number"
                                            placeholder={language === 'fr' ? 'Montant (min 1000 FCFA)' : 'Amount (min 1000 FCFA)'}
                                            value={payoutAmount}
                                            onChange={(e) => setPayoutAmount(e.target.value)}
                                            min={1000}
                                            max={userProfile?.referralEarnings || 0}
                                            className="w-full p-3 bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-vantage-purple outline-none"
                                            required
                                        />
                                    </div>
                                    <div className="bg-slate-50 dark:bg-white/5 p-3 rounded-lg text-sm flex justify-between">
                                        <span className="text-gray-500">{t('profile.earnings')}:</span>
                                        <span className="font-bold text-vantage-purple">{userProfile?.referralEarnings} FCFA</span>
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={payoutLoading}
                                        className="w-full py-3 bg-vantage-purple hover:bg-purple-600 text-white font-bold rounded-xl transition-colors disabled:opacity-50"
                                    >
                                        {payoutLoading ? "Processing..." : t('profile.payout_submit')}
                                    </button>
                                </form>
                                <button onClick={() => setShowPayoutModal(false)} className="absolute top-4 right-4 p-1 text-gray-500">
                                    <X size={20} />
                                </button>
                            </motion.div>
                        }
                    </>
                )}
            </AnimatePresence>

            {/* Stats Row */}
            <div className="grid grid-cols-2 gap-3">
                <GlassCard className="p-4 flex flex-col justify-between">
                    <div className="flex items-center space-x-2 text-gray-500 mb-2">
                        <Calendar size={16} />
                        <span className="text-xs uppercase tracking-wide">{t('profile.expiry')}</span>
                    </div>
                    <span className="text-lg font-bold font-orbitron text-slate-900 dark:text-white truncate">
                        {userProfile?.vipExpiry
                            ? new Date(userProfile.vipExpiry).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' })
                            : (userProfile?.isVip ? (language === 'fr' ? 'Illimité' : 'Unlimited') : (language === 'fr' ? 'Inactif' : 'Inactive'))}
                    </span>
                </GlassCard>
                <GlassCard className="p-4 flex flex-col justify-between">
                    <div className="flex items-center space-x-2 text-gray-500 mb-2">
                        <CreditCard size={16} />
                        <span className="text-xs uppercase tracking-wide">{t('profile.total_paid')}</span>
                    </div>
                    <span className="text-xl font-bold font-orbitron text-vantage-purple">
                        {(userProfile?.totalPaid || 0).toLocaleString()} <span className="text-xs text-vantage-purple/50">FCFA</span>
                    </span>
                </GlassCard>
            </div>

            {/* Menu List */}
            <div className="space-y-3">
                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-widest ml-1">{t('profile.general')}</h3>

                <GlassCard className="!p-0 overflow-hidden">
                    <button
                        onClick={() => navigate('/results')}
                        className="w-full flex items-center justify-between p-4 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors border-b border-slate-200 dark:border-white/5"
                    >
                        <div className="flex items-center space-x-3 text-slate-700 dark:text-gray-300">
                            <History size={20} />
                            <span className="font-medium">{language === 'fr' ? 'Historique & Résultats' : 'Past Results'}</span>
                        </div>
                        <ChevronRight size={18} className="text-gray-400" />
                    </button>
                    <button
                        onClick={() => navigate('/concierge')}
                        className="w-full flex items-center justify-between p-4 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors border-b border-slate-200 dark:border-white/5"
                    >
                        <div className="flex items-center space-x-3 text-vantage-cyan">
                            <Sparkles size={20} />
                            <span className="font-bold">{language === 'fr' ? 'Ticket Concierge' : 'Smart Ticket'}</span>
                        </div>
                        <ChevronRight size={18} className="text-gray-400" />
                    </button>

                    {/* Learning Hub (moved from bottom nav) */}
                    <button
                        onClick={() => navigate('/learn')}
                        className="w-full flex items-center justify-between p-4 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors border-b border-slate-200 dark:border-white/5"
                    >
                        <div className="flex items-center space-x-3 text-slate-700 dark:text-gray-300">
                            <BookOpen size={20} />
                            <div className="text-left">
                                <span className="font-bold block leading-tight">{language === 'fr' ? 'Centre d\'Apprentissage' : 'Learning Hub'}</span>
                                <span className="text-[10px] text-gray-500">Guides, strategy & betting basics</span>
                            </div>
                        </div>
                        <ChevronRight size={18} className="text-gray-400" />
                    </button>

                    <button
                        onClick={() => setShowSettings(true)}
                        className="w-full flex items-center justify-between p-4 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors border-b border-slate-200 dark:border-white/5"
                    >
                        <div className="flex items-center space-x-3 text-slate-700 dark:text-gray-300">
                            <Settings size={20} />
                            <span className="font-medium">{t('profile.settings_menu')}</span>
                        </div>
                        <ChevronRight size={18} className="text-gray-400" />
                    </button>
                    <button
                        onClick={replayTutorial}
                        className="w-full flex items-center justify-between p-4 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                    >
                        <div className="flex items-center space-x-3 text-vantage-cyan">
                            <RefreshCw size={20} />
                            <span className="font-bold">{language === 'fr' ? 'Revoir le Tutoriel' : 'Replay Tutorial'}</span>
                        </div>
                        <ChevronRight size={18} className="text-gray-400" />
                    </button>
                    <button
                        onClick={openWhatsApp}
                        className="w-full flex items-center justify-between p-4 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                    >
                        <div className="flex items-center space-x-3 text-slate-700 dark:text-gray-300">
                            <MessageCircle size={20} className="text-green-500" />
                            <span className="font-medium">{t('profile.support')}</span>
                        </div>
                        <ChevronRight size={18} className="text-gray-400" />
                    </button>
                </GlassCard>

                {userProfile?.isAdmin && (
                    <GlassCard className="!p-0 overflow-hidden border-red-500/30">
                        <a href="/admin" onClick={(e) => { e.preventDefault(); navigate('/admin'); }} className="w-full flex items-center justify-between p-4 hover:bg-red-500/5 transition-colors">
                            <div className="flex items-center space-x-3 text-red-500">
                                <ShieldAlert size={20} />
                                <span className="font-bold">{t('profile.admin_panel')}</span>
                            </div>
                            <ChevronRight size={18} className="text-red-500" />
                        </a>
                    </GlassCard>
                )}
            </div>

            {/* Logout Button */}
            <button
                onClick={logout}
                className="w-full py-4 mt-6 bg-slate-200 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/10 text-slate-900 dark:text-white font-bold rounded-xl transition-all border border-slate-300 dark:border-white/10 flex items-center justify-center space-x-2"
            >
                <LogOut size={20} />
                <span>{t('profile.logout')}</span>
            </button>

            <div className="text-center pt-4">
                <p className="text-[10px] text-gray-500">Vantage AI v4.0.2 • Build 2026</p>
            </div>
        </div>
    );
};
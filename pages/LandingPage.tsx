import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Zap, TrendingUp, ShieldCheck, ArrowRight, CheckCircle, XCircle, Target, Briefcase, ChevronDown, Lock, AlertTriangle, Bell, Calculator, HelpCircle, Smartphone, FileText, MapPin, Trophy } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { TeamLogo } from '../components/TeamLogo';
import { SiteFooter } from '../components/SiteFooter';
import { getFirestorePredictionsOnly, getPredictionsForDate } from '../services/db';
import { Match } from '../types';

interface LandingPageProps {
    onGetStarted: () => void;
    onLogin: () => void;
    onShowStats: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onGetStarted, onLogin, onShowStats }) => {
    const [liveMatch, setLiveMatch] = useState<Match | null>(null);
    const [loadingHero, setLoadingHero] = useState(true);
    const [openFaq, setOpenFaq] = useState<number | null>(null);

    useEffect(() => {
        // Load today's top prediction for the live scan demo
        (async () => {
            try {
                const predictions = await getFirestorePredictionsOnly();
                if (predictions && predictions.length > 0) {
                    const top = [...predictions].sort((a, b) => b.confidence - a.confidence)[0];
                    setLiveMatch(top);
                }
            } catch (_) {
                // Fail silently
            } finally {
                setLoadingHero(false);
            }
        })();
    }, []);

    const heroMatch = liveMatch || {
        homeTeam: 'Real Madrid',
        awayTeam: 'Man City',
        homeTeamLogo: 'https://upload.wikimedia.org/wikipedia/en/5/56/Real_Madrid_CF.svg',
        awayTeamLogo: 'https://upload.wikimedia.org/wikipedia/en/e/eb/Manchester_City_FC_badge.svg',
        league: 'Champions League',
        time: '20:45',
        prediction_en: 'BTTS & Over 2.5',
        prediction: 'BTTS & Over 2.5',
        confidence: 87,
        odds: 2.15,
        category: 'safe' as const,
        id: 'fallback',
    };

    const scrollToPricing = () => {
        document.getElementById('pricing-section')?.scrollIntoView({ behavior: 'smooth' });
    };

    const faqs = [
        {
            q: 'Is this guaranteed to win every time?',
            a: 'No. Anyone promising a 100% win rate is lying to you. Vantage AI is built to find long-term positive expected value, not certainty. You will lose some bets, so the bankroll strategy matters as much as the pick.'
        },
        {
            q: 'Do I need a massive bankroll to start?',
            a: 'Not at all. Our portfolio management system is designed to work with any starting bankroll. It calculates your exact bet size based on mathematical percentages, so you never risk ruin.'
        },
        {
            q: 'How does the AI find Positive EV?',
            a: 'Our Quant Engine analyzes Expected Goals (xG), historic form, injuries, and line movement. When the bookmaker sets the odds too high compared to the real mathematical probability, our system flags it as a "Value Bet".'
        }
    ];

    return (
        <div className="relative flex flex-col min-h-screen pb-10 overflow-x-hidden bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.10),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(168,85,247,0.10),transparent_55%)]">
            {/* 1. Header Navigation */}
            <div className="flex justify-between items-center py-4 px-2 md:px-8 mb-8 md:mb-12 sticky top-0 z-50 bg-slate-950/55 backdrop-blur-xl border-b border-white/10 shadow-lg shadow-black/20">
                <h1 className="text-xl md:text-2xl font-bold font-orbitron text-slate-900 dark:text-white">
                    VANTAGE<span className="text-vantage-cyan">AI</span>
                </h1>
                <div className="flex items-center gap-3 md:gap-6">
                    <button onClick={scrollToPricing} className="text-xs md:text-sm font-bold text-slate-600 dark:text-gray-300 hover:text-vantage-cyan transition-colors">
                        VIP Plans
                    </button>
                    <button onClick={() => window.location.href = '/blog'} className="text-xs md:text-sm font-bold text-slate-600 dark:text-gray-300 hover:text-vantage-cyan transition-colors">
                        Free Blog
                    </button>
                    <Link to="/tools" className="text-xs md:text-sm font-bold text-slate-600 dark:text-gray-300 hover:text-vantage-cyan transition-colors">
                        Tools
                    </Link>
                    <Link to="/about" className="hidden md:inline text-xs md:text-sm font-bold text-slate-600 dark:text-gray-300 hover:text-vantage-cyan transition-colors">
                        About
                    </Link>
                    <button onClick={onShowStats} className="text-xs md:text-sm font-bold text-slate-600 dark:text-gray-300 hover:text-vantage-cyan transition-colors flex items-center gap-1">
                        <TrendingUp size={14} />
                        <span className="hidden md:inline">Track Record</span>
                    </button>
                    <button onClick={onLogin} className="text-sm font-bold bg-white/10 px-4 py-2 rounded-lg text-slate-900 dark:text-white hover:bg-white/20 transition-colors border border-gray-200 dark:border-white/10">
                        Login
                    </button>
                </div>
            </div>

            {/* 2. High-Conversion Hero Section */}
            <div className="relative -mx-4 md:-mx-8 mb-16 min-h-[620px] overflow-hidden px-4 py-20 text-center md:min-h-[680px] md:px-8 md:py-24 flex flex-col items-center justify-center">
                <img
                    src="/images/football-hero.jpg"
                    srcSet="/images/football-hero-800.jpg 800w, /images/football-hero.jpg 1600w"
                    sizes="100vw"
                    alt=""
                    aria-hidden="true"
                    width={1600}
                    height={1373}
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="eager"
                    fetchPriority="high"
                />
                <div className="absolute inset-0 bg-slate-950/75 dark:bg-slate-950/80" />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.55)_0%,rgba(15,23,42,0.25)_45%,rgba(15,23,42,0.92)_100%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.16)_0%,transparent_52%)] pointer-events-none" />

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 inline-flex items-center space-x-2 bg-emerald-400/10 border border-emerald-300/30 rounded-full px-4 py-1.5 mb-6 backdrop-blur-md">
                    <CheckCircle size={14} className="text-green-500" />
                    <span className="text-[11px] font-bold tracking-widest text-emerald-200 uppercase">Verified Edge over Bookmakers</span>
                </motion.div>

                <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="relative z-10 text-4xl md:text-6xl lg:text-7xl font-black font-orbitron text-white leading-[1.1] mb-6 max-w-4xl mx-auto drop-shadow-2xl">
                    Bet With Structure. <br className="hidden md:block" />
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-vantage-cyan to-vantage-purple">
                        Let Data Lead the Stake.
                    </span>
                </motion.h1>

                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="relative z-10 text-base md:text-xl text-slate-200 max-w-2xl mx-auto mb-10 leading-relaxed">
                    AI football predictions for Cameroon — 1xBet, Premier Bet, BetPawa and Elite One. Our quantitative model finds <span className="font-bold text-white">Positive EV (+EV)</span> bets, and fractional Kelly staking tells you exactly how much to stake.
                </motion.p>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="relative z-10 flex flex-col sm:flex-row items-center justify-center gap-3 w-full sm:w-auto">
                    <button onClick={onGetStarted} className="w-full sm:w-auto py-4 px-10 bg-gradient-to-r from-vantage-cyan to-cyan-400 text-slate-950 font-black text-lg rounded-xl shadow-[0_0_40px_-5px_rgba(34,211,238,0.6)] hover:scale-[1.03] transition-all flex items-center justify-center gap-2">
                        Get Started Free
                        <ArrowRight size={20} />
                    </button>
                    <button onClick={scrollToPricing} className="w-full sm:w-auto py-4 px-8 bg-white/10 border border-white/15 text-white font-bold text-lg rounded-xl hover:bg-white/15 transition-all flex items-center justify-center gap-2 backdrop-blur-xl">
                        <Lock size={18} className="text-slate-300" />
                        View VIP Plans
                    </button>
                    <a href="https://play.google.com/store/apps/details?id=com.vantageai.app&hl=en" target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto py-4 px-6 bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 font-bold text-lg rounded-xl hover:bg-emerald-500/25 transition-all flex items-center justify-center gap-2 backdrop-blur-xl">
                        <Smartphone size={18} /> Get the app
                    </a>
                </motion.div>
                <p className="relative z-10 text-[11px] text-slate-300 mt-4 font-semibold uppercase tracking-[0.18em]">No credit card required for free picks</p>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="relative z-10 mt-10 grid grid-cols-3 gap-2 sm:gap-3 w-full max-w-2xl">
                    {[{ v: '1,000+', l: 'Bets tracked' }, { v: '67.4%', l: 'Hit rate*' }, { v: '7.9%', l: 'Avg ROI*' }].map(s => (
                        <div key={s.l} className="rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl px-2 py-3 text-center shadow-lg shadow-black/20">
                            <p className="text-xl sm:text-2xl font-black font-orbitron text-white">{s.v}</p>
                            <p className="text-[8px] sm:text-[10px] font-bold uppercase tracking-widest text-cyan-200/80">{s.l}</p>
                        </div>
                    ))}
                </motion.div>
            </div>

            <p className="text-[10px] text-gray-500 dark:text-gray-600 text-center px-4 mb-16 max-w-2xl mx-auto">
                *Past performance is not indicative of future results. All betting involves risk. Our data-driven predictions identify positive expected value but do not guarantee wins. 18+
            </p>

            {/* 4. Education: The 3-Step Blueprint */}
            <div className="max-w-6xl mx-auto px-4 mb-24">
                <div className="text-center mb-12">
                    <span className="inline-block text-[10px] font-black uppercase tracking-[0.25em] text-vantage-cyan/80 mb-3">The method</span>
                    <h2 className="text-2xl md:text-4xl font-black text-slate-900 dark:text-white mb-4">
                        How You Actually <span className="text-transparent bg-clip-text bg-gradient-to-r from-vantage-cyan to-vantage-purple">Win Money</span>
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400 max-w-xl mx-auto">It's not about guessing the winner. It's about math, probabilities, and bankroll management.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                    {[
                        { icon: <Zap size={30} className="text-cyan-300" />, tile: 'from-cyan-400/25 to-cyan-400/5 border-cyan-400/30', title: '1. The Quant Engine', desc: 'Our AI analyzes thousands of data points including Expected Goals (xG), injuries, and line movement to calculate the true mathematical probability of a match.' },
                        { icon: <Target size={30} className="text-purple-300" />, tile: 'from-purple-400/25 to-purple-400/5 border-purple-400/30', title: '2. Positive EV (+EV)', desc: 'When the bookmaker sets odds higher than our calculated true probability, it creates a value opportunity. Over a large sample, consistently finding +EV is how disciplined bettors build an edge.' },
                        { icon: <Briefcase size={30} className="text-emerald-300" />, tile: 'from-emerald-400/25 to-emerald-400/5 border-emerald-400/30', title: '3. Kelly Sizing', desc: "We don't just give you the pick. Our built-in risk manager calculates exactly how much to stake using the Kelly Criterion to maximize growth and prevent ruin." },
                    ].map(c => (
                        <div key={c.title} className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-7 text-center transition-all hover:-translate-y-1 hover:border-white/20">
                            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
                            <div className={`w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br ${c.tile} border flex items-center justify-center mb-6 shadow-lg shadow-black/30`}>{c.icon}</div>
                            <h3 className="text-lg font-black text-slate-900 dark:text-white mb-2">{c.title}</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{c.desc}</p>
                        </div>
                    ))}
                </div>
            </div>



            {/* 5b. Arbitrage Finder Teaser */}
            <div className="max-w-6xl mx-auto px-4 mb-24">
                <div className="relative overflow-hidden rounded-3xl border border-amber-400/20 bg-slate-900/60 backdrop-blur-xl p-8 md:p-12 shadow-2xl shadow-black/30">
                    <div className="absolute -top-32 -right-24 w-80 h-80 rounded-full bg-amber-400/10 blur-[110px] pointer-events-none" />
                    <div className="flex flex-col md:flex-row items-center gap-10">
                        <div className="flex-1 relative z-10 space-y-6 text-center md:text-left">
                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-full">
                                <Zap size={14} className="text-yellow-400" />
                                <span className="text-xs font-bold text-yellow-400 uppercase tracking-wider">VIP Feature</span>
                            </div>
                            <h2 className="text-3xl md:text-4xl font-bold font-orbitron text-white leading-tight">
                                <span className="text-yellow-400">Arb</span> Finder.
                            </h2>
                            <p className="text-gray-400 text-lg max-w-md">
                                We scan hundreds of bookmakers for arbitrage opportunities. When prices line up correctly, you can cover all outcomes and lock a small mathematical edge before odds move.
                            </p>
                            <ul className="space-y-3 text-left max-w-md mx-auto md:mx-0">
                                <li className="flex items-center gap-3">
                                    <CheckCircle size={18} className="text-yellow-400 shrink-0" />
                                    <span className="text-gray-300">Live scanning of 50+ bookmakers</span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <CheckCircle size={18} className="text-yellow-400 shrink-0" />
                                    <span className="text-gray-300">Instant alerts when arb is found</span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <CheckCircle size={18} className="text-yellow-400 shrink-0" />
                                    <span className="text-gray-300">Built-in calculator for exact stakes</span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <CheckCircle size={18} className="text-yellow-400 shrink-0" />
                                    <span className="text-gray-300">Designed for locked-edge opportunities</span>
                                </li>
                            </ul>
                        </div>

                        {/* Mockup UI */}
                        <div className="flex-1 w-full max-w-md relative z-10">
                            <div className="rounded-2xl border border-white/10 bg-white/[0.05] backdrop-blur-xl p-5 shadow-2xl">
                                <div className="flex justify-between items-center mb-4">
                                    <div className="flex items-center gap-2">
                                        <Zap size={18} className="text-yellow-400" />
                                        <span className="text-white font-bold text-sm">Live Arb Found</span>
                                    </div>
                                    <span className="text-xs text-green-400 bg-green-500/10 px-2 py-1 rounded border border-green-500/20">+2.3%</span>
                                </div>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center p-3 bg-white/5 rounded-lg">
                                        <div>
                                            <p className="text-xs text-gray-400">Home Win</p>
                                            <p className="text-white font-bold">1.85</p>
                                        </div>
                                        <span className="text-xs text-gray-500">Betway</span>
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-white/5 rounded-lg">
                                        <div>
                                            <p className="text-xs text-gray-400">Draw</p>
                                            <p className="text-white font-bold">4.20</p>
                                        </div>
                                        <span className="text-xs text-gray-500">1xBet</span>
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-white/5 rounded-lg">
                                        <div>
                                            <p className="text-xs text-gray-400">Away Win</p>
                                            <p className="text-white font-bold">5.50</p>
                                        </div>
                                        <span className="text-xs text-gray-500">22Bet</span>
                                    </div>
                                </div>
                                <div className="mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                                    <p className="text-xs text-gray-400 text-center">Calculated Edge</p>
                                    <p className="text-lg font-black text-green-400 text-center">+2.3%</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 6. Pricing Section */}
            <div id="pricing-section" className="max-w-6xl mx-auto px-4 mb-24">
                <div className="text-center mb-12">
                    <span className="inline-block text-[10px] font-black uppercase tracking-[0.25em] text-vantage-cyan/80 mb-3">Plans</span>
                    <h2 className="text-3xl md:text-4xl font-black font-orbitron text-slate-900 dark:text-white mb-4">Join the <span className="text-transparent bg-clip-text bg-gradient-to-r from-vantage-cyan to-vantage-purple">Syndicate</span></h2>
                    <p className="text-gray-500 dark:text-gray-400">Skip guesswork. Use verified quantitative data and disciplined staking.</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
                    {/* Free Tier */}
                    <GlassCard className="flex flex-col p-8 opacity-80 hover:opacity-100 transition-opacity">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Free</h3>
                        <p className="text-3xl font-black text-slate-900 dark:text-white mb-6">0 F<span className="text-sm font-medium text-gray-500">/mo</span></p>
                        <ul className="space-y-3 mb-8 flex-1">
                            <li className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                <CheckCircle size={16} className="text-green-500" /> 1-2 Basic Picks Daily
                            </li>
                            <li className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                <CheckCircle size={16} className="text-green-500" /> Public Blog Access
                            </li>
                            <li className="flex items-center gap-2 text-sm text-gray-400 line-through">
                                <XCircle size={16} className="text-gray-400" /> No Portfolio Tracking
                            </li>
                            <li className="flex items-center gap-2 text-sm text-gray-400 line-through">
                                <XCircle size={16} className="text-gray-400" /> No +EV Accumulators
                            </li>
                        </ul>
                        <button onClick={onGetStarted} className="w-full py-3 bg-slate-200 dark:bg-white/10 text-slate-900 dark:text-white font-bold rounded-xl hover:bg-slate-300 dark:hover:bg-white/20 transition-colors">
                            Sign Up Free
                        </button>
                    </GlassCard>

                    {/* VIP Monthly (Popular) */}
                    <GlassCard className="flex flex-col p-8 border-vantage-cyan/40 relative md:-translate-y-4 shadow-[0_0_70px_-20px_rgba(34,211,238,0.5)] bg-gradient-to-b from-vantage-cyan/10 to-transparent">
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-vantage-cyan text-slate-900 text-[10px] font-black uppercase tracking-widest px-4 py-1 rounded-full">
                            Most Popular
                        </div>
                        <h3 className="text-lg font-bold text-vantage-cyan mb-2">VIP Monthly</h3>
                        <p className="text-4xl font-black text-slate-900 dark:text-white mb-6 font-orbitron">5,000 F<span className="text-sm font-medium text-gray-500 font-sans">/mo</span></p>
                        <ul className="space-y-3 mb-8 flex-1">
                            <li className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                                <CheckCircle size={16} className="text-vantage-cyan" /> Full Daily Dashboard
                            </li>
                            <li className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                                <CheckCircle size={16} className="text-vantage-cyan" /> Portfolio Management
                            </li>
                            <li className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                                <CheckCircle size={16} className="text-vantage-cyan" /> AI Accumulators & Smart Tickets
                            </li>
                            <li className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                                <CheckCircle size={16} className="text-vantage-cyan" /> Kelly Sizing Calculator
                            </li>
                        </ul>
                        <button onClick={onLogin} className="w-full py-4 bg-gradient-to-r from-vantage-cyan to-cyan-400 text-slate-950 font-black rounded-xl hover:scale-[1.02] transition-transform shadow-[0_0_30px_-5px_rgba(34,211,238,0.6)]">
                            Upgrade to VIP
                        </button>
                    </GlassCard>

                    {/* VIP Weekly */}
                    <GlassCard className="flex flex-col p-8 opacity-90 hover:opacity-100 transition-opacity">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">VIP Weekly</h3>
                        <p className="text-3xl font-black text-slate-900 dark:text-white mb-6">2,000 F<span className="text-sm font-medium text-gray-500">/wk</span></p>
                        <ul className="space-y-3 mb-8 flex-1">
                            <li className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                <CheckCircle size={16} className="text-green-500" /> Full Daily Dashboard
                            </li>
                            <li className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                <CheckCircle size={16} className="text-green-500" /> Portfolio Tracking
                            </li>
                            <li className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                <CheckCircle size={16} className="text-green-500" /> AI Accumulators
                            </li>
                        </ul>
                        <button onClick={onLogin} className="w-full py-3 bg-slate-200 dark:bg-white/10 text-slate-900 dark:text-white font-bold rounded-xl hover:bg-slate-300 dark:hover:bg-white/20 transition-colors">
                            Try 1 Week
                        </button>
                    </GlassCard>
                </div>
                {/* Daily Pass Option */}
                <div className="mt-6 text-center">
                    <p className="text-sm text-gray-500">Just want to try it out? <button onClick={onLogin} className="text-vantage-cyan font-bold hover:underline">Get a 24-Hour Pass for 500 FCFA</button> inside the app.</p>
                </div>
            </div>

            {/* 7. FAQ Section */}
            <div className="max-w-3xl mx-auto px-4 mb-24 w-full">
                <div className="text-center mb-10">
                    <span className="inline-block text-[10px] font-black uppercase tracking-[0.25em] text-vantage-cyan/80 mb-3">FAQ</span>
                    <h2 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white">Frequently Asked <span className="text-transparent bg-clip-text bg-gradient-to-r from-vantage-cyan to-vantage-purple">Questions</span></h2>
                </div>
                <div className="space-y-3">
                    {faqs.map((faq, i) => (
                        <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl overflow-hidden transition-all hover:border-white/20">
                            <button 
                                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                                className="w-full px-6 py-4 flex items-center justify-between font-bold text-slate-900 dark:text-white text-left"
                            >
                                {faq.q}
                                <ChevronDown size={18} className={`text-gray-400 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                            </button>
                            <AnimatePresence>
                                {openFaq === i && (
                                    <motion.div 
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden"
                                    >
                                        <div className="px-6 pb-4 text-sm text-gray-500 dark:text-gray-400 leading-relaxed border-t border-gray-100 dark:border-white/5 pt-3">
                                            {faq.a}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    ))}
                </div>
            </div>

            {/* 7a. Coverage: cities, leagues, markets */}
            <div className="max-w-5xl mx-auto px-4 mb-20">
                <div className="text-center mb-8">
                    <span className="inline-block text-[10px] font-black uppercase tracking-[0.25em] text-vantage-cyan/80 mb-3">Coverage</span>
                    <h2 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white mb-3">Football Betting <span className="text-transparent bg-clip-text bg-gradient-to-r from-vantage-cyan to-vantage-purple">Across Cameroon</span></h2>
                    <p className="text-gray-500 dark:text-gray-400 max-w-2xl mx-auto text-sm">
                        Local guides for every major city, Elite One and the world's biggest leagues — with 1xBet, Premier Bet and BetPawa odds.
                    </p>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-5">
                        <div className="flex items-center gap-2 mb-3">
                            <MapPin size={16} className="text-vantage-cyan" />
                            <h3 className="text-sm font-black text-slate-900 dark:text-white">Cities we cover</h3>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {[
                                ['douala', 'Douala'], ['yaounde', 'Yaoundé'], ['bafoussam', 'Bafoussam'],
                                ['bamenda', 'Bamenda'], ['garoua', 'Garoua'], ['maroua', 'Maroua'],
                                ['buea', 'Buea'], ['limbe', 'Limbe'], ['kribi', 'Kribi'], ['ngaoundere', 'Ngaoundéré'],
                            ].map(([slug, name]) => (
                                <Link key={slug} to={`/football-betting/${slug}`} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/70 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-slate-700 dark:text-gray-300 hover:border-vantage-cyan/50 transition-colors">
                                    {name}
                                </Link>
                            ))}
                        </div>
                        <Link to="/football-betting" className="inline-block mt-3 text-[11px] font-bold text-vantage-cyan">
                            All city betting guides →
                        </Link>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-5">
                        <div className="flex items-center gap-2 mb-3">
                            <Trophy size={16} className="text-vantage-purple" />
                            <h3 className="text-sm font-black text-slate-900 dark:text-white">Leagues we analyse</h3>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {[
                                ['premier-league', 'Premier League'], ['la-liga', 'La Liga'], ['serie-a', 'Serie A'],
                                ['bundesliga', 'Bundesliga'], ['ligue-1', 'Ligue 1'], ['champions-league', 'Champions League'],
                                ['elite-one', 'Elite One'], ['fifa-world-cup', 'World Cup'],
                            ].map(([slug, name]) => (
                                <Link key={slug} to={`/pronostics/${slug}`} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/70 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-slate-700 dark:text-gray-300 hover:border-vantage-purple/50 transition-colors">
                                    {name}
                                </Link>
                            ))}
                        </div>
                        <Link to="/blog" className="inline-block mt-3 text-[11px] font-bold text-vantage-cyan">
                            Daily league analysis →
                        </Link>
                    </div>
                </div>

                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                    {['1X2 & Double Chance', 'Over/Under Goals', 'Both Teams to Score', 'Asian Handicap', 'Correct Score', 'Accumulators', 'Live Betting', 'Value & EV'].map(m => (
                        <div key={m} className="rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-md px-3 py-2 text-[10px] font-bold text-slate-600 dark:text-gray-400 text-center">
                            {m}
                        </div>
                    ))}
                </div>
            </div>

            {/* 7b. Company & Resources */}
            <div className="max-w-5xl mx-auto px-4 mb-20">
                <div className="text-center mb-8">
                    <span className="inline-block text-[10px] font-black uppercase tracking-[0.25em] text-vantage-cyan/80 mb-3">Resources</span>
                    <h2 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white mb-3">Explore <span className="text-transparent bg-clip-text bg-gradient-to-r from-vantage-cyan to-vantage-purple">Vantage AI</span></h2>
                    <p className="text-gray-500 dark:text-gray-400 max-w-xl mx-auto text-sm">Tools, guides and company information — everything you need before you sign up.</p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                        { to: '/tools', icon: <Calculator size={18} />, label: 'Betting Tools', desc: 'Odds, EV, Kelly' },
                        { to: '/how-it-works', icon: <Target size={18} />, label: 'How It Works', desc: 'Our pipeline' },
                        { to: '/about', icon: <Briefcase size={18} />, label: 'About Us', desc: 'Our mission' },
                        { to: '/contact', icon: <Bell size={18} />, label: 'Contact Us', desc: 'Get support' },
                        { to: '/faq', icon: <HelpCircle size={18} />, label: 'FAQ', desc: 'Common questions' },
                        { to: '/download', icon: <Smartphone size={18} />, label: 'Android App', desc: 'Free on Play Store' },
                        { to: '/responsible-gambling', icon: <ShieldCheck size={18} />, label: 'Responsible', desc: 'Play safe (18+)' },
                        { to: '/terms', icon: <FileText size={18} />, label: 'Terms', desc: 'Service terms' },
                    ].map(item => (
                        <Link
                            key={item.to}
                            to={item.to}
                            className="group rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-4 hover:border-vantage-cyan/50 hover:-translate-y-0.5 transition-all"
                        >
                            <span className="text-vantage-cyan">{item.icon}</span>
                            <p className="text-xs font-black text-slate-900 dark:text-white mt-2">{item.label}</p>
                            <p className="text-[10px] text-gray-500 mt-0.5">{item.desc}</p>
                        </Link>
                    ))}
                </div>
            </div>

            {/* 8. Download App Section */}
            <div className="max-w-4xl mx-auto px-4 mb-20 w-full">
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.3 }}
                    transition={{ duration: 0.5 }}
                    className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-vantage-purple/15 via-vantage-purple/5 to-vantage-cyan/10 border border-vantage-purple/25 backdrop-blur-xl p-8 md:p-12 text-center shadow-2xl shadow-black/30"
                >
                    {/* decorative glow */}
                    <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-vantage-cyan/10 blur-[90px] pointer-events-none" />

                    <div className="relative">
                        <h2 className="text-2xl md:text-3xl font-black font-orbitron text-slate-900 dark:text-white mb-3">
                            Get the <span className="text-vantage-purple">Vantage AI</span> App
                        </h2>
                        <p className="text-sm md:text-base text-gray-500 dark:text-gray-300 max-w-xl mx-auto mb-8">
                            Your predictions, live scores and VIP signals — right on your phone.
                            Android + Web, free forever.
                        </p>

                        <div className="flex flex-wrap justify-center gap-3 mb-8">
                            {[
                                { icon: <Bell size={15} />, label: 'Real-time alerts' },
                                { icon: <TrendingUp size={15} />, label: 'Live picks & EV' },
                                { icon: <ShieldCheck size={15} />, label: 'Bankroll safeguards' },
                            ].map((f, i) => (
                                <span key={i} className="flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-full bg-white/70 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-slate-700 dark:text-gray-300">
                                    <span className="text-vantage-cyan">{f.icon}</span> {f.label}
                                </span>
                            ))}
                        </div>

                        {/* Google Play button */}
                        <a
                            href="https://play.google.com/store/apps/details?id=com.vantageai.app&hl=en"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-4 rounded-2xl bg-slate-900 hover:bg-slate-800 active:scale-95 transition-all px-6 py-3 text-white shadow-xl shadow-slate-900/20"
                        >
                            <svg viewBox="0 0 512 512" className="w-9 h-9 shrink-0 fill-current" aria-hidden="true">
                                <path d="M99.617 8.057a50.191 50.191 0 0 0-19.372 5.286l194.268 261.64L468.514 13.343a50.19 50.19 0 0 0-19.372-5.286H99.617zm-25.898 12.06A50.191 50.191 0 0 0 64 39.224v433.552c0 8.47 3.397 16.88 9.584 23.41l235.02-252.962L73.719 20.117zM320 276.09l-50.73 54.607L339 403.3l124.264-71.47-57.61-55.74L320 276.09z"/>
                            </svg>
                            <span className="text-left leading-tight">
                                <span className="block text-[9px] uppercase tracking-widest text-gray-300">Get it on</span>
                                <span className="block text-lg font-bold font-sans">Google Play</span>
                            </span>
                        </a>
                    </div>
                </motion.div>
            </div>

            <SiteFooter />
        </div>
    );
};

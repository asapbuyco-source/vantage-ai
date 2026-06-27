import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Zap, TrendingUp, ShieldCheck, ArrowRight, CheckCircle, XCircle, Target, Briefcase, ChevronDown, Lock, AlertTriangle } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { TeamLogo } from '../components/TeamLogo';
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
        <div className="flex flex-col min-h-screen pb-10">
            {/* 1. Header Navigation */}
            <div className="flex justify-between items-center py-4 px-2 md:px-8 mb-8 md:mb-12 sticky top-0 z-50 bg-slate-50/80 dark:bg-[#0a0f1c]/80 backdrop-blur-lg border-b border-gray-200 dark:border-white/5">
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
                    alt=""
                    aria-hidden="true"
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
                    Vantage AI uses quantitative modeling and fractional Kelly staking to find <span className="font-bold text-white">Positive EV (+EV)</span> bets. We tell you what to bet, and exactly how much to stake to grow your bankroll safely.
                </motion.p>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="relative z-10 flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto">
                    <button onClick={onGetStarted} className="w-full sm:w-auto py-4 px-10 bg-vantage-cyan text-slate-900 font-black text-lg rounded-xl shadow-[0_0_30px_rgba(34,211,238,0.3)] hover:scale-105 hover:shadow-[0_0_40px_rgba(34,211,238,0.5)] transition-all flex items-center justify-center gap-2">
                        Get Started Free
                        <ArrowRight size={20} />
                    </button>
                    <button onClick={scrollToPricing} className="w-full sm:w-auto py-4 px-8 bg-white/10 border border-white/20 text-white font-bold text-lg rounded-xl hover:bg-white/15 transition-all flex items-center justify-center gap-2 backdrop-blur-md">
                        <Lock size={18} className="text-slate-300" />
                        View VIP Plans
                    </button>
                </motion.div>
                <p className="relative z-10 text-xs text-slate-300 mt-4 font-medium uppercase tracking-widest">No credit card required for free picks</p>
            </div>

            {/* 3. Social Proof Ticker */}
            <div className="w-full bg-slate-900 dark:bg-black/40 border-y border-white/10 py-6 mb-4 overflow-hidden relative">
                <div className="max-w-6xl mx-auto px-4 grid grid-cols-1 md:grid-cols-3 gap-8 text-center divide-y md:divide-y-0 md:divide-x divide-white/10">
                    <div className="flex flex-col items-center justify-center pt-4 md:pt-0">
                        <span className="text-4xl font-black text-white font-orbitron mb-1">1,000+</span>
                        <span className="text-xs font-bold text-vantage-cyan uppercase tracking-widest">Bets Tracked</span>
                    </div>
                    <div className="flex flex-col items-center justify-center pt-4 md:pt-0">
                        <span className="text-4xl font-black text-white font-orbitron mb-1">67.4%</span>
                        <span className="text-xs font-bold text-vantage-cyan uppercase tracking-widest">Historical Performance*</span>
                    </div>
                    <div className="flex flex-col items-center justify-center pt-4 md:pt-0">
                        <span className="text-4xl font-black text-white font-orbitron mb-1">7.9%</span>
                        <span className="text-xs font-bold text-green-400 uppercase tracking-widest">Avg. ROI*</span>
                    </div>
                </div>
            </div>
            <p className="text-[10px] text-gray-500 dark:text-gray-600 text-center px-4 mb-16 max-w-2xl mx-auto">
                *Past performance is not indicative of future results. All betting involves risk. Our data-driven predictions identify positive expected value but do not guarantee wins. 18+
            </p>

            {/* 4. Education: The 3-Step Blueprint */}
            <div className="max-w-6xl mx-auto px-4 mb-24">
                <div className="text-center mb-12">
                    <h2 className="text-2xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4">How You Actually Win Money</h2>
                    <p className="text-gray-500 max-w-xl mx-auto">It's not about guessing the winner. It's about math, probabilities, and bankroll management.</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <GlassCard className="flex flex-col items-center text-center p-8 hover:border-vantage-cyan/50 transition-colors">
                        <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-6 border border-blue-500/20">
                            <Zap size={32} className="text-blue-500" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-3">1. The Quant Engine</h3>
                        <p className="text-sm text-gray-500">Our AI analyzes thousands of data points including Expected Goals (xG), injuries, and line movement to calculate the true mathematical probability of a match.</p>
                    </GlassCard>
                    
                    <GlassCard className="flex flex-col items-center text-center p-8 hover:border-purple-500/50 transition-colors">
                        <div className="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-6 border border-purple-500/20">
                            <Target size={32} className="text-purple-500" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-3">2. Positive EV (+EV)</h3>
                        <p className="text-sm text-gray-500">When the bookmaker sets odds higher than our calculated true probability, it creates a value opportunity. Over a large sample, consistently finding +EV is how disciplined bettors build an edge.</p>
                    </GlassCard>
                    
                    <GlassCard className="flex flex-col items-center text-center p-8 hover:border-green-500/50 transition-colors">
                        <div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center mb-6 border border-green-500/20">
                            <Briefcase size={32} className="text-green-500" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-3">3. Kelly Sizing</h3>
                        <p className="text-sm text-gray-500">We don't just give you the pick. Our built-in risk manager calculates exactly how much to stake using the Kelly Criterion to maximize growth and prevent ruin.</p>
                    </GlassCard>
                </div>
            </div>



            {/* 5b. Arbitrage Finder Teaser */}
            <div className="max-w-6xl mx-auto px-4 mb-24">
                <div className="bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 rounded-3xl p-8 md:p-12">
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
                            <div className="bg-slate-800 border border-yellow-500/20 rounded-2xl p-5 shadow-2xl">
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
                    <h2 className="text-3xl font-bold font-orbitron text-slate-900 dark:text-white mb-4">Join the Syndicate</h2>
                    <p className="text-gray-500">Skip guesswork. Use verified quantitative data and disciplined staking.</p>
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
                    <GlassCard className="flex flex-col p-8 border-vantage-cyan/50 relative transform md:-translate-y-4 shadow-2xl">
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
                        <button onClick={onLogin} className="w-full py-4 bg-vantage-cyan text-slate-900 font-bold rounded-xl hover:scale-105 transition-transform shadow-[0_0_20px_rgba(34,211,238,0.3)]">
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
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Frequently Asked Questions</h2>
                </div>
                <div className="space-y-3">
                    {faqs.map((faq, i) => (
                        <div key={i} className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden transition-all">
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

            {/* Footer Minimal */}
            <footer className="text-center py-8 border-t border-gray-200 dark:border-white/5">
                <h3 className="text-lg font-bold font-orbitron text-slate-900 dark:text-white mb-2">
                    VANTAGE<span className="text-vantage-cyan">AI</span>
                </h3>
                <p className="text-xs text-gray-500 max-w-md mx-auto mb-4 px-4">
                    Sports trading involves significant risk. Our platform provides data and mathematical models, not financial advice. Past performance does not guarantee future results.
                </p>
                <div className="flex justify-center gap-4 text-xs text-gray-400">
                    <a href="/privacy-policy" className="hover:text-vantage-cyan transition-colors">Privacy Policy</a>
                </div>
            </footer>
        </div>
    );
};

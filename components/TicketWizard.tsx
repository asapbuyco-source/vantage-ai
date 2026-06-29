import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
    Sparkles, TrendingUp, Target, ShieldCheck,
    Flame, RefreshCw, Check, ChevronRight,
    Wallet, DollarSign, Wand2, Info, BrainCircuit, Loader2
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useData } from '../context/DataContext';
import { GlassCard } from './GlassCard';
import { TeamLogo } from './TeamLogo';
import { useAuth } from '../context/AuthContext';
import { Match, NavigationTab } from '../types';

const backendUrl = import.meta.env.VITE_BACKEND_URL || '';

interface TicketWizardProps {}

type RiskLevel = 'low' | 'med' | 'high';

const DEFAULT_SPORT = 'football';

function getMatchKey(match: Match): string {
    return String(match.fixture_id ?? match.fixtureId ?? match.id);
}

function getMatchSport(match: Match): string {
    return match.sport ?? DEFAULT_SPORT;
}

function getModelProbability(match: Match): number {
    return match.calibrated_probability ?? match.probability ?? ((match.confidence ?? 0) / 100);
}

function getExpectedValue(match: Match): number {
    return match.expected_value ?? ((match.ev_pct ?? 0) / 100);
}

function getMarketBase(market: string): string {
    const m = (market || '').toLowerCase();
    if (m.includes('over') || m.includes('under')) return 'goals_total';
    if (m.includes('btts')) return 'btts';
    if (m.includes('double chance')) return 'double_chance';
    if (m.includes('draw no bet')) return 'dnb';
    if (m.includes('home win') || m.includes('away win') || m === 'draw') return 'result';
    return m || 'unknown';
}

function getTicketMarket(match: Match): string {
    return match.bet_type ?? match.prediction_en ?? match.prediction ?? '';
}

function getTeamKeys(match: Match): string[] {
    return [match.homeTeam || match.home_team || '', match.awayTeam || match.away_team || '']
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);
}

function isTicketEligible(match: Match): boolean {
    if (match.vault_eligible === false) return false;
    if (match.odds_fresh === false) return false;
    return (match.odds ?? 0) > 1 && getModelProbability(match) > 0;
}

function getRiskSettings(riskLevel: RiskLevel, hasMultipleSports: boolean) {
    if (riskLevel === 'low') {
        return {
            minConfidence: 80,
            maxLegs: 4,
            sameLeagueCap: 2,
            sameSportCap: hasMultipleSports ? 2 : 99,
            marketCaps: { goals_total: 1, btts: 1, result: 2, double_chance: 2, dnb: 2 } as Record<string, number>,
            overshoot: 1.12,
        };
    }
    if (riskLevel === 'high') {
        return {
            minConfidence: 0,
            maxLegs: 6,
            sameLeagueCap: 3,
            sameSportCap: 99,
            marketCaps: { goals_total: 2, btts: 2, result: 3, double_chance: 3, dnb: 3 } as Record<string, number>,
            overshoot: 1.35,
        };
    }
    return {
        minConfidence: 70,
        maxLegs: 5,
        sameLeagueCap: 2,
        sameSportCap: hasMultipleSports ? 2 : 99,
        marketCaps: { goals_total: 1, btts: 1, result: 2, double_chance: 2, dnb: 2 } as Record<string, number>,
        overshoot: 1.2,
    };
}

function countBy<T>(items: T[], getter: (item: T) => string): Record<string, number> {
    return items.reduce<Record<string, number>>((acc, item) => {
        const key = getter(item);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}

function violatesCorrelationGuard(selected: Match[], candidate: Match, riskLevel: RiskLevel, hasMultipleSports: boolean): boolean {
    const settings = getRiskSettings(riskLevel, hasMultipleSports);
    const candidateKey = getMatchKey(candidate);
    if (selected.some(match => getMatchKey(match) === candidateKey)) return true;

    const leagueCounts = countBy(selected, match => match.league || 'unknown');
    if ((leagueCounts[candidate.league || 'unknown'] || 0) >= settings.sameLeagueCap) return true;

    const sportCounts = countBy(selected, getMatchSport);
    if ((sportCounts[getMatchSport(candidate)] || 0) >= settings.sameSportCap) return true;

    const marketCounts = countBy(selected, match => getMarketBase(getTicketMarket(match)));
    const marketBase = getMarketBase(getTicketMarket(candidate));
    const marketCap = settings.marketCaps[marketBase] ?? 2;
    if ((marketCounts[marketBase] || 0) >= marketCap) return true;

    if (riskLevel !== 'high') {
        const usedTeams = new Set(selected.flatMap(getTeamKeys));
        if (getTeamKeys(candidate).some(team => usedTeams.has(team))) return true;
    }

    return false;
}

function ticketQualityScore(match: Match): number {
    const confidence = match.confidence ?? 0;
    const prob = getModelProbability(match);
    const ev = getExpectedValue(match);
    const odds = match.odds ?? 0;
    return confidence + prob * 35 + ev * 120 - Math.max(0, odds - 2.5) * 4;
}

export const TicketWizard: React.FC<TicketWizardProps> = () => {
    const navigate = useNavigate();
    const { t, language } = useAppContext();
    const { predictions, basketballPredictions, cricketPredictions } = useData();
    const { toggleSavedPick, isPickSaved } = useAppContext();
    const { userProfile } = useAuth();
    const isVip = userProfile?.isVip || false;

    // Safety check for missing translations - removed because t is always defined as a fallback function

    const [step, setStep] = useState(1);
    const [stake, setStake] = useState<string>('1000');
    
    React.useEffect(() => {
        if (userProfile?.portfolioBankroll) {
            setStake(Math.round(userProfile.portfolioBankroll * 0.05).toString());
        }
    }, [userProfile?.portfolioBankroll]);
    const [goal, setGoal] = useState<string>('5000');
const [risk, setRisk] = useState<RiskLevel>('med');
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedTicket, setGeneratedTicket] = useState<Match[] | null>(null);
    const [ticketExplanation, setTicketExplanation] = useState<string | null>(null);
    const [isLoadingExplanation, setIsLoadingExplanation] = useState(false);

    const allMatches = useMemo(
        () => [...predictions, ...basketballPredictions, ...cricketPredictions],
        [predictions, basketballPredictions, cricketPredictions]
    );

    const generateTicket = () => {
        setIsGenerating(true);
        setGeneratedTicket(null);
        setTicketExplanation(null);

        // Simulate AI "thinking"
        setTimeout(() => {
            const targetOdds = (parseFloat(goal) || 5000) / (parseFloat(stake) || 1);
            const ticket = findBestCombination(allMatches, targetOdds, risk);
            setGeneratedTicket(ticket);
            setIsGenerating(false);
            setStep(3);

            // Fetch AI explanation for the ticket
            if (ticket && ticket.length > 0) {
                setIsLoadingExplanation(true);
                fetchTicketExplanation(ticket);
            }
        }, 1500);
    };

    const fetchTicketExplanation = async (ticket: Match[]) => {
        try {
            const response = await fetch(`${backendUrl}/api/ai/ticket-explanation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ticket,
                    stake: parseFloat(stake) || 1000,
                    goal: parseFloat(goal) || 5000,
                    risk
                })
            });
            if (response.ok) {
                const data = await response.json();
                setTicketExplanation(data.explanation);
            }
        } catch (e) {
            console.warn('Failed to fetch ticket explanation:', e);
        } finally {
            setIsLoadingExplanation(false);
        }
    };

    const findBestCombination = (matches: Match[], target: number, riskLevel: RiskLevel): Match[] | null => {
        if (matches.length === 0) return null;

        const hasMultipleSports = new Set(matches.map(getMatchSport)).size > 1;
        const settings = getRiskSettings(riskLevel, hasMultipleSports);

        let pool = matches.filter(m => isTicketEligible(m) && (m.confidence ?? 0) >= settings.minConfidence);
        if (pool.length === 0) {
            pool = matches.filter(isTicketEligible);
        }
        if (pool.length === 0) return null;

        let bestTicket: Match[] = [];
        let currentOdds = 1;

        const sortedPool = [...pool].sort((a, b) => ticketQualityScore(b) - ticketQualityScore(a));

        for (const match of sortedPool) {
            if (bestTicket.length >= settings.maxLegs) break;
            if (violatesCorrelationGuard(bestTicket, match, riskLevel, hasMultipleSports)) continue;

            const nextOdds = currentOdds * match.odds;
            if (nextOdds <= target * settings.overshoot) {
                bestTicket.push(match);
                currentOdds = nextOdds;
            } else if (bestTicket.length < 2 && nextOdds <= target * 1.35) {
                bestTicket.push(match);
                currentOdds = nextOdds;
                break;
            }
            if (currentOdds >= target * 0.95) break;
        }

        return bestTicket.length > 0 ? bestTicket : null;
    };

    const totalOdds = generatedTicket?.reduce((acc, m) => acc * m.odds, 1) || 0;
    const potentialPayout = totalOdds * parseFloat(stake);

    return (
        <div className="pb-24 pt-4 px-4 max-w-lg mx-auto">
            {/* Header */}
            <div className="mb-8">
                <h2 className="text-3xl font-black font-orbitron tracking-tighter text-slate-900 dark:text-white leading-tight">
                    {t('concierge.title')} <span className="text-vantage-purple">{t('concierge.title_accent')}</span>
                </h2>
                <p className="text-gray-500 text-sm">{t('concierge.subtitle')}</p>
            </div>

            <div className="flex justify-between mb-8 px-4">
                {[1, 2, 3].map((s) => (
                    <div key={s} className="flex flex-col items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${step >= s ? 'bg-vantage-purple text-white shadow-lg shadow-vantage-purple/30' : 'bg-slate-200 dark:bg-white/10 text-gray-400'
                            }`}>
                            {step > s ? <Check size={16} /> : s}
                        </div>
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${step >= s ? 'text-vantage-purple' : 'text-gray-400'}`}>
                            {t(`concierge.step_${s}`)}
                        </span>
                    </div>
                ))}
            </div>

            <AnimatePresence mode="wait">
                {step === 1 && (
                    <motion.div
                        key="step1"
                        initial={{ x: 20, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: -20, opacity: 0 }}
                        className="space-y-6"
                    >
                        <GlassCard className="p-6 space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                                    <Wallet size={14} className="text-vantage-purple" /> {t('concierge.stake_label')}
                                </label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={stake}
                                        onChange={(e) => setStake(e.target.value)}
                                        className="w-full bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl py-3 px-4 font-mono font-bold text-lg text-vantage-purple focus:outline-none focus:ring-2 focus:ring-vantage-purple/50"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-bold">FCFA</span>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                                    <Target size={14} className="text-vantage-cyan" /> {t('concierge.goal_label')}
                                </label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={goal}
                                        onChange={(e) => setGoal(e.target.value)}
                                        className="w-full bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl py-3 px-4 font-mono font-bold text-lg text-vantage-cyan focus:outline-none focus:ring-2 focus:ring-vantage-cyan/50"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-bold">FCFA</span>
                                </div>
                            </div>

                            <div className="pt-2">
                                <div className="p-3 bg-vantage-purple/5 border border-vantage-purple/10 rounded-lg flex items-start gap-3">
                                    <Info size={16} className="text-vantage-purple shrink-0 mt-0.5" />
                                    <p className="text-[11px] text-gray-500 italic">
                                        {language === 'fr'
                                          ? `L'IA analysera les cotes disponibles pour atteindre votre objectif de `
                                          : `AI will analyze available odds to reach your goal of `}
                                        <span className="text-vantage-purple font-bold font-mono">{goal} FCFA</span>
                                        {language === 'fr' ? ' avec une mise de ' : ' with a stake of '}
                                        <span className="text-vantage-purple font-bold font-mono">{stake} FCFA</span>.
                                    </p>
                                </div>
                            </div>
                        </GlassCard>

                        <button
                            onClick={() => setStep(2)}
                            className="w-full py-4 bg-vantage-purple hover:bg-purple-600 text-white font-bold rounded-2xl shadow-xl shadow-vantage-purple/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                        >
                            <span>{language === 'fr' ? 'Suivant' : 'Next'}</span>
                            <ChevronRight size={20} />
                        </button>
                    </motion.div>
                )}

                {step === 2 && (
                    <motion.div
                        key="step2"
                        initial={{ x: 20, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: -20, opacity: 0 }}
                        className="space-y-6"
                    >
                        <div className="space-y-3 relative">
                            {!isVip && (
                                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-100/60 dark:bg-vantage-bg/80 backdrop-blur-[2px] rounded-2xl border border-vantage-purple/20">
                                    <div className="p-3 bg-vantage-purple/20 rounded-full mb-3">
                                        <Wallet className="text-vantage-purple" size={24} />
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
                                        {language === 'fr' ? 'Accès VIP Requis' : 'VIP Access Required'}
                                    </h3>
                                    <p className="text-xs text-gray-500 mb-4 px-6 text-center">
                                        {language === 'fr'
                                            ? 'Le Conciergerie IA est une fonctionnalité exclusive aux membres VIP.'
                                            : 'The AI Concierge is an exclusive feature for VIP members.'}
                                    </p>
                                    <button
                                        onClick={() => navigate('/vip')}
                                        className="px-6 py-2.5 bg-gradient-to-r from-vantage-purple to-vantage-cyan text-white text-xs font-bold rounded-full shadow-lg hover:scale-105 transition-transform"
                                    >
                                        {language === 'fr' ? 'Devenir VIP' : 'Upgrade to VIP'}
                                    </button>
                                </div>
                            )}
                            {[
                                { id: 'low', label: t('concierge.risk_low'), icon: ShieldCheck, color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/20' },
                                { id: 'med', label: t('concierge.risk_med'), icon: TrendingUp, color: 'text-vantage-cyan', bg: 'bg-vantage-cyan/10', border: 'border-vantage-cyan/20' },
                                { id: 'high', label: t('concierge.risk_high'), icon: Flame, color: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
                            ].map((r) => (
                                <button
                                    key={r.id}
                                    onClick={() => setRisk(r.id as any)}
                                    className={`w-full p-6 rounded-2xl border-2 transition-all flex items-center gap-4 ${risk === r.id
                                        ? `${r.border} ${r.bg} shadow-lg scale-[1.02]`
                                        : 'border-slate-100 dark:border-white/5 bg-white dark:bg-white/5 grayscale'
                                        }`}
                                >
                                    <div className={`p-3 rounded-xl ${r.bg} ${r.color}`}>
                                        <r.icon size={24} />
                                    </div>
                                    <div className="text-left">
                                        <span className={`block font-bold ${risk === r.id ? 'text-slate-900 dark:text-white' : 'text-gray-400'}`}>
                                            {r.label}
                                        </span>
                                        <span className="text-[10px] text-gray-500 uppercase tracking-tighter">
                                            {r.id === 'low'
                                                ? (language === 'fr' ? 'Confiance > 80%' : 'Confidence > 80%')
                                                : r.id === 'med'
                                                    ? (language === 'fr' ? 'Optimisé pour le profit' : 'Optimized for profit')
                                                    : (language === 'fr' ? 'Priorité aux grosses cotes' : 'High odds priority')}
                                        </span>
                                    </div>
                                    {risk === r.id && <div className={`ml-auto w-6 h-6 rounded-full ${r.bg} ${r.color} flex items-center justify-center`}><Check size={14} /></div>}
                                </button>
                            ))}
                        </div>

                        <div className="flex gap-4">
                            <button
                                onClick={() => setStep(1)}
                                className="flex-1 py-4 bg-slate-100 dark:bg-white/5 text-gray-500 font-bold rounded-2xl border border-slate-200 dark:border-white/10 transition-all active:scale-[0.98]"
                            >
                                {language === 'fr' ? 'Retour' : 'Back'}
                            </button>
                            <button
                                onClick={generateTicket}
                                disabled={isGenerating || !isVip}
                                className="flex-[2] py-4 bg-vantage-purple hover:bg-purple-600 text-white font-bold rounded-2xl shadow-xl shadow-vantage-purple/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
                            >
                                {isGenerating ? <RefreshCw className="animate-spin" size={20} /> : <Wand2 size={20} />}
                                <span>{t('concierge.generate_btn')}</span>
                            </button>
                        </div>
                    </motion.div>
                )}

                {step === 3 && (
                    <motion.div
                        key="step3"
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="space-y-6"
                    >
                        {generatedTicket ? (
                            <div className="space-y-4">
                                <GlassCard className="overflow-hidden border-2 border-vantage-purple/30">
                                    <div className="bg-vantage-purple p-4 flex justify-between items-center text-white">
                                        <div>
                                            <p className="text-[10px] uppercase font-bold opacity-80">{t('concierge.total_odds')}</p>
                                            <p className="text-2xl font-black font-mono">{totalOdds.toFixed(2)}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[10px] uppercase font-bold opacity-80">{t('concierge.potential_win')}</p>
                                            <p className="text-2xl font-black font-mono text-vantage-cyan">{potentialPayout.toLocaleString()} F</p>
                                        </div>
                                    </div>

                                    {/* AI Explanation */}
                                    {(ticketExplanation || isLoadingExplanation) && (
                                        <div className="mx-4 mb-2">
                                            <div className="p-3 rounded-xl bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20">
                                                <div className="flex items-center gap-2 mb-1.5">
                                                    <BrainCircuit size={12} className="text-cyan-500" />
                                                    <span className="text-[10px] font-bold text-cyan-500 uppercase">AI Insight</span>
                                                    {isLoadingExplanation && <Loader2 size={10} className="animate-spin text-cyan-500" />}
                                                </div>
                                                {ticketExplanation && (
                                                    <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">
                                                        {ticketExplanation}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    <div className="p-4 space-y-3">
                                        {generatedTicket.map((match, idx) => (
                                            <div key={match.id} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/5">
                                                <span className="text-[10px] font-black text-gray-300 dark:text-gray-600 shrink-0">{idx + 1}</span>
                                                <div className="flex -space-x-2 shrink-0">
                                                    <TeamLogo src={match.homeTeamLogo} teamName={match.homeTeam} className="w-8 h-8 rounded-full border-2 border-white dark:border-vantage-bg shadow-sm" />
                                                    <TeamLogo src={match.awayTeamLogo} teamName={match.awayTeam} className="w-8 h-8 rounded-full border-2 border-white dark:border-vantage-bg shadow-sm" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[10px] text-gray-400 font-bold truncate uppercase tracking-tighter">{match.league}</p>
                                                    <p className="text-xs font-bold text-slate-800 dark:text-white truncate">
                                                        {match.homeTeam} v {match.awayTeam}
                                                    </p>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className="text-[10px] font-black text-vantage-purple uppercase">{match.prediction}</span>
                                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-gray-500 font-bold font-mono">@{match.odds.toFixed(2)}</span>
                                                    </div>
                                                    {(match as any).analysis_en && (
                                                        <p className="text-[9px] text-gray-400 mt-1 line-clamp-2">{(match as any).analysis_en}</p>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => toggleSavedPick({
                                                        id: match.id,
                                                        homeTeam: match.homeTeam,
                                                        awayTeam: match.awayTeam,
                                                        prediction: match.prediction,
                                                        confidence: match.confidence,
                                                        odds: match.odds,
                                                        league: match.league,
                                                        homeTeamLogo: match.homeTeamLogo,
                                                        awayTeamLogo: match.awayTeamLogo,
                                                        sport: match.sport,
                                                        savedAt: new Date().toISOString()
                                                    })}
                                                    className={`p-2 rounded-lg transition-all ${isPickSaved(match.id)
                                                        ? 'bg-vantage-purple text-white shadow-lg'
                                                        : 'bg-slate-100 dark:bg-white/5 text-gray-400 hover:text-vantage-purple'
                                                        }`}
                                                >
                                                    <Check size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="p-4 bg-slate-50 dark:bg-white/5 border-t border-slate-100 dark:border-white/5">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-gray-500 italic">
                                                {language === 'fr' ? 'Mise recommandée:' : 'Recommended stake:'} <span className="font-mono">{stake}</span> FCFA
                                            </span>
                                            <div className="flex items-center gap-1 text-vantage-purple">
                                                <Sparkles size={12} />
                                                <span className="font-bold">
                                                    {language === 'fr' ? 'Analysé par Vantage AI' : 'Analyzed by Vantage AI'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </GlassCard>

                                <button
                                    onClick={() => setStep(1)}
                                    className="w-full py-4 bg-slate-100 dark:bg-white/5 text-gray-500 hover:text-vantage-purple font-bold rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] border border-slate-200 dark:border-white/10"
                                >
                                    <RefreshCw size={18} />
                                    <span>{t('concierge.regenerate_btn')}</span>
                                </button>
                            </div>
                        ) : (
                            <div className="text-center py-12 px-6">
                                <div className="w-20 h-20 bg-slate-100 dark:bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400">
                                    <Target size={40} />
                                </div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{t('concierge.no_matches')}</h3>
                                <button
                                    onClick={() => setStep(1)}
                                    className="px-8 py-3 bg-vantage-purple text-white font-bold rounded-xl shadow-lg"
                                >
                                    {t('concierge.regenerate_btn')}
                                </button>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

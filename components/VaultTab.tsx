import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, TrendingUp, TrendingDown, Minus, Calendar, ChevronDown, ChevronUp, Pencil, Info, AlertTriangle } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { VaultPick, VaultDay } from '../types';
import { getVaultDay, saveVaultDay, getPredictionsForDate, updateUserProfile, getGlobalTodayKey } from '../services/db';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebaseConfig';

const DEFAULT_BANKROLL = 10000;
const MAX_VAULT_PICKS = 7;
const VAULT_STRATEGY_VERSION = 'vault-sim-v2';
const VAULT_STRATEGY_NAME = 'Simulator EV Quality Top 7';
const VAULT_DECISION_TIME_LOCAL = '19:00 Africa/Lagos';
const CIRCUIT_BREAKER_THRESHOLD = 0.50;

const vaultCategoryPriority: Record<string, number> = {
    safe: 2,
    value: 1,
    risky: 0,
    lean: -1,
};

function getVaultEvPct(match: any): number {
    return match.ev_pct ?? ((match.expected_value ?? 0) * 100);
}

function getVaultQualityScore(match: any): number {
    return (
        (match.expected_value ?? 0) * 0.4 +
        (match.probability ?? 0) * 0.4 +
        (match.inefficiency ?? 0) * 0.2
    );
}

function getVaultKellyPct(match: any): number {
    return match.kelly_stake ?? match.kellyStakePct ?? 0;
}

function getVaultOdds(match: any): number {
    return match.odds ?? match.lockedOdds ?? 0;
}

function getVaultProbability(match: any): number {
    return match.probability ?? ((match.confidence ?? 0) / 100);
}

function isVaultEligible(match: any): boolean {
    if (match.vault_eligible === false) return false;
    if (match.odds_fresh === false) return false;
    if (match.data_quality !== undefined && match.data_quality < 0.50) return false;
    return true;
}

function getVaultGeneratedAt(match: any, lockedAt: string): string {
    return match.generated_at ?? match.generatedAt ?? match.created_at ?? match.createdAt ?? lockedAt;
}

function getVaultKickoffUtc(match: any): string {
    return match.kickoff_utc ?? match.kickoffUtc ?? match.kickoff ?? '';
}

// Only markets with proven high hit rates enter the vault
const VAULT_APPROVED_MARKETS = ['over 1.5', 'under 3.5'];

function isVaultMarketApproved(match: any): boolean {
    const market = (match.prediction || match.bet_type || '').toLowerCase();
    return VAULT_APPROVED_MARKETS.some(m => market.includes(m));
}

function selectVaultPicks(predictions: any[]): any[] {
    return [...predictions]
        .filter(isVaultEligible)
        .filter(isVaultMarketApproved)
        .filter(m => getVaultEvPct(m) >= 2)
        .filter(m => getVaultOdds(m) > 1 && getVaultProbability(m) > 0 && getVaultKellyPct(m) > 0)
        .sort((a, b) => {
            // 1. Over 1.5 always first — proven 84% hit rate vault anchor
            const aO15 = (a.prediction || a.bet_type || '').toLowerCase().includes('over 1.5') ? 1 : 0;
            const bO15 = (b.prediction || b.bet_type || '').toLowerCase().includes('over 1.5') ? 1 : 0;
            if (aO15 !== bO15) return bO15 - aO15;
            // 2. Then safe > value category
            const categoryDiff = (vaultCategoryPriority[b.category ?? ''] ?? -1) - (vaultCategoryPriority[a.category ?? ''] ?? -1);
            if (categoryDiff !== 0) return categoryDiff;
            // 3. Then quality score
            return getVaultQualityScore(b) - getVaultQualityScore(a);
        })
        .slice(0, MAX_VAULT_PICKS);
}

function calcBankrollEnd(picks: VaultPick[], startBankroll: number): number {
    let bankroll = startBankroll;
    for (const pick of picks) {
        if (pick.result === 'pending') continue;
        bankroll += pick.profit ?? 0;
    }
    return bankroll;
}

function dayNumber(startDate: string): number {
    const start = new Date(startDate);
    const now = new Date();
    const diff = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(1, diff + 1);
}

export const VaultTab: React.FC<{ quantPredictions: any[], onEditBankroll?: () => void }> = ({ quantPredictions, onEditBankroll }) => {
    const { language } = useAppContext();
    const { user, userProfile } = useAuth();

    const [vaultDay, setVaultDay] = useState<VaultDay | null>(null);
    const [loading, setLoading] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [vaultHistory, setVaultHistory] = useState<VaultDay[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [showInfo, setShowInfo] = useState(false);
    const [circuitBroken, setCircuitBroken] = useState(false);

    const todayKey = getGlobalTodayKey();
    const vaultStartDate = userProfile?.vaultProgress?.startDate || user?.metadata?.creationTime?.split('T')[0] || todayKey;
    const currentDay = dayNumber(vaultStartDate);
    const bankrollStart = userProfile?.portfolioBankroll || DEFAULT_BANKROLL;
    const startingBankroll = userProfile?.vaultProgress?.startingBankroll || DEFAULT_BANKROLL;

    const isCircuitBroken = () => {
        if (!startingBankroll || startingBankroll <= 0) return false;
        const drawdown = (startingBankroll - bankrollStart) / startingBankroll;
        return drawdown >= CIRCUIT_BREAKER_THRESHOLD;
    };

    useEffect(() => {
        if (!user || !userProfile) return;

        if (isCircuitBroken()) {
            setCircuitBroken(true);
            return;
        }

        setLoading(true);
        autoGradeVault().then((finalBankroll) => {
            getVaultDay(user.uid, todayKey).then(day => {
                if (day && (day as VaultDay).picks.length > 0) {
                    setVaultDay(day as VaultDay);
                } else {
                    autoPopulate(finalBankroll);
                }
            }).finally(() => setLoading(false));
        });
    }, [user, todayKey]);

    const autoGradeVault = async (): Promise<number> => {
        let currentBankroll = userProfile?.portfolioBankroll || DEFAULT_BANKROLL;
        if (!user || !userProfile) return currentBankroll;

        try {
            // Find all pending vault days
            const q = query(collection(db, 'vault_days'), where('uid', '==', user.uid), where('status', '==', 'active'));
            const snap = await getDocs(q);
            if (snap.empty) return currentBankroll;

            let profileNeedsUpdate = false;

            // Sort days chronologically to compound correctly
            const daysToGrade = snap.docs.map(d => d.data() as VaultDay).sort((a, b) => a.dateKey.localeCompare(b.dateKey));

            // Optimization: Fetch all needed predictions in parallel to massively speed up loading time
            const dateKeysToFetch = [...new Set(daysToGrade.map(d => d.dateKey))];
            const predictionsByDate = await Promise.all(
                dateKeysToFetch.map(async date => {
                    const picks = await getPredictionsForDate(date);
                    return { date, picks };
                })
            ).then(results => Object.fromEntries(results.map(r => [r.date, r.picks])));

            const savesToAwait: Promise<void>[] = [];

            for (const day of daysToGrade) {
                let dayUpdated = false;

                // Ensure perfect compounding: if a previous day grew the bankroll, 
                // update this day's starting bankroll and recalculate stakes for pending picks!
                if (day.bankrollStart !== currentBankroll) {
                    day.bankrollStart = currentBankroll;
                    for (let pick of day.picks) {
                        if (pick.result === 'pending') {
                            if (!pick.lockedAt) {
                                pick.stakeAmount = Math.min(Math.round(currentBankroll * 0.05), Math.round(currentBankroll * ((pick.kellyStakePct || 0) / 100)));
                            }
                        }
                    }
                    dayUpdated = true;
                }

                // Fetch graded predictions for that day from pre-fetched map
                const masterPicks = predictionsByDate[day.dateKey];
                if (!masterPicks || masterPicks.length === 0) {
                    if (dayUpdated) savesToAwait.push(saveVaultDay(user.uid, day.dateKey, day));
                    continue;
                }

                let dayBankroll = day.bankrollStart;

                for (let pick of day.picks) {
                    if (pick.result === 'pending') {
                        const masterPick = masterPicks.find((m: any) => String(m.id) === String(pick.fixtureId) || String(m.fixture_id) === String(pick.fixtureId));
                        if (masterPick && masterPick.status && masterPick.status !== 'pending') {
                            const statusStr = masterPick.status.toLowerCase();
                            
                            // Calculate profit based on kelly stake and odds, robust against variations
                            if (statusStr === 'won' || statusStr === 'win') {
                                pick.result = 'won';
                                pick.profit = Math.round(pick.stakeAmount * (pick.odds - 1));
                            } else if (statusStr === 'lost' || statusStr === 'loss') {
                                pick.result = 'lost';
                                pick.profit = -pick.stakeAmount;
                            } else if (statusStr === 'void' || statusStr === 'cancelled' || statusStr === 'refund') {
                                pick.result = 'void';
                                pick.profit = 0;
                            } else {
                                pick.result = statusStr as any;
                            }
                            dayUpdated = true;
                        }
                    }
                    if (pick.result !== 'pending') {
                        dayBankroll += (pick.profit || 0);
                    }
                }

                // Check if all picks are now graded
                const allGraded = day.picks.every(p => p.result !== 'pending');
                
                // If the day was updated OR it's fully graded but somehow stuck as active
                if (dayUpdated || (allGraded && day.status !== 'completed')) {
                    day.bankrollEnd = dayBankroll;
                    if (allGraded) {
                        day.status = 'completed';
                        // Update the user's running bankroll for the next day
                        currentBankroll = dayBankroll;
                        profileNeedsUpdate = true;
                    }
                    savesToAwait.push(saveVaultDay(user.uid, day.dateKey, day));
                }
            }
            
            // Execute all saves concurrently
            await Promise.all(savesToAwait);

            if (profileNeedsUpdate) {
                await updateUserProfile(user.uid, { portfolioBankroll: currentBankroll });
            }
        } catch (e) {
            console.error('Error auto-grading vault:', e);
        }
        
        return currentBankroll;
    };

    const autoPopulate = async (startingBankroll: number) => {
        if (!user || quantPredictions.length === 0) {
            const empty: VaultDay = {
                dayNumber: currentDay,
                dateKey: todayKey,
                picks: [],
                bankrollStart: startingBankroll,
                bankrollEnd: startingBankroll,
                status: 'active'
            };
            setVaultDay(empty);
            await saveVaultDay(user!.uid, todayKey, empty);
            return;
        }

        const topPicks = selectVaultPicks(quantPredictions);
        const lockedAt = new Date().toISOString();

        const picks: VaultPick[] = topPicks.map(m => ({
            fixtureId: m.fixture_id || m.id,
            homeTeam: m.home_team || m.homeTeam,
            awayTeam: m.away_team || m.awayTeam,
            market: m.prediction_en || m.prediction || m.bet_type,
            odds: getVaultOdds(m),
            lockedOdds: getVaultOdds(m),
            kickoffUtc: getVaultKickoffUtc(m),
            lockedAt,
            generatedAt: getVaultGeneratedAt(m, lockedAt),
            strategyVersion: VAULT_STRATEGY_VERSION,
            evPct: getVaultEvPct(m),
            probability: getVaultProbability(m),
            expectedValue: m.expected_value ?? 0,
            inefficiency: m.inefficiency ?? 0,
            category: m.category ?? '',
            valueRank: m.value_rank ?? '',
            qualityScore: getVaultQualityScore(m),
            oddsFresh: m.odds_fresh ?? true,
            oddsAgeMinutes: m.odds_age_minutes ?? null,
            calibrationTier: m.calibration_tier ?? 'stable',
            calibrationFactor: m.calibration_factor ?? 1,
            rawProbability: m.raw_probability ?? null,
            providerSource: m.provider_source ?? 'sportmonks',
            source: 'vault_strategy',
            kellyStakePct: getVaultKellyPct(m),
            // Cap stake at max 5% of bankroll to protect capital
            stakeAmount: Math.min(Math.round(startingBankroll * 0.05), Math.round(startingBankroll * (getVaultKellyPct(m) / 100))),
            result: 'pending',
            profit: null,
            confirmed: true
        }));

        const day: VaultDay = {
            dayNumber: currentDay,
            dateKey: todayKey,
            picks,
            bankrollStart: startingBankroll,
            bankrollEnd: startingBankroll,
            status: 'active',
            lockedAt,
            decisionTimeLocal: VAULT_DECISION_TIME_LOCAL,
            strategyVersion: VAULT_STRATEGY_VERSION,
            strategyName: VAULT_STRATEGY_NAME
        };
        setVaultDay(day);
        await saveVaultDay(user!.uid, todayKey, day);
    };

    useEffect(() => {
        if (showHistory && user && vaultHistory.length === 0) {
            setLoadingHistory(true);
            const q = query(
                collection(db, 'vault_days'), 
                where('uid', '==', user.uid),
                where('status', '==', 'completed')
            );
            getDocs(q).then(snap => {
                const history = snap.docs
                    .map(d => d.data() as VaultDay)
                    .sort((a, b) => b.dateKey.localeCompare(a.dateKey)); // Newest first
                setVaultHistory(history);
            }).finally(() => setLoadingHistory(false));
        }
    }, [showHistory, user]);



    const currentBankroll = vaultDay ? calcBankrollEnd(vaultDay.picks, bankrollStart) : bankrollStart;
    const todayPnl = currentBankroll - bankrollStart;
    const todayPnlPct = bankrollStart > 0 ? (todayPnl / bankrollStart) * 100 : 0;

    // 30-Day Projection: use all-time average daily ROI from original DEFAULT_BANKROLL,
    // not today's P&L alone, which gives a near-zero result while picks are pending.
    const allTimePnlPct = ((currentBankroll - DEFAULT_BANKROLL) / DEFAULT_BANKROLL) * 100;
    const averageDailyRoi = currentDay > 1 ? (allTimePnlPct / currentDay) : 1.5;
    const effectiveRoi = Math.max(0.5, Math.min(3, averageDailyRoi));
    const projectedBankroll30Days = currentBankroll * Math.pow(1 + (effectiveRoi / 100), 30);

    const chartData = useMemo(() => {
        if (!vaultDay) return { path: '', labels: [] };
        const confirmedPicks = vaultDay.picks.filter(p => p.confirmed && p.result !== 'pending');
        if (confirmedPicks.length === 0) return { path: '', labels: [] };

        const maxY = bankrollStart * 1.5;
        const minY = bankrollStart * 0.5;
        const range = maxY - minY;

        const points: [number, number][] = [];
        let runningBankroll = bankrollStart;

        for (let i = 0; i < vaultDay.picks.length; i++) {
            const p = vaultDay.picks[i];
            if (p.result !== 'pending') {
                runningBankroll += p.profit ?? 0;
                points.push([(i + 1) / vaultDay.picks.length * 100, 100 - ((runningBankroll - minY) / range * 100)]);
            }
        }

        if (points.length === 0) return { path: '', labels: [] };

        const path = points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`).join(' ');
        return { path, labels: [] };
    }, [vaultDay]);

    const wonCount = vaultDay?.picks.filter(p => p.result === 'won').length || 0;
    const lostCount = vaultDay?.picks.filter(p => p.result === 'lost').length || 0;
    const pendingCount = vaultDay?.picks.filter(p => p.result === 'pending').length || 0;
    const hasBankroll = bankrollStart > 0;
    const hasLockedPicks = (vaultDay?.picks.length || 0) > 0;
    const hasStakePlan = Boolean(vaultDay?.picks.some(p => p.stakeAmount > 0));
    const hasAnyResult = wonCount + lostCount > 0 || Boolean(vaultDay?.picks.some(p => p.result === 'void'));
    const isBankrollUpdated = Boolean(vaultDay && vaultDay.bankrollEnd !== vaultDay.bankrollStart);
    const journeySteps = [
        { label: language === 'fr' ? 'Capital' : 'Bankroll', done: hasBankroll },
        { label: language === 'fr' ? 'Picks verrouillés' : 'Picks locked', done: hasLockedPicks },
        { label: language === 'fr' ? 'Paris simples' : 'Singles only', done: hasStakePlan },
        { label: language === 'fr' ? 'Résultats' : 'Results', done: hasAnyResult },
        { label: language === 'fr' ? 'Mise à jour' : 'Updated', done: isBankrollUpdated },
    ];

    if (loading) {
        return (
            <div className="flex items-center justify-center py-16">
                <RefreshCw size={24} className="animate-spin text-vantage-cyan" />
            </div>
        );
    }

    return (
        <div className="space-y-4 animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border border-emerald-500/30 flex items-center justify-center">
                        <TrendingUp size={22} className="text-emerald-400" />
                    </div>
                    <div>
                        <h3 className="text-base font-black text-white flex items-center gap-2">
                            {language === 'fr' ? `Vault - Jour ${currentDay}` : `Vault - Day ${currentDay}`}
                            <span className="text-[10px] font-mono text-gray-500 font-normal">{todayKey}</span>
                        </h3>
                        <p className="text-[10px] text-gray-400">
                            {vaultDay?.picks.length || 0} {language === 'fr' ? 'picks actifs' : 'active picks'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowInfo(!showInfo)}
                        className={`p-2 rounded-xl transition-all ${showInfo ? 'bg-amber-500/20 text-amber-400' : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'}`}
                    >
                        <Info size={16} />
                    </button>
                    <button
                        onClick={() => setShowHistory(!showHistory)}
                        className={`p-2 rounded-xl transition-all ${showHistory ? 'bg-vantage-cyan/20 text-vantage-cyan' : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'}`}
                    >
                        <Calendar size={16} />
                    </button>
                </div>
            </div>

            {/* Circuit Breaker Warning */}
            {circuitBroken && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4"
                >
                    <div className="flex items-start gap-3">
                        <AlertTriangle size={20} className="text-rose-400 mt-0.5 shrink-0" />
                        <div>
                            <p className="text-rose-300 text-sm font-bold">
                                {language === 'fr' ? 'Circuit Breaker Activé' : 'Circuit Breaker Activated'}
                            </p>
                            <p className="text-rose-400/70 text-xs mt-1">
                                {language === 'fr'
                                    ? `Votre bankroll a chuté de ${((startingBankroll - bankrollStart) / startingBankroll * 100).toFixed(0)}% depuis ${startingBankroll.toLocaleString()} FCFA. Les nouveaux picks sont suspendus pour protéger votre capital.`
                                    : `Your bankroll has dropped ${((startingBankroll - bankrollStart) / startingBankroll * 100).toFixed(0)}% from ${startingBankroll.toLocaleString()} FCFA. New picks paused to protect your capital.`}
                            </p>
                            <p className="text-rose-400/50 text-[10px] mt-2">
                                {language === 'fr'
                                    ? 'Reprendra quand la bankroll remontera au-dessus du seuil de sécurité.'
                                    : 'Will resume when bankroll recovers above the safety threshold.'}
                            </p>
                        </div>
                    </div>
                </motion.div>
            )}

            <AnimatePresence>
                {showInfo && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/5 border border-amber-500/30 rounded-2xl p-4">
                            <div className="flex items-start gap-3">
                                <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                                    <AlertTriangle size={18} className="text-amber-400" />
                                </div>
                                <div>
                                    <h4 className="text-xs font-black text-amber-400 uppercase tracking-wide mb-1">
                                        {language === 'fr' ? '⚠️ RÈGLE CRITIQUE' : '⚠️ CRITICAL RULE'}
                                    </h4>
                                    <p className="text-[11px] text-amber-500/90 leading-relaxed">
                                        {language === 'fr' 
                                            ? 'Jouez chaque pick du Vault comme un pari SIMPLE. La taille de mise Kelly est calculée pour des événements individuels. Combiner ces paris augmente la variance.' 
                                            : 'Play every Vault pick as a SINGLE bet. Kelly stake size is calculated for individual events. Combining picks increases variance and erodes model edge.'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Journey Progress */}
            <div className="bg-gradient-to-r from-emerald-500/10 to-teal-500/5 rounded-2xl border border-emerald-500/20 p-4">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
                            {language === 'fr' ? 'Parcours du Vault' : 'Vault Progress'}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                            {language === 'fr' ? 'Picks = Paris simples uniquement' : 'Picks = Single bets only'}
                        </p>
                    </div>
                    <div className="text-right">
                        <span className="text-lg font-black font-mono text-emerald-400">{wonCount}W</span>
                        <span className="text-lg font-black font-mono text-gray-500 mx-1">-</span>
                        <span className="text-lg font-black font-mono text-rose-400">{lostCount}L</span>
                        {pendingCount > 0 && (
                            <span className="text-lg font-black font-mono text-gray-400 ml-1">({pendingCount}P)</span>
                        )}
                    </div>
                </div>
                <div className="grid grid-cols-5 gap-2">
                    {journeySteps.map((step, idx) => (
                        <div key={step.label} className="text-center">
                            <div className={`w-full h-2 rounded-full mb-2 ${step.done ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' : idx === 2 ? 'bg-amber-500/60' : 'bg-slate-700'}`} />
                            <p className={`text-[9px] font-bold leading-tight ${step.done ? 'text-emerald-300' : 'text-gray-500'}`}>
                                {step.label}
                            </p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Bankroll Stats */}
            <div className="grid grid-cols-2 gap-3">
                {/* Current Bankroll */}
                <div className="bg-gradient-to-br from-slate-800 to-slate-800/50 rounded-2xl p-4 border border-slate-700/50 relative overflow-hidden">
                    {onEditBankroll && (
                        <button 
                            onClick={onEditBankroll}
                            className="absolute top-3 right-3 p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-500 hover:text-white transition-all z-10"
                        >
                            <Pencil size={12} />
                        </button>
                    )}
                    <div className="absolute -right-3 -top-3 w-16 h-16 bg-emerald-500/5 rounded-full blur-xl" />
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                        {language === 'fr' ? 'Bankroll' : 'Bankroll'}
                    </p>
                    <div className="text-2xl font-black font-mono text-white">
                        {currentBankroll.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">FCFA</div>
                    <div className={`text-[10px] font-bold mt-1 ${todayPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {todayPnl >= 0 ? '+' : ''}{todayPnlPct.toFixed(1)}% {language === 'fr' ? "aujourd'hui" : 'today'}
                    </div>
                </div>

                {/* 30-Day Projection */}
                <div className="bg-gradient-to-br from-emerald-500/15 to-teal-500/5 rounded-2xl p-4 border border-emerald-500/20 relative overflow-hidden">
                    <div className="absolute -right-3 -top-3 w-16 h-16 bg-emerald-500/10 rounded-full blur-xl" />
                    <p className="text-[10px] font-bold text-emerald-400/80 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <TrendingUp size={10} /> {language === 'fr' ? '30J Projection' : '30D Projection'}
                    </p>
                    <div className="text-2xl font-black font-mono text-emerald-400">
                        {projectedBankroll30Days.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                    <div className="text-[10px] text-emerald-500/60 mt-0.5">FCFA</div>
                    <div className="flex items-center gap-1 mt-1">
                        <span className="text-[9px] font-bold text-emerald-300 bg-emerald-500/20 px-1.5 py-0.5 rounded">+{effectiveRoi.toFixed(1)}%/day</span>
                    </div>
                </div>
            </div>

            {chartData.path && (
                <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">
                        {language === 'fr' ? '📈 Courbe du Bankroll' : '📈 Bankroll Curve'}
                    </p>
                    <svg viewBox="0 0 100 50" className="w-full h-20" preserveAspectRatio="none">
                        <defs>
                            <linearGradient id="bankrollGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
                            </linearGradient>
                        </defs>
                        <line x1="0" y1="25" x2="100" y2="25" stroke="#334155" strokeWidth="0.5" strokeDasharray="2,2" />
                        <polyline
                            points={chartData.path.replace(/[\d.]+,[\d.]+/g, (m) => {
                                const [x, y] = m.split(',').map(Number);
                                return `${x},${Math.max(5, Math.min(45, y))}`;
                            })}
                            fill="none"
                            stroke="#22d3ee"
                            strokeWidth="2"
                            vectorEffect="non-scaling-stroke"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </div>
            )}

            {vaultDay?.picks.length === 0 ? (
                <div className="bg-slate-800/50 rounded-2xl p-6 border border-slate-700/50 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-slate-700/50 flex items-center justify-center mx-auto mb-4">
                        <TrendingUp size={28} className="text-gray-500" />
                    </div>
                    <div className="text-gray-400 text-sm font-bold mb-1">
                        {language === 'fr' ? 'Aucun pick disponible' : 'No picks available today'}
                    </div>
                    <div className="text-gray-500 text-xs">
                        {language === 'fr'
                            ? "Les picks avec faible edge ou cotes anciennes sont filtrés."
                            : "Picks with weak edge or stale odds are filtered out."}
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        {language === 'fr' ? '📋 Vos Picks du Jour' : '📋 Today\'s Picks'}
                    </p>
                    {vaultDay?.picks.map((pick, i) => {
                        const isPending = pick.result === 'pending';
                        const isWon = pick.result === 'won';
                        const isLost = pick.result === 'lost';
                        const isVoid = pick.result === 'void';

                        return (
                            <motion.div
                                key={pick.fixtureId}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.05 }}
                                className={`rounded-2xl border overflow-hidden ${
                                    isWon ? 'bg-gradient-to-r from-emerald-500/10 to-emerald-600/5 border-emerald-500/30' :
                                    isLost ? 'bg-gradient-to-r from-rose-500/10 to-rose-600/5 border-rose-500/30' :
                                    isVoid ? 'bg-gradient-to-r from-amber-500/10 to-amber-600/5 border-amber-500/30' :
                                    'bg-gradient-to-r from-slate-800/50 to-slate-800/30 border-slate-700/50'
                                }`}
                            >
                                {/* Pick Header */}
                                <div className="p-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-black text-gray-400">#{i + 1}</span>
                                                <span className="text-sm font-bold text-white truncate">
                                                    {pick.homeTeam} vs {pick.awayTeam}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                                                <span className={`text-[11px] font-black px-2 py-1 rounded-lg ${
                                                    isWon ? 'bg-emerald-500/20 text-emerald-400' :
                                                    isLost ? 'bg-rose-500/20 text-rose-400' :
                                                    isVoid ? 'bg-amber-500/20 text-amber-400' :
                                                    'bg-vantage-cyan/20 text-vantage-cyan'
                                                }`}>
                                                    {pick.market}
                                                </span>
                                                <span className="text-[11px] font-mono font-bold text-white">
                                                    @ {pick.odds.toFixed(2)}
                                                </span>
                                                {pick.kellyStakePct > 0 && (
                                                    <span className="text-[10px] font-bold text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded">
                                                        Kelly {pick.kellyStakePct.toFixed(1)}%
                                                    </span>
                                                )}
                                                {pick.evPct > 0 && (
                                                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                                                        +{pick.evPct.toFixed(1)}% EV
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className={`shrink-0 px-3 py-2 rounded-xl flex items-center gap-1.5 ${
                                            isWon ? 'bg-emerald-500/20' :
                                            isLost ? 'bg-rose-500/20' :
                                            isVoid ? 'bg-amber-500/20' :
                                            'bg-slate-700/50'
                                        }`}>
                                            {isWon && <TrendingUp size={14} className="text-emerald-400" />}
                                            {isLost && <TrendingDown size={14} className="text-rose-400" />}
                                            {isVoid && <Minus size={14} className="text-amber-400" />}
                                            {isPending && <RefreshCw size={14} className="text-gray-400 animate-spin" />}
                                            <span className={`text-[10px] font-black ${
                                                isWon ? 'text-emerald-400' :
                                                isLost ? 'text-rose-400' :
                                                isVoid ? 'text-amber-400' :
                                                'text-gray-400'
                                            }`}>
                                                {isWon ? 'WON' : isLost ? 'LOST' : isVoid ? 'VOID' : 'PENDING'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Stake Footer */}
                                {pick.stakeAmount > 0 && (
                                    <div className={`px-3 py-2 border-t flex items-center justify-between ${
                                        isWon ? 'border-emerald-500/20 bg-emerald-500/5' :
                                        isLost ? 'border-rose-500/20 bg-rose-500/5' :
                                        isVoid ? 'border-amber-500/20 bg-amber-500/5' :
                                        'border-slate-700/50 bg-slate-800/30'
                                    }`}>
                                        <div className="flex items-center gap-4">
                                            <div>
                                                <p className="text-[9px] text-gray-500 uppercase">Stake</p>
                                                <p className="text-[11px] font-bold font-mono text-white">{pick.stakeAmount.toLocaleString()} F</p>
                                            </div>
                                            {pick.profit !== null && (
                                                <div>
                                                    <p className="text-[9px] text-gray-500 uppercase">{language === 'fr' ? 'Gain/Perte' : 'P/L'}</p>
                                                    <p className={`text-[11px] font-black font-mono ${pick.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                        {pick.profit >= 0 ? '+' : ''}{pick.profit.toLocaleString()} F
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                        {pick.calibrationTier && pick.calibrationTier !== 'stable' && (
                                            <span className="text-[9px] font-bold text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded">
                                                {pick.calibrationTier}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </motion.div>
                        );
                    })}
                </div>
            )}

<AnimatePresence>
                {showHistory ? (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden mt-6"
                    >
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                            {language === 'fr' ? 'Historique du Vault' : 'Vault History'}
                        </h4>
                        
                        {loadingHistory ? (
                            <div className="flex justify-center py-6"><RefreshCw size={16} className="animate-spin text-gray-500" /></div>
                        ) : vaultHistory.length === 0 ? (
                            <div className="text-center py-6 text-gray-500 text-xs">
                                {language === 'fr' ? 'Aucun historique disponible' : 'No history available yet'}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {vaultHistory.map(hDay => {
                                    const dayPnl = hDay.bankrollEnd - hDay.bankrollStart;
                                    const dayPnlPct = (dayPnl / hDay.bankrollStart) * 100;
                                    return (
                                        <div key={hDay.dateKey} className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-3">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <div className="text-xs font-bold text-white">Day {hDay.dayNumber}</div>
                                                    <div className="text-[10px] text-gray-500">{hDay.dateKey}</div>
                                                </div>
                                                <div className="text-right">
                                                    <div className={`text-xs font-bold font-mono ${dayPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                        {dayPnl >= 0 ? '+' : ''}{dayPnl.toLocaleString()} FCFA
                                                    </div>
                                                    <div className={`text-[10px] font-mono ${dayPnl >= 0 ? 'text-emerald-500/80' : 'text-rose-500/80'}`}>
                                                        {dayPnl >= 0 ? '+' : ''}{dayPnlPct.toFixed(1)}%
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-1.5">
                                                {hDay.picks.map(p => (
                                                    <div key={p.fixtureId} className="flex items-center justify-between text-[10px]">
                                                        <span className="text-gray-400 truncate pr-2 flex-1">
                                                            {p.homeTeam} vs {p.awayTeam}
                                                        </span>
                                                        <div className="flex items-center gap-2 shrink-0">
                                                            <span className="font-mono text-gray-500">@{p.odds.toFixed(2)}</span>
                                                            {p.result === 'won' && <span className="text-emerald-400 font-bold">WON</span>}
                                                            {p.result === 'lost' && <span className="text-rose-400 font-bold">LOST</span>}
                                                            {p.result === 'void' && <span className="text-amber-400 font-bold">VOID</span>}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </motion.div>
                ) : null}
            </AnimatePresence>

            {!circuitBroken && (
            <button
                onClick={() => autoPopulate(currentBankroll)}
                className="w-full py-2.5 rounded-xl border border-dashed border-slate-700 text-[10px] font-bold text-gray-500 hover:text-white hover:border-slate-500 transition-colors flex items-center justify-center gap-1.5"
            >
                <RefreshCw size={12} />
                {language === 'fr' ? 'Régénérer les picks' : 'Refresh picks from today'}
            </button>
            )}
            {circuitBroken && (
            <button disabled
                className="w-full py-2.5 rounded-xl border border-dashed border-rose-500/30 text-[10px] font-bold text-rose-400/50 flex items-center justify-center gap-1.5 cursor-not-allowed"
            >
                <AlertTriangle size={12} />
                {language === 'fr' ? 'Picks suspendus — Circuit Breaker' : 'Picks paused — Circuit Breaker'}
            </button>
            )}
        </div>
    );
};

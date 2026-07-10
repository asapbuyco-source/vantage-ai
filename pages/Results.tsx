import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, onSnapshot } from 'firebase/firestore';
import {
    History, ChevronDown, ChevronUp, CheckCircle2, XCircle,
    Loader2, Trophy, AlertCircle, Pencil, Save, X, MinusCircle
} from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { getResultsHistory, DayResult, savePredictionsForDate, getPredictionsForDate, getGlobalTodayKey, normalizeQuantPrediction } from '../services/db';
import { db } from '../firebaseConfig';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { Match } from '../types';


type MatchStatus = 'won' | 'lost' | 'void' | 'pending';

// Cycle order for admin tapping a match: won → lost → pending → won
const CYCLE: Record<string, MatchStatus> = { won: 'lost', lost: 'pending', pending: 'won', void: 'won' };

export const Results: React.FC = () => {
    const { language, showToast } = useAppContext();
    const { isAdmin } = useAuth();
    const isVip = useAuth().userProfile?.isVip || false;

    const [history, setHistory] = useState<DayResult[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedDay, setExpandedDay] = useState<string | null>(null);
    const [liveError, setLiveError] = useState<string | null>(null);

    // Admin edit state — keyed by date
    const [editMode, setEditMode] = useState<Record<string, boolean>>({});
    // Local overrides: { [dateKey]: { [matchId]: status } }
    const [localEdits, setLocalEdits] = useState<Record<string, Record<string, MatchStatus>>>({});
    const [saving, setSaving] = useState<Record<string, boolean>>({});

    const loadHistory = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getResultsHistory(30);
            setHistory(data);
            if (data.length > 0) setExpandedDay(data[0].date);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadHistory(); }, [loadHistory]);

    // Live listener for today's rolling results
    useEffect(() => {
        const todayKey = getGlobalTodayKey();
        const unsub = onSnapshot(
            doc(db, 'quant_predictions', todayKey),
            (snap) => {
                if (!snap.exists()) return;
                const data = snap.data();
                const allMatches = (data.predictions || []).map(normalizeQuantPrediction);
                // Show all matches on the Results page
                const matches = allMatches;
                if (matches.length === 0) return;

                setHistory(prev => {
                    const existing = prev.filter(d => d.date !== todayKey);
                    const todayEntry = {
                        date: todayKey,
                        matches,
                        wonCount: matches.filter(m => m.status === 'won').length,
                        lostCount: matches.filter(m => m.status === 'lost').length,
                        totalGraded: matches.filter(m => m.status === 'won' || m.status === 'lost' || m.status === 'void').length,
                    };
                    return [todayEntry, ...existing];
                });
            },
            (err) => {
                console.warn('[Results] Live listener error:', err);
                setLiveError(language === 'fr' ? 'Connexion en temps réel perdue. Les résultats peuvent ne pas être à jour.' : 'Real-time connection lost. Results may be outdated.');
            }
        );
        return () => unsub();
    }, []);

    // ── Derived summary stats ──────────────────────────────────────────────────
    const getEffectiveStatus = (date: string, match: Match): MatchStatus =>
        (localEdits[date]?.[match.id] ?? match.status ?? 'pending') as MatchStatus;

    const totalWon = history.reduce((s, d) => {
        return s + d.matches.filter(m => getEffectiveStatus(d.date, m) === 'won').length;
    }, 0);

    const totalLost = history.reduce((s, d) => {
        return s + d.matches.filter(m => getEffectiveStatus(d.date, m) === 'lost').length;
    }, 0);

    const totalGraded = totalWon + totalLost;
    const overallRate = totalGraded > 0 ? Math.round((totalWon / totalGraded) * 100) : 0;

    // ── Admin handlers ─────────────────────────────────────────────────────────
    const toggleEditMode = (date: string) => {
        setEditMode(prev => {
            const next = { ...prev, [date]: !prev[date] };
            if (prev[date]) {
                // Cancel: revert local edits for this day
                setLocalEdits(e => { const n = { ...e }; delete n[date]; return n; });
            }
            return next;
        });
    };

    const cycleStatus = (date: string, matchId: string, current: MatchStatus) => {
        const next = CYCLE[current] ?? 'won';
        setLocalEdits(prev => ({
            ...prev,
            [date]: { ...(prev[date] || {}), [matchId]: next },
        }));
    };

    const saveEdits = async (date: string, day: DayResult) => {
        if (!localEdits[date]) return;
        setSaving(s => ({ ...s, [date]: true }));
        try {
            // Load FULL match list for this date (not just graded) so we don't overwrite pending ones
            const fullMatches = await getPredictionsForDate(date);
            if (!fullMatches) throw new Error('Could not load full match list');

            const updated = fullMatches.map(m => {
                const newStatus = localEdits[date]?.[m.id];
                return newStatus ? { ...m, status: newStatus } : m;
            });

            await savePredictionsForDate(date, updated);

            // Recompute local history entry
            setHistory(prev => prev.map(d => {
                if (d.date !== date) return d;
                const graded = updated.filter(m => m.status === 'won' || m.status === 'lost');
                return {
                    ...d,
                    matches: updated, // Keep ALL matches in local state
                    wonCount: graded.filter(m => m.status === 'won').length,
                    lostCount: graded.filter(m => m.status === 'lost').length,
                    totalGraded: graded.length,
                };
            }));

            // Clear edits and exit edit mode for this day
            setLocalEdits(prev => { const n = { ...prev }; delete n[date]; return n; });
            setEditMode(prev => ({ ...prev, [date]: false }));
            showToast?.(language === 'fr' ? 'Résultats sauvegardés ✓' : 'Results saved ✓', 'success');
        } catch (e: any) {
            showToast?.(language === 'fr' ? 'Erreur de sauvegarde' : 'Save failed', 'error');
            console.error('[AdminGrade] Save error:', e);
        } finally {
            setSaving(s => ({ ...s, [date]: false }));
        }
    };

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr + 'T12:00:00');
        return d.toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-GB', {
            weekday: 'short', day: 'numeric', month: 'short',
        });
    };

    // ── Status UI helpers ──────────────────────────────────────────────────────
    const StatusIcon = ({ status }: { status: MatchStatus }) => {
        if (status === 'won') return <CheckCircle2 size={16} className="text-green-500 shrink-0" />;
        if (status === 'lost') return <XCircle size={16} className="text-red-400 shrink-0" />;
        return <MinusCircle size={16} className="text-gray-400 shrink-0" />;
    };

    const statusBorder: Record<MatchStatus, string> = {
        won: 'bg-green-500/5 border-green-500/20',
        lost: 'bg-red-500/5 border-red-500/20',
        pending: 'bg-slate-50 dark:bg-white/[0.02] border-slate-200 dark:border-white/5',
        void: 'bg-gray-500/5 border-gray-500/20',
    };

    const statusLabel: Record<MatchStatus, string> = {
        won: 'WON', lost: 'LOST', pending: 'PENDING', void: 'VOID',
    };

    const statusColor: Record<MatchStatus, string> = {
        won: 'text-green-500', lost: 'text-red-400', pending: 'text-gray-400', void: 'text-gray-400',
    };

    return (
        <div className="space-y-5 pb-24">
            {/* Header */}
            <div className="flex flex-col space-y-1">
                <div className="flex items-center gap-2">
                    <History size={22} className="text-vantage-cyan" />
                    <h1 className="text-2xl font-bold font-orbitron text-slate-900 dark:text-white">
                        {language === 'fr' ? 'ARCHIVE' : 'RESULTS'}{' '}
                        <span className="text-vantage-cyan">{language === 'fr' ? 'DES RÉSULTATS' : 'HISTORY'}</span>
                    </h1>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    {language === 'fr'
                        ? '30 derniers jours · Données vérifiées & archivées'
                        : 'Last 30 days · Verified & archived prediction data'}
                    {isAdmin && (
                        <span className="ml-2 text-vantage-cyan text-[10px] font-bold uppercase tracking-wider">
                            · Admin Edit Mode Available
                        </span>
                    )}
                </p>
            </div>

            {/* Live connection error banner */}
            <AnimatePresence>
                {liveError && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="flex items-center gap-2 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg"
                    >
                        <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 flex-shrink-0" />
                        <p className="text-sm text-amber-800 dark:text-amber-200">{liveError}</p>
                        <button
                            onClick={() => setLiveError(null)}
                            className="ml-auto text-amber-600 hover:text-amber-800 dark:hover:text-amber-300"
                        >
                            <X size={16} />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Summary Banner */}
            {!loading && totalGraded > 0 && (
                // @ts-ignore – Framer Motion v12 + React 19 children prop incompatibility
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                    <GlassCard className="border-vantage-cyan/20 bg-vantage-cyan/5">
                        <div className="grid grid-cols-3 gap-4 text-center">

                            <div>
                                <p className="text-2xl font-black font-orbitron text-green-500">{totalWon}</p>
                                <p className="text-[10px] uppercase text-gray-500">{language === 'fr' ? 'Gagnés' : 'Won'}</p>
                            </div>
                            <div>
                                <p className="text-2xl font-black font-orbitron text-vantage-cyan">{overallRate}%</p>
                                <p className="text-[10px] uppercase text-gray-500">{language === 'fr' ? 'Taux Global' : 'Win Rate'}</p>
                            </div>
                            <div>
                                <p className="text-2xl font-black font-orbitron text-red-400">{totalLost}</p>
                                <p className="text-[10px] uppercase text-gray-500">{language === 'fr' ? 'Perdus' : 'Lost'}</p>
                            </div>
                        </div>
                    </GlassCard>
                </motion.div>
            )}

            {/* Content */}
            {loading ? (
                <div className="flex flex-col items-center justify-center mt-20 py-10 gap-3">
                    <Loader2 className="animate-spin text-vantage-cyan" size={36} />
                    <p className="text-sm text-gray-500">{language === 'fr' ? 'Chargement des résultats...' : 'Loading results...'}</p>
                </div>
            ) : history.length === 0 ? (
                <div className="mt-8">
                    <GlassCard className="flex flex-col items-center py-12 text-center gap-3 border-slate-200 dark:border-white/5">
                        <AlertCircle size={36} className="text-gray-400" />
                        <h3 className="font-bold text-slate-900 dark:text-white">
                            {language === 'fr' ? 'Aucun résultat archivé' : 'No archived results yet'}
                        </h3>
                        <p className="text-sm text-gray-500 max-w-xs">
                            {language === 'fr'
                                ? "Les résultats apparaissent une fois que les prédictions sont notées."
                                : 'Results appear once predictions are graded each day.'}
                        </p>
                    </GlassCard>
                </div>
            ) : (
                <div className="space-y-3">
                    {history.map((day, i) => {
                        const isInEdit = isAdmin && editMode[day.date];

                        // Use local edits for live counts
                        const effectiveMatches = day.matches.map(m => ({
                            ...m,
                            status: getEffectiveStatus(day.date, m) as Match['status'],
                        }));
                        const wonCount = effectiveMatches.filter(m => m.status === 'won').length;
                        const lostCount = effectiveMatches.filter(m => m.status === 'lost').length;
                        const gradedCount = wonCount + lostCount;
                        const dayRate = gradedCount > 0 ? Math.round((wonCount / gradedCount) * 100) : 0;

                        const isExpanded = expandedDay === day.date;
                        const hasUnsavedChanges = !!localEdits[day.date] && Object.keys(localEdits[day.date]).length > 0;

                        return (
                            // @ts-ignore
                            <motion.div
                                key={day.date}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.03 }}
                            >
                                {/* Day header row */}
                                <div className="flex items-center gap-2">
                                    <button
                                        className="flex-1 text-left"
                                        onClick={() => setExpandedDay(isExpanded ? null : day.date)}
                                    >
                                        <GlassCard className={`transition-all ${isExpanded ? 'border-vantage-cyan/40' : 'border-white/5'}`}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black font-orbitron
                                                        ${dayRate >= 70 ? 'bg-green-500/15 text-green-500' : dayRate >= 50 ? 'bg-yellow-500/15 text-yellow-500' : 'bg-red-500/15 text-red-500'}`}>
                                                        {dayRate}%
                                                    </div>
                                                    <div className="text-left">
                                                        <p className="text-sm font-bold text-slate-900 dark:text-white">{formatDate(day.date)}
                                                            {day.date === getGlobalTodayKey() && (
                                                                <span className="ml-1.5 text-[8px] font-black text-red-500 bg-red-500/15 px-1.5 py-0.5 rounded-full border border-red-500/30 animate-pulse uppercase">
                                                                    LIVE
                                                                </span>
                                                            )}
                                                        </p>
                                                        <p className="text-[10px] text-gray-500 flex items-center gap-2">
                                                            <span className="flex items-center gap-1 text-green-500"><Trophy size={10} />{wonCount} Won</span>
                                                            <span className="flex items-center gap-1 text-red-400"><XCircle size={10} />{lostCount} Lost</span>
                                                            <span>{gradedCount}/{effectiveMatches.length} graded</span>
                                                            {hasUnsavedChanges && (
                                                                <span className="text-vantage-cyan animate-pulse">· unsaved</span>
                                                            )}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="text-gray-400">
                                                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                                </div>
                                            </div>
                                        </GlassCard>
                                    </button>

                                    {/* Admin edit / save / cancel buttons */}
                                    {isAdmin && (
                                        <div className="flex gap-1 shrink-0">
                                            {isInEdit ? (
                                                <>
                                                    <button
                                                        onClick={() => saveEdits(day.date, day)}
                                                        disabled={saving[day.date]}
                                                        className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-green-500 text-white disabled:opacity-50 transition-all active:scale-95"
                                                    >
                                                        {saving[day.date]
                                                            ? <Loader2 size={12} className="animate-spin" />
                                                            : <Save size={12} />}
                                                        {language === 'fr' ? 'Sauv.' : 'Save'}
                                                    </button>
                                                    <button
                                                        onClick={() => toggleEditMode(day.date)}
                                                        className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-white/10 text-gray-400 hover:text-white transition-all active:scale-95"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    onClick={() => {
                                                        setExpandedDay(day.date);
                                                        toggleEditMode(day.date);
                                                    }}
                                                    className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-vantage-cyan/10 text-vantage-cyan hover:bg-vantage-cyan/20 border border-vantage-cyan/20 transition-all active:scale-95"
                                                >
                                                    <Pencil size={12} />
                                                    {language === 'fr' ? 'Éditer' : 'Edit'}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Expanded match list */}
                                <AnimatePresence>
                                    {isExpanded && (
                                        // @ts-ignore
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            exit={{ opacity: 0, height: 0 }}
                                            className="overflow-hidden mt-2 space-y-2 pl-2"
                                        >
                                            {isInEdit && (
                                                <p className="text-[10px] text-vantage-cyan flex items-center gap-1 pb-1 pl-1">
                                                    <Pencil size={9} />
                                                    {language === 'fr'
                                                        ? 'Tapez un match pour changer son résultat'
                                                        : 'Tap a match to cycle its result: Won → Lost → Pending'}
                                                </p>
                                            )}
                                            {effectiveMatches.map((match) => {
                                                const status = (match.status || 'pending') as MatchStatus;
                                                const pred = language === 'fr'
                                                    ? (match.prediction_fr || match.prediction)
                                                    : (match.prediction_en || match.prediction);

                                                return (
                                                    <div
                                                        key={match.id}
                                                        onClick={isInEdit ? () => cycleStatus(day.date, match.id, status) : undefined}
                                                        className={`flex items-center justify-between p-3 rounded-xl border text-sm transition-all
                                                            ${statusBorder[status] || statusBorder.pending}
                                                            ${isInEdit ? 'cursor-pointer hover:brightness-110 active:scale-[0.99] select-none' : ''}`}
                                                    >
                                                        <div className="flex items-center gap-2 overflow-hidden min-w-0">
                                                            <StatusIcon status={status} />
                                                            <div className="flex flex-col min-w-0">
                                                                <span className="font-bold text-slate-900 dark:text-white truncate text-xs">
                                                                    {match.homeTeam || match.home_team} vs {match.awayTeam || match.away_team}
                                                                </span>
                                                                <span className="text-[10px] text-gray-500 truncate">
                                                    {match.league} · {(isAdmin || isVip) ? pred : (language === 'fr' ? 'Réservé VIP' : 'VIP Only')}
                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-col items-end shrink-0 ml-2">
                                                            <span className={`text-xs font-bold font-orbitron ${statusColor[status]}`}>
                                                                {statusLabel[status]}
                                                            </span>
                                                            {/* Show live state badge for today's matches */}
                                                            {match.live_state && status === 'pending' && (
                                                                <span className="text-[8px] font-bold text-amber-400 bg-amber-400/10 px-1 py-0.5 rounded-full">
                                                                    {['FT','AET','PEN'].includes(match.live_state) ? 'FT' : `LIVE ${match.live_minute || ''}'`}
                                                                </span>
                                                            )}
                                                            {/* Show graded score when available, otherwise show odds */}
                                                            {match.score ? (
                                                                <span className="text-[10px] text-gray-500">{match.score}</span>
                                                            ) : match.odds ? (
                                                                <span className="text-[10px] text-gray-500">@ {match.odds}</span>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            {effectiveMatches.length === 0 && (
                                                <div className="text-center py-4 text-xs text-gray-500">
                                                    {language === 'fr' ? 'Aucun match noté pour ce jour' : 'No graded matches for this day'}
                                                </div>
                                            )}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </motion.div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

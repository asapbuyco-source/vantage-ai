import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowLeft, Activity, Scale, ShieldAlert, Zap, Loader2, Trophy, Crosshair, Target, BarChart3, Newspaper, Users, CheckCircle2, ChevronRight } from 'lucide-react';
import { NavigationTab, Match, MatchNews } from '../types';
import { getLiveOddsFromDB, getH2HFromDB, getMatchNewsFromDB, getFixtureLineupsFromDB, getMatchStatsFromDB, getMatchFactsFromDB, LineupPlayer, H2HRecord, MatchOdds, MatchStatsData, MatchFact } from '../services/sportsData';
import { TeamLogo } from '../components/TeamLogo';
import { Sparkline } from '../components/Sparkline';
import { VisualPitch } from '../components/VisualPitch';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';

export const MatchDetails: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { language } = useAppContext();
    const { userProfile, isAdmin } = useAuth();
    const { predictions, rawFixtures } = useData();
    const isVipUser = userProfile?.isVip === true || isAdmin;

    const [match, setMatch] = useState<Match | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'prediction' | 'overview' | 'stats' | 'h2h' | 'lineup' | 'picks'>('prediction');
    const [allMatchPicks, setAllMatchPicks] = useState<Match[]>([]);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);

    const [odds, setOdds] = useState<MatchOdds | null>(null);
    const [realH2H, setRealH2H] = useState<H2HRecord | null>(null);
    const [lineup, setLineup] = useState<{ home: LineupPlayer[]; away: LineupPlayer[] } | null>(null);
    const [matchStats, setMatchStats] = useState<MatchStatsData | null>(null);
    const [matchFacts, setMatchFacts] = useState<MatchFact[]>([]);

    useEffect(() => {
        if (!id) return;

        const foundMatch = [...predictions, ...rawFixtures].find(m => m.id === id);
        if (foundMatch) {
            setMatch(foundMatch);
            // Find all predictions for the same fixture
            const fixtureId = foundMatch.fixture_id || foundMatch.fixtureId;
            const sameFixturePicks = predictions.filter(p =>
                (p.fixture_id === fixtureId || p.fixtureId === fixtureId) && p.id !== foundMatch.id
            );
            setAllMatchPicks(sameFixturePicks);
        }
        setLoading(false);
    }, [id, predictions, rawFixtures]);

    // Lazy load details only when tab changes (not on initial render)
    useEffect(() => {
        if (!match) return;

        // Only load details if user navigates to a tab that needs them
        const detailsTabs = ['overview', 'stats', 'h2h', 'lineup'];
        if (!detailsTabs.includes(activeTab)) {
            return;
        }

        let isMounted = true;
        setIsLoadingDetails(true);

        const fetchDetails = async () => {
            try {
                const fixtureId = Number(match.fixtureId || match.fixture_id || match.id) || 0;

                const [od, h2hData, lineupData, statsData, factsData] = await Promise.all([
                    fixtureId ? getLiveOddsFromDB(fixtureId) : null,
                    (match.homeTeamId && match.awayTeamId) ? getH2HFromDB(match.homeTeamId, match.awayTeamId) : null,
                    fixtureId ? getFixtureLineupsFromDB(fixtureId) : null,
                    fixtureId ? getMatchStatsFromDB(fixtureId) : null,
                    fixtureId ? getMatchFactsFromDB(fixtureId) : [],
                ]);

                if (isMounted) {
                    setOdds(od);
                    setRealH2H(h2hData);
                    setLineup(lineupData);
                    setMatchStats(statsData);
                    setMatchFacts(factsData || []);
                    setIsLoadingDetails(false);
                }
            } catch (e) {
                console.error("Error fetching match details:", e);
                if (isMounted) setIsLoadingDetails(false);
            }
        };

fetchDetails();
    }, [id, predictions, rawFixtures, activeTab]);

    const handleBack = () => {
        if (window.history.length > 1) {
            navigate(-1);
        } else {
            navigate('/vip');
        }
    };

    const renderStatBar = (label: string, homeVal: number, awayVal: number, isPercentage = false) => {
        const total = homeVal + awayVal || 1;
        const homePct = (homeVal / total) * 100;
        const awayPct = (awayVal / total) * 100;

        return (
            <div className="mb-4">
                <div className="flex justify-between text-xs mb-1">
                    <span className="font-bold font-mono">{homeVal}{isPercentage ? '%' : ''}</span>
                    <span className="text-gray-500 uppercase">{label}</span>
                    <span className="font-bold font-mono">{awayVal}{isPercentage ? '%' : ''}</span>
                </div>
                <div className="h-2 w-full bg-slate-200 dark:bg-white/10 rounded-full flex overflow-hidden">
                    <div className="bg-vantage-cyan h-full" style={{ width: `${homePct}%` }} />
                    <div className="bg-vantage-purple h-full" style={{ width: `${awayPct}%` }} />
                </div>
            </div>
        );
    };

    if (loading) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-vantage-bg">
                <Loader2 className="animate-spin text-vantage-cyan mb-4" size={40} />
                <p className="text-gray-500 text-sm font-medium animate-pulse">
                    {language === 'fr' ? 'Chargement des détails...' : 'Loading match details...'}
                </p>
            </div>
        );
    }

    if (!match) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-vantage-bg">
                <p className="text-gray-500 text-sm">Match not found</p>
                <button
                    onClick={handleBack}
                    className="mt-4 px-4 py-2 bg-vantage-cyan/10 text-vantage-cyan rounded-lg"
                >
                    {language === 'fr' ? 'Retour' : 'Go Back'}
                </button>
            </div>
        );
    }

    const prediction = match.prediction_en || match.prediction || '';
    const predictionFr = match.prediction_fr || match.prediction || '';
    const analysis = (language === 'fr' ? match.analysis_fr : match.analysis_en) || match.analysis || '';
    const confidence = match.confidence || 0;
    const odds_val = typeof match.odds === 'number' ? match.odds : 0;
    const category = match.category || 'value';
    const categoryColor = category === 'safe' ? 'text-green-400' : category === 'risky' ? 'text-red-400' : 'text-yellow-400';
    const categoryBg = category === 'safe' ? 'bg-green-500/10 border-green-500/20' : category === 'risky' ? 'bg-red-500/10 border-red-500/20' : 'bg-yellow-500/10 border-yellow-500/20';
    const predLabel = language === 'fr' ? predictionFr : prediction;
    const ev = match.expected_value ?? 0;
    const evPct = match.ev_pct ?? (ev * 100);
    const kelly = match.kelly_stake ?? 0;
    const riskMultipliers = { 'low': 0.25, 'medium': 0.5, 'high': 1.0 };
    const riskMult = userProfile?.riskTolerance ? riskMultipliers[userProfile.riskTolerance] : 0.5;
    const bankroll = userProfile?.portfolioBankroll || 0;
    const recommendedStake = bankroll > 0 ? Math.round(bankroll * (kelly / 100) * riskMult) : 0;
    const sparklineData = Array.from({ length: 15 }, () => 1.5 + Math.random() * 0.5);

    return (
        <div className="min-h-screen bg-vantage-bg pb-20">
            {/* Header */}
            <div className="sticky top-0 z-20 bg-vantage-bg/95 backdrop-blur-md border-b border-white/5">
                <div className="flex items-center gap-3 px-4 py-3">
                    <button
                        onClick={handleBack}
                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                    >
                        <ArrowLeft size={20} className="text-white" />
                    </button>
                    <div className="flex-1">
                        <h1 className="text-sm font-bold text-white">
                            {language === 'fr' ? 'Détails du Match' : 'Match Details'}
                        </h1>
                    </div>
                </div>
            </div>

            {/* Match Header */}
            <div className="p-4 border-b border-white/5">
                <div className="text-center mb-4">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider bg-slate-100 dark:bg-white/5 px-3 py-1 rounded-full">
                        {match.league} · {match.time}
                    </span>
                </div>

                <div className="flex justify-between items-center px-4">
                    <div className="flex flex-col items-center w-1/3">
                        <TeamLogo src={match.homeTeamLogo} teamName={match.homeTeam} className="w-14 h-14 mb-2" />
                        <span className="text-xs font-bold text-center leading-tight line-clamp-2">{match.homeTeam}</span>
                    </div>

                    <div className="flex flex-col items-center justify-center w-1/3">
                        {match.score ? (
                            <span className="text-3xl font-black font-mono text-vantage-cyan">
                                {match.score}
                            </span>
                        ) : (
                            <span className="text-2xl font-mono font-bold text-gray-500">VS</span>
                        )}
                    </div>

                    <div className="flex flex-col items-center w-1/3">
                        <TeamLogo src={match.awayTeamLogo} teamName={match.awayTeam} className="w-14 h-14 mb-2" />
                        <span className="text-xs font-bold text-center leading-tight line-clamp-2">{match.awayTeam}</span>
                    </div>
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex px-4 pt-4 overflow-x-auto no-scrollbar border-b border-slate-200 dark:border-white/5 gap-2">
                {[
                    { id: 'prediction', icon: Zap, label: language === 'fr' ? 'Prédiction' : 'Prediction' },
                    { id: 'picks', icon: BarChart3, label: language === 'fr' ? 'Autres Paris' : 'More Picks' },
                    { id: 'overview', icon: Activity, label: language === 'fr' ? 'Aperçu' : 'Overview' },
                    { id: 'stats', icon: BarChart3, label: 'Stats' },
                    { id: 'h2h', icon: Target, label: 'H2H' },
                    { id: 'lineup', icon: Users, label: language === 'fr' ? 'Compo' : 'Lineup' },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as typeof activeTab)}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-sm font-bold whitespace-nowrap transition-colors ${
                            activeTab === tab.id
                                ? 'bg-vantage-cyan/10 text-vantage-cyan border-b-2 border-vantage-cyan'
                                : 'text-gray-500 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <tab.icon size={16} />
                        {tab.label}
                        {tab.id === 'picks' && allMatchPicks.length > 0 && (
                            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-vantage-cyan/20 text-vantage-cyan text-[10px] font-bold">{allMatchPicks.length}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="p-4 min-h-[50vh]">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-6"
                    >
                        {/* PREDICTION TAB */}
                        {activeTab === 'prediction' && (
                            <>
                                {!isVipUser ? (
                                    <div className="flex flex-col items-center justify-center py-10 px-4 text-center space-y-4">
                                        <div className="w-16 h-16 bg-vantage-purple/20 rounded-full flex items-center justify-center mb-2">
                                            <Target size={32} className="text-vantage-purple" />
                                        </div>
                                        <h3 className="text-lg font-bold">
                                            {language === 'fr' ? 'Prédiction VIP Exclusive' : 'Exclusive VIP Prediction'}
                                        </h3>
                                        <p className="text-sm text-gray-500 max-w-[250px] mx-auto">
                                            {language === 'fr'
                                                ? 'Débloquez cette analyse IA, la probabilité de réussite et notre pronostic exact en devenant membre VIP.'
                                                : 'Unlock this AI analysis, the exact success probability, and our precise prediction by becoming a VIP member.'}
                                        </p>
                                        <button
                                            onClick={() => navigate('/vip')}
                                            className="mt-4 flex items-center gap-2 px-6 py-3 bg-vantage-purple hover:bg-purple-600 active:scale-95 transition-all text-white rounded-xl font-bold shadow-lg shadow-vantage-purple/20"
                                        >
                                            <Zap size={18} className="text-yellow-400 fill-yellow-400" />
                                            {language === 'fr' ? 'DEVENIR ALPHA' : 'BECOME ALPHA'}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="space-y-5">
                                        <div className={`rounded-2xl border p-5 text-center ${categoryBg}`}>
                                            <span className={`text-[10px] font-bold uppercase tracking-widest mb-2 block ${categoryColor}`}>
                                                {category === 'safe' ? (language === 'fr' ? '🔒 Sûr' : '🔒 Safe Bet') :
                                                    category === 'risky' ? (language === 'fr' ? '⚡ Risqué' : '⚡ Risky') :
                                                        (language === 'fr' ? '💎 Valeur' : '💎 Value Pick')}
                                            </span>
                                            <p className={`text-xl font-bold tracking-tight ${categoryColor}`}>{predLabel || (language === 'fr' ? 'Analyse en attente' : 'Analysis Pending')}</p>
                                        </div>

                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                            <div className="rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 p-4 flex flex-col items-center justify-center">
                                                <span className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                                                    {language === 'fr' ? 'Confiance' : 'Confidence'}
                                                </span>
                                                <span className={`text-xl font-bold font-mono ${confidence >= 80 ? 'text-green-400' : confidence >= 70 ? 'text-yellow-400' : 'text-red-400'}`}>
                                                    {confidence}%
                                                </span>
                                            </div>
                                            <div className="rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 p-4 flex flex-col items-center justify-center">
                                                <span className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                                                    {language === 'fr' ? 'Cote' : 'Odds'}
                                                </span>
                                                <span className="text-xl font-bold font-mono text-white">
                                                    {odds_val > 0 ? odds_val.toFixed(2) : '—'}
                                                </span>
                                            </div>
                                            <div className="rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 p-4 flex flex-col items-center justify-center">
                                                <span className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                                                    {language === 'fr' ? 'Valeur (EV)' : 'Value (EV)'}
                                                </span>
                                                <span className={`text-xl font-bold font-mono ${evPct > 5 ? 'text-emerald-500' : 'text-orange-500'}`}>
                                                    +{evPct.toFixed(1)}%
                                                </span>
                                            </div>
                                            <div className="rounded-xl bg-slate-50 dark:bg-white/5 border border-vantage-cyan/30 p-4 flex flex-col items-center justify-center shadow-[0_0_15px_rgba(0,229,255,0.1)]">
                                                <span className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                                                    {language === 'fr' ? 'Mise (Kelly)' : 'Stake (Kelly)'}
                                                </span>
                                                <span className="text-xl font-bold font-mono text-vantage-cyan">
                                                    {recommendedStake > 0 ? `${recommendedStake.toLocaleString()}` : `${kelly.toFixed(1)}%`}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="rounded-xl bg-black/20 border border-white/5 p-4 relative h-20 flex flex-col justify-end">
                                            <div className="absolute top-3 left-4 text-[10px] uppercase tracking-widest text-gray-500 font-bold flex items-center gap-2">
                                                <Activity size={12} className="text-vantage-cyan" />
                                                {language === 'fr' ? 'Mouvement de Ligne (Simulé)' : 'Line Movement (Simulated)'}
                                            </div>
                                            <div className="w-full h-8">
                                                <Sparkline data={sparklineData} width={400} height={32} color="#00E5FF" strokeWidth={2} className="w-full" />
                                            </div>
                                        </div>

                                        {analysis ? (
                                            <div className="rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 p-4">
                                                <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2 mb-3">
                                                    <Crosshair size={12} /> {language === 'fr' ? 'Analyse IA' : 'AI Analysis'}
                                                </h4>
                                                <p className="text-sm leading-relaxed text-slate-700 dark:text-gray-300">{analysis}</p>
                                            </div>
                                        ) : (
                                            <div className="text-center py-6 text-gray-500 text-sm">
                                                <Crosshair size={28} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                                                <p>{language === 'fr' ? 'Analyse non disponible' : 'Analysis not yet available'}</p>
                                            </div>
                                        )}

                                        <div className="flex flex-wrap gap-2">
                                            {match.league && (
                                                <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-white/5 text-gray-500 px-3 py-1.5 rounded-full">
                                                    🏆 {match.league}
                                                </span>
                                            )}
                                            {match.time && (
                                                <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-white/5 text-gray-500 px-3 py-1.5 rounded-full">
                                                    🕐 {match.time}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {/* PICKS TAB - Market probabilities (VIP only) */}
                        {activeTab === 'picks' && (
                            <>
                                {!isVipUser ? (
                                    <div className="flex flex-col items-center justify-center py-16 px-4 text-center space-y-4">
                                        <div className="w-16 h-16 bg-vantage-purple/10 rounded-full flex items-center justify-center">
                                            <Crown size={28} className="text-vantage-purple" />
                                        </div>
                                        <div>
                                            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                                                {language === 'fr' ? 'Contenu VIP' : 'VIP Content'}
                                            </h3>
                                            <p className="text-sm text-gray-500 max-w-[240px]">
                                                {language === 'fr' ? 'Passez à Vantage Premium pour voir les probabilités détaillées de chaque marché.' : 'Upgrade to Vantage Premium to see detailed market-by-market probabilities.'}
                                            </p>
                                        </div>
                                    </div>
                                ) : match && (
                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                                    {language === 'fr' ? 'Probabilités par Marché' : 'Market Probabilities'}
                                </h3>

                                {/* 1X2 Probability Bars */}
                                <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Match Result (1X2)</span>
                                    {(() => {
                                        const markets = [
                                            { label: 'Home Win', prob: (match.home_win_prob || 0) * 100 },
                                            { label: 'Draw', prob: (match.draw_prob || 0) * 100 },
                                            { label: 'Away Win', prob: (match.away_win_prob || 0) * 100 },
                                        ];
                                        const highest = Math.max(...markets.map(m => m.prob));
                                        return markets.map(r => (
                                            <div key={r.label} className="flex items-center gap-2">
                                                <span className="text-[10px] text-gray-400 w-16">
                                                    {r.label}
                                                    {r.prob === highest && r.prob > 0 && (
                                                        <span className="text-[7px] text-emerald-400 ml-0.5 font-bold">TOP</span>
                                                    )}
                                                </span>
                                                <div className="flex-1 h-2 rounded-full bg-white/10">
                                                    <div className={`h-2 rounded-full ${r.prob === highest ? 'bg-emerald-500' : 'bg-vantage-cyan'}`} style={{ width: `${Math.min(r.prob, 100)}%` }} />
                                                </div>
                                                <span className="text-[10px] font-mono text-white w-10 text-right">{r.prob.toFixed(0)}%</span>
                                            </div>
                                        ));
                                    })()}
                                </div>

                                {/* Goals Over/Under */}
                                <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Goals Over/Under</span>
                                    {(() => {
                                        const markets = [
                                            { label: 'Over 1.5', prob: (match.over15_prob || 0) * 100 },
                                            { label: 'Over 2.5', prob: (match.over25_prob || 0) * 100 },
                                            { label: 'Over 3.5', prob: (match.over35_prob || 0) * 100 },
                                            { label: 'Under 2.5', prob: (match.under25_prob || 0) * 100 },
                                            { label: 'Under 3.5', prob: (match.under35_prob || 0) * 100 },
                                        ].filter(r => r.prob > 0);
                                        const highest = Math.max(...markets.map(m => m.prob));
                                        return markets.map(r => (
                                            <div key={r.label} className="flex items-center gap-2">
                                                <span className="text-[10px] text-gray-400 w-16">
                                                    {r.label}
                                                    {r.prob === highest && r.prob > 0 && (
                                                        <span className="text-[7px] text-emerald-400 ml-0.5 font-bold">TOP</span>
                                                    )}
                                                </span>
                                                <div className="flex-1 h-2 rounded-full bg-white/10">
                                                    <div className={`h-2 rounded-full ${r.prob === highest ? 'bg-emerald-500' : r.prob >= 70 ? 'bg-vantage-cyan' : 'bg-amber-500'}`} style={{ width: `${Math.min(r.prob, 100)}%` }} />
                                                </div>
                                                <span className="text-[10px] font-mono text-white w-10 text-right">{r.prob.toFixed(0)}%</span>
                                            </div>
                                        ));
                                    })()}
                                </div>

                                {/* BTTS */}
                                {(match.btts_prob || 0) > 0 && (
                                <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Both Teams to Score</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-gray-400 w-16">BTTS Yes</span>
                                        <div className="flex-1 h-2 rounded-full bg-white/10">
                                            <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min((match.btts_prob || 0) * 100, 100)}%` }} />
                                        </div>
                                        <span className="text-[10px] font-mono text-white w-10 text-right">{((match.btts_prob || 0) * 100).toFixed(0)}%</span>
                                    </div>
                                </div>
                                )}

                                {/* First Half */}
                                {(match.fh_over05_prob || match.fh_over15_prob) > 0 && (
                                <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">First Half</span>
                                    {[
                                        { label: 'FH Over 0.5', prob: (match.fh_over05_prob || 0) * 100 },
                                        { label: 'FH Over 1.5', prob: (match.fh_over15_prob || 0) * 100 },
                                    ].filter(r => r.prob > 0).map(r => (
                                        <div key={r.label} className="flex items-center gap-2">
                                            <span className="text-[10px] text-gray-400 w-20">{r.label}</span>
                                            <div className="flex-1 h-2 rounded-full bg-white/10">
                                                <div className={`h-2 rounded-full ${r.prob >= 70 ? 'bg-emerald-500' : 'bg-vantage-cyan'}`} style={{ width: `${Math.min(r.prob, 100)}%` }} />
                                            </div>
                                            <span className="text-[10px] font-mono text-white w-10 text-right">{r.prob.toFixed(0)}%</span>
                                        </div>
                                    ))}
                                </div>
                                )}

                                {/* Top Scorelines */}
                                {match.top_scorelines && match.top_scorelines.length > 0 && (
                                <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Most Likely Scorelines</span>
                                    <div className="flex flex-wrap gap-2">
                                        {match.top_scorelines.slice(0, 4).map((sl: any, i: number) => (
                                            <span key={i} className="text-[10px] font-mono bg-white/10 px-2 py-1 rounded text-gray-300">
                                                {sl.scoreline || sl} ({(sl.prob ? (sl.prob * 100).toFixed(1) : '—')}%)
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                )}
                            </div>
                            )}
                            </>
                        )}

                        {/* OVERVIEW TAB */}
                        {activeTab === 'overview' && (
                            <>
                                {isLoadingDetails ? (
                                    <div className="flex items-center justify-center py-10">
                                        <Loader2 className="animate-spin text-vantage-cyan" size={24} />
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
                                            <Activity size={12} /> {language === 'fr' ? 'État de Forme (5 Derniers)' : 'Form Guide (Last 5)'}
                                        </h4>
                                        <div className="p-4 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5">
                                            {match.homeForm && (
                                                <div className="flex justify-between items-center mb-3">
                                                    <span className="text-xs font-bold">{match.homeTeam}</span>
                                                    <div className="flex gap-1">
                                                        {match.homeForm.split(' ').map((res, i) => (
                                                            <span key={i} className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold ${res === 'W' ? 'bg-green-500/20 text-green-500' :
                                                                res === 'L' ? 'bg-red-500/20 text-red-500' :
                                                                    res === 'D' ? 'bg-gray-500/20 text-gray-500' : 'bg-slate-200 dark:bg-white/10 text-gray-500'
                                                                }`}>{res || '?'}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {match.awayForm && (
                                                <div className="flex justify-between items-center">
                                                    <span className="text-xs font-bold">{match.awayTeam}</span>
                                                    <div className="flex gap-1">
                                                        {match.awayForm.split(' ').map((res, i) => (
                                                            <span key={i} className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold ${res === 'W' ? 'bg-green-500/20 text-green-500' :
                                                                res === 'L' ? 'bg-red-500/20 text-red-500' :
                                                                    res === 'D' ? 'bg-gray-500/20 text-gray-500' : 'bg-slate-200 dark:bg-white/10 text-gray-500'
                                                                }`}>{res || '?'}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {odds && (
                                    <div className="space-y-3">
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
                                            <Scale size={12} /> {language === 'fr' ? 'Probabilités Marché Réel' : 'Real Market Odds (1X2)'}
                                            <span className="ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-500 border border-green-500/30 flex items-center gap-1">
                                                <CheckCircle2 size={8} /> LIVE DATA
                                            </span>
                                        </h4>
                                        <div className="grid grid-cols-3 gap-2">
                                            <div className="p-3 rounded-lg bg-vantage-cyan/10 border border-vantage-cyan/20 flex flex-col items-center">
                                                <span className="text-[10px] text-vantage-cyan mb-1 font-bold">1 (Home)</span>
                                                <span className="text-lg font-bold font-mono">{odds.homeImpliedProb}%</span>
                                                <span className="text-xs font-mono text-gray-500">{odds.home.toFixed(2)}</span>
                                            </div>
                                            <div className="p-3 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex flex-col items-center">
                                                <span className="text-[10px] text-gray-500 mb-1 font-bold">X (Draw)</span>
                                                <span className="text-lg font-bold font-mono">{odds.drawImpliedProb}%</span>
                                                <span className="text-xs font-mono text-gray-500">{odds.draw.toFixed(2)}</span>
                                            </div>
                                            <div className="p-3 rounded-lg bg-vantage-purple/10 border border-vantage-purple/20 flex flex-col items-center">
                                                <span className="text-[10px] text-vantage-purple mb-1 font-bold">2 (Away)</span>
                                                <span className="text-lg font-bold font-mono">{odds.awayImpliedProb}%</span>
                                                <span className="text-xs font-mono text-gray-500">{odds.away.toFixed(2)}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {matchFacts.length > 0 && (
                                    <div className="space-y-2">
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
                                            <Zap size={12} /> {language === 'fr' ? 'Faits du Match' : 'Match Facts'}
                                            <span className="ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full bg-vantage-cyan/15 text-vantage-cyan border border-vantage-cyan/30">AI DATA</span>
                                        </h4>
                                        {matchFacts.map((fact, i) => (
                                            <div key={fact.id || i} className={`p-3 rounded-xl text-xs leading-relaxed border ${
                                                fact.importance === 'high'
                                                    ? 'bg-vantage-cyan/5 border-vantage-cyan/20 text-vantage-cyan'
                                                    : 'bg-white/5 border-white/10 text-gray-300'
                                            }`}>
                                                {fact.importance === 'high' && <span className="font-black mr-1">⚡</span>}
                                                {fact.fact}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}

                        {/* STATS TAB */}
                        {activeTab === 'stats' && (
                            <div className="space-y-5">
                                {matchStats?.stats && (
                                    <>
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
                                            <BarChart3 size={12} /> {language === 'fr' ? 'Stats du Match (Live)' : 'Live Match Statistics'}
                                            <span className="ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-500 border border-green-500/30">LIVE DATA</span>
                                        </h4>
                                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider mb-1 text-gray-500">
                                            <span>{match.homeTeam}</span>
                                            <span>{match.awayTeam}</span>
                                        </div>
                                        {matchStats.stats.possession?.home != null && renderStatBar(language === 'fr' ? 'Possession %' : 'Possession %', matchStats.stats.possession.home, matchStats.stats.possession.away ?? 0, true)}
                                        {matchStats.stats.shots?.home != null && renderStatBar(language === 'fr' ? 'Tirs' : 'Shots', matchStats.stats.shots.home, matchStats.stats.shots.away ?? 0)}
                                        {matchStats.stats.shots_on_target?.home != null && renderStatBar(language === 'fr' ? 'Tirs cadrés' : 'Shots on Target', matchStats.stats.shots_on_target.home, matchStats.stats.shots_on_target.away ?? 0)}
                                        {matchStats.stats.corners?.home != null && renderStatBar(language === 'fr' ? 'Corners' : 'Corners', matchStats.stats.corners.home, matchStats.stats.corners.away ?? 0)}
                                        {matchStats.stats.fouls?.home != null && renderStatBar(language === 'fr' ? 'Fautes' : 'Fouls', matchStats.stats.fouls.home, matchStats.stats.fouls.away ?? 0)}
                                        {matchStats.stats.yellow_cards?.home != null && renderStatBar(language === 'fr' ? 'Cartons Jaunes' : 'Yellow Cards', matchStats.stats.yellow_cards.home, matchStats.stats.yellow_cards.away ?? 0)}
                                    </>
                                )}
                                {!matchStats?.stats && (match.homeWinRate !== undefined || match.awayWinRate !== undefined) && (
                                    <>
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
                                            <BarChart3 size={12} /> {language === 'fr' ? 'Stats Saison (IA)' : 'Season Stats (AI)'}
                                        </h4>
                                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider mb-1 text-gray-500">
                                            <span>{match.homeTeam}</span>
                                            <span>{match.awayTeam}</span>
                                        </div>
                                        {match.homeWinRate !== undefined && renderStatBar(language === 'fr' ? 'Victoires %' : 'Win Rate %', match.homeWinRate || 0, match.awayWinRate || 0, true)}
                                        {match.homeAvgScored !== undefined && renderStatBar(language === 'fr' ? 'Buts marqués (moy)' : 'Avg Goals Scored', match.homeAvgScored || 0, match.awayAvgScored || 0)}
                                        {match.homeAvgConceded !== undefined && renderStatBar(language === 'fr' ? 'Buts concédés (moy)' : 'Avg Goals Conceded', match.homeAvgConceded || 0, match.awayAvgConceded || 0)}
                                    </>
                                )}
                                {!matchStats?.stats && match.homeWinRate === undefined && (
                                    <div className="text-center py-10 text-gray-500 text-sm">
                                        <BarChart3 size={32} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                                        <p>{language === 'fr' ? 'Statistiques non disponibles' : 'Stats not available for this match'}</p>
                                        <p className="text-xs mt-1 text-gray-400">{language === 'fr' ? '(Disponibles pendant/après le match)' : '(Available during/after the match)'}</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* H2H TAB */}
                        {activeTab === 'h2h' && (
                            <div className="space-y-6">
                                {(() => {
                                    const h2hData = realH2H || (match.h2hHomeWins !== undefined ? { homeTeamWins: match.h2hHomeWins!, awayTeamWins: match.h2hAwayWins!, draws: match.h2hDraws!, last5Goals: match.h2hLast5Goals || '' } : null);
                                    if (!h2hData) return (
                                        <div className="text-center py-10 text-gray-500 text-sm">
                                            {language === 'fr' ? 'Données H2H non disponibles' : 'H2H data not available'}
                                        </div>
                                    );
                                    return (
                                        <>
                                            <div className="p-6 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 text-center">
                                                <div className="flex items-center justify-between mb-3">
                                                    <Trophy size={24} className="text-yellow-500" />
                                                    {realH2H && (
                                                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-500 border border-green-500/30 flex items-center gap-1">
                                                            <CheckCircle2 size={8} /> LIVE DATA
                                                        </span>
                                                    )}
                                                </div>
                                                <h4 className="text-sm font-bold mb-4">{language === 'fr' ? 'Confrontations Directes (5 dernières)' : 'Head-to-Head (Last 5)'}</h4>
                                                <div className="flex justify-center items-center gap-6">
                                                    <div className="flex flex-col items-center">
                                                        <span className="text-2xl font-bold font-mono text-vantage-cyan mb-1">{h2hData.homeTeamWins}</span>
                                                        <span className="text-[10px] text-gray-500 uppercase">{match.homeTeam}</span>
                                                    </div>
                                                    <div className="flex flex-col items-center">
                                                        <span className="text-lg font-bold font-mono text-gray-400 mb-1">{h2hData.draws}</span>
                                                        <span className="text-[10px] text-gray-500 uppercase">Draws</span>
                                                    </div>
                                                    <div className="flex flex-col items-center">
                                                        <span className="text-2xl font-bold font-mono text-vantage-purple mb-1">{h2hData.awayTeamWins}</span>
                                                        <span className="text-[10px] text-gray-500 uppercase">{match.awayTeam}</span>
                                                    </div>
                                                </div>
                                                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/10 text-xs text-gray-500 truncate px-2 font-mono">
                                                    Scores: {h2hData.last5Goals || 'N/A'}
                                                </div>
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                        )}

                        {/* LINEUP TAB */}
                        {activeTab === 'lineup' && (
                            <div className="space-y-4">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
                                    <Users size={12} /> {language === 'fr' ? 'Compositions Probables' : 'Expected Lineups'}
                                    {lineup && (
                                        <span className="ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-500 border border-green-500/30">LIVE DATA</span>
                                    )}
                                </h4>
                                {lineup ? (
                                    <div className="space-y-4">
                                        <VisualPitch 
                                            homeTeamName={match.homeTeam} 
                                            awayTeamName={match.awayTeam} 
                                            homeLineup={lineup.home} 
                                            awayLineup={lineup.away} 
                                        />
                                        <div className="grid grid-cols-2 gap-4 mt-6">
                                            <div className="space-y-2">
                                                <h5 className="text-xs font-bold text-center border-b border-slate-200 dark:border-white/10 pb-2">{match.homeTeam}</h5>
                                                {lineup.home.map((player, i) => (
                                                    <div key={i} className="flex items-center gap-2 p-2 rounded bg-white/5 text-xs">
                                                        <span className="w-5 h-5 rounded-full bg-vantage-cyan/20 text-vantage-cyan flex items-center justify-center text-[10px] font-bold">{player.number || i + 1}</span>
                                                        <span className="text-gray-200 truncate">{player.name}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="space-y-2">
                                                <h5 className="text-xs font-bold text-center border-b border-slate-200 dark:border-white/10 pb-2">{match.awayTeam}</h5>
                                                {lineup.away.map((player, i) => (
                                                    <div key={i} className="flex items-center gap-2 p-2 rounded bg-white/5 text-xs">
                                                        <span className="w-5 h-5 rounded-full bg-vantage-purple/20 text-vantage-purple flex items-center justify-center text-[10px] font-bold">{player.number || i + 1}</span>
                                                        <span className="text-gray-200 truncate">{player.name}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center py-10 text-gray-500 text-sm">
                                        <Users size={32} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                                        <p>{language === 'fr' ? 'Compositions non disponibles' : 'Lineup not available'}</p>
                                        <p className="text-xs mt-1 text-gray-400">{language === 'fr' ? '(Disponibles après la publication des compositions)' : '(Available after lineup announcement)'}</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    );
};

export default MatchDetails;

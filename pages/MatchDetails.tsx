import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowLeft, Activity, Scale, ShieldAlert, Zap, Loader2, Trophy, Crosshair, Target, BarChart3, Newspaper, Users, CheckCircle2, ChevronRight, Crown, Clock, MapPin, Home as HomeIcon, CloudSun, Copy, AlertTriangle } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { NavigationTab, Match, MatchNews } from '../types';
import { getLiveOddsFromDB, getH2HFromDB, getMatchNewsFromDB, getFixtureLineupsFromDB, getMatchStatsFromDB, getMatchFactsFromDB, LineupPlayer, H2HRecord, MatchOdds, MatchStatsData, MatchFact } from '../services/sportsData';
import { TeamLogo } from '../components/TeamLogo';
import { VisualPitch } from '../components/VisualPitch';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { getSmartBadges, getTopProbPicks, plainMarket } from '../utils';
import { TeamStrengthSection } from '../components/intel/TeamStrengthSection';
import { TeamDetailSheet } from '../components/TeamDetailSheet';

export const MatchDetails: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { language, showToast } = useAppContext();
    const { t } = useAppContext();
    const { userProfile, isAdmin } = useAuth();
    const { predictions, rawFixtures } = useData();
    const isVipUser = userProfile?.isVip === true || isAdmin;

    const [match, setMatch] = useState<Match | null>(null);
    
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'analysis' | 'overview' | 'h2h' | 'lineup'>('analysis');
    const [secondaryTab, setSecondaryTab] = useState<string>('Prediction');
    const [allMatchPicks, setAllMatchPicks] = useState<Match[]>([]);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const [selectedScoreline, setSelectedScoreline] = useState<number>(0);

    const [odds, setOdds] = useState<MatchOdds | null>(null);
    const [realH2H, setRealH2H] = useState<H2HRecord | null>(null);
    const [lineup, setLineup] = useState<{ home: LineupPlayer[]; away: LineupPlayer[] } | null>(null);
    const [detailSheet, setDetailSheet] = useState<'home' | 'away' | null>(null);
    const [matchStats, setMatchStats] = useState<MatchStatsData | null>(null);
    const [matchFacts, setMatchFacts] = useState<MatchFact[]>([]);

    useEffect(() => {
        if (!id) return;

        const foundMatch = [...predictions, ...rawFixtures].find(m => m.id === id);
        if (foundMatch) {
            setMatch(foundMatch);
            import('../services/analytics').then(({ trackEvent }) => {
                trackEvent('match_details_viewed', {
                    match_id: id,
                    league: foundMatch.league || '',
                    teams: `${foundMatch.homeTeam || ''} v ${foundMatch.awayTeam || ''}`,
                });
            }).catch(() => {});
            // Find all predictions for the same fixture
            const fixtureId = foundMatch.fixture_id || foundMatch.fixtureId;
            const sameFixturePicks = predictions.filter(p =>
                (p.fixture_id === fixtureId || p.fixtureId === fixtureId) && p.id !== foundMatch.id
            );
            setAllMatchPicks(sameFixturePicks);
        }
        setLoading(false);
    }, [id, predictions, rawFixtures]);

    // Lazy load details only when a data-hungry section is open
    useEffect(() => {
        if (!match) return;

        const needsDetails = ['overview', 'stats', 'h2h', 'lineup'].includes(activeTab)
            || ['Lineup', 'H2H'].includes(secondaryTab);
        if (!needsDetails) {
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
    }, [id, predictions, rawFixtures, activeTab, secondaryTab]);

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
    const evPct = match.ev_pct ?? (ev > 1 ? ev : ev * 100);
    const kelly = match.kelly_stake ?? 0;
    const riskMultipliers = { 'low': 0.25, 'medium': 0.5, 'high': 1.0 };
    const riskMult = userProfile?.riskTolerance ? riskMultipliers[userProfile.riskTolerance] : 0.5;
    const bankroll = userProfile?.portfolioBankroll || 0;
    const recommendedStake = bankroll > 0 ? Math.round(bankroll * (kelly / 100) * riskMult) : 0;
    
    const isFreeMatchCheck = () => {
        const sorted = [...predictions].sort((a, b) => {
            const probA = Math.max(a.home_win_prob||0, a.away_win_prob||0, a.draw_prob||0, a.over25_prob||0, a.btts_prob||0);
            const probB = Math.max(b.home_win_prob||0, b.away_win_prob||0, b.draw_prob||0, b.over25_prob||0, b.btts_prob||0);
            return probB - probA;
        });
        const topPicks = sorted.filter(m => m.category === 'safe');
        const freeablePicks = topPicks.length > 0 ? topPicks : sorted.filter(m => m.category === 'value');
        const freeIds = new Set(freeablePicks.slice(0, 3).map(m => m.id));
        return freeIds.has(match.id);
    };
    
    const isUnlocked = isVipUser || isFreeMatchCheck();

    return (
        <div className="min-h-screen bg-vantage-bg pb-20 font-sans text-white">
            {/* Header (Top Nav) */}
            <div className="sticky top-0 z-20 bg-vantage-bg/95 backdrop-blur-md border-b border-white/10">
                <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                        <button onClick={handleBack} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                            <ArrowLeft size={20} className="text-white" />
                        </button>
                        <div className="flex items-center gap-2">
                            <Zap size={16} className="text-vantage-cyan" />
                            <h1 className="text-sm font-bold text-white">Analysis</h1>
                        </div>
                    </div>

                    <button
                        onClick={() => {
                            const text = `${match.homeTeam} vs ${match.awayTeam}`;
                            navigator.clipboard.writeText(text).then(() => {
                                showToast?.(language === 'fr' ? 'Copié !' : 'Copied!');
                            }).catch(() => {});
                        }}
                        title="Copy team names"
                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-gray-400"
                    >
                        <Copy size={16} />
                    </button>
                </div>
            </div>

            {/* Match Header */}
            <div className="relative p-4 border-b border-white/10">
                <div className="flex flex-col items-center text-center space-y-1 mb-3">
                    <div className="flex items-center gap-2 text-[10px] text-gray-400">
                        <span className="font-bold text-gray-300">{match.league || 'Unknown League'}</span>
                        {match.league_tier && <span className="text-gray-600">· Tier {match.league_tier}</span>}
                    </div>
                    <div className="flex items-center justify-center gap-3 text-[10px] text-gray-500">
                        {match.time && <span className="flex items-center gap-1"><Clock size={10} /> {match.time} (Lagos)</span>}
                        {(match as any).venue_city && <span className="flex items-center gap-1"><MapPin size={10} /> {(match as any).venue_city}</span>}
                        <span className="flex items-center gap-1"><HomeIcon size={10} /> {match.homeTeam}</span>
                    </div>
                </div>
                <div className="flex justify-between items-center px-4 max-w-3xl mx-auto">
                    <div className="flex items-center gap-3 w-1/3">
                        <button onClick={() => setDetailSheet('home')} className="shrink-0 active:scale-90 transition-transform" title={`${match.homeTeam} — view squad & lineup`}>
                            <TeamLogo src={match.homeTeamLogo} teamName={match.homeTeam} className="w-12 h-12 md:w-14 md:h-14 rounded-xl ring-1 ring-white/10 hover:ring-vantage-cyan/40" />
                        </button>
                        <span className="text-base md:text-xl font-bold leading-tight">{match.homeTeam}</span>
                        <span className="text-xs text-gray-500 hidden md:inline ml-2">Home</span>
                    </div>
                    
                    <div className="flex flex-col items-center justify-center w-1/3 text-center">
                        <span className="text-sm font-bold text-gray-400 mb-1">VS</span>
                        <span className="text-xs text-gray-300">Today • {match.time}</span>
                        {match.weather && <span className="text-[10px] text-gray-500 mt-1 capitalize flex items-center justify-center gap-1"><CloudSun size={11} /> {match.weather}</span>}
                        {match.score && <span className="text-2xl font-bold font-mono text-transparent bg-clip-text bg-vantage-gradient mt-1">{match.score}</span>}
                    </div>

                    <div className="flex items-center justify-end gap-3 w-1/3 text-right">
                        <span className="text-xs text-gray-500 hidden md:inline mr-2">Away</span>
                        <span className="text-base md:text-xl font-bold leading-tight">{match.awayTeam}</span>
                        <button onClick={() => setDetailSheet('away')} className="shrink-0 active:scale-90 transition-transform" title={`${match.awayTeam} — view squad & lineup`}>
                            <TeamLogo src={match.awayTeamLogo} teamName={match.awayTeam} className="w-12 h-12 md:w-14 md:h-14 rounded-xl ring-1 ring-white/10 hover:ring-vantage-purple/40" />
                        </button>
                    </div>
                </div>
            </div>
            
            {/* Section tabs — livescore style, under team logos */}
            <div className="sticky top-[57px] z-10 bg-vantage-bg/95 backdrop-blur-md border-b border-white/10 overflow-x-auto no-scrollbar">
                <div className="flex gap-6 flex-nowrap px-4">
                    {['Prediction', 'Correct Scores', 'AI Reasons', 'Trends', 'Lineup', 'H2H'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setSecondaryTab(tab)}
                            className={`py-3 text-xs font-bold whitespace-nowrap flex-shrink-0 border-b-2 transition-colors ${
                                secondaryTab === tab
                                    ? 'border-vantage-cyan text-vantage-cyan'
                                    : 'border-transparent text-gray-400 hover:text-white'
                            }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            {/* VIP Lock Check */}
            {!isUnlocked ? (
                <div className="flex flex-col items-center justify-center py-10 px-4 text-center space-y-4 max-w-md mx-auto">
                    <div className="w-16 h-16 bg-vantage-purple/20 rounded-full flex items-center justify-center mb-2">
                        <Target size={32} className="text-vantage-purple" />
                    </div>
                    <h3 className="text-lg font-bold">
                        {language === 'fr' ? 'Prédiction VIP Exclusive' : 'Exclusive VIP Prediction'}
                    </h3>
                    <p className="text-sm text-gray-500">
                        {language === 'fr'
                            ? 'Débloquez cette analyse IA complète, la probabilité de réussite et notre pronostic exact en devenant membre VIP.'
                            : 'Unlock this comprehensive AI analysis, the exact success probability, and our precise prediction by becoming a VIP member.'}
                    </p>
                    <button
                        onClick={() => navigate('/vip')}
                        className="mt-4 flex items-center justify-center gap-2 px-6 py-3 bg-vantage-purple hover:bg-purple-600 active:scale-95 transition-all text-white w-full rounded-xl font-bold shadow-lg shadow-vantage-purple/20"
                    >
                        <Zap size={18} className="text-yellow-400 fill-yellow-400" />
                        {language === 'fr' ? 'DEVENIR ALPHA' : 'BECOME ALPHA'}
                    </button>
                </div>
            ) : (
                <div className="max-w-7xl mx-auto px-4 mt-4">
                  {secondaryTab === 'Prediction' && (<>
                    {/* Safest Pick Banner */}
                    {/* Safest Pick Banner — compact strip */}
                    <div className="relative rounded-xl overflow-hidden mb-4 border border-emerald-500/20 bg-gradient-to-r from-emerald-900/30 to-vantage-bg">
                        <div className="relative z-10 px-4 py-3 flex items-center gap-3">
                            <Trophy size={16} className="text-emerald-400 shrink-0" />
                            <div className="min-w-0 flex-1">
                                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest block">
                                    Safest Pick
                                    {match.odds_fresh === false && (
                                        <span className="ml-2 text-[8px] font-black px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 align-middle">STALE ODDS</span>
                                    )}
                                </span>
                                <span className="text-sm font-bold text-white truncate block">
                                    {(() => {
                                        const top = getTopProbPicks(match);
                                        return top.length > 0 ? top.map((p: any) => plainMarket(p.name)).join(' / ') : plainMarket(match.prediction_en || match.prediction || match.bet_type);
                                    })()}
                                </span>
                            </div>
                            <div className="text-right shrink-0">
                                <span className="text-lg font-black font-mono text-emerald-400 block">
                                    {(() => {
                                        const top = getTopProbPicks(match);
                                        return top.length > 0 ? Math.round(top[0].prob * 100) : (match.confidence ?? 0);
                                    })()}%
                                </span>
                                <span className="text-[9px] text-emerald-400/70">
                                    {(() => {
                                        const p = (() => { const t = getTopProbPicks(match); return t.length > 0 ? Math.round(t[0].prob * 100) : (match.confidence ?? 0); })();
                                        if (p >= 90) return '★★★★★ Elite';
                                        if (p >= 80) return '★★★★☆ Very Strong';
                                        if (p >= 70) return '★★★☆☆ Strong';
                                        if (p >= 60) return '★★☆☆☆ Moderate';
                                        return '★☆☆☆☆ Low';
                                    })()}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Other Good Markets — only our statistically strongest, direction-aligned markets */}
                    {(() => {
                        // Direction of the prediction: favored side + goals lean
                        const homeP = (match.home_win_prob || 0) * 100;
                        const awayP = (match.away_win_prob || 0) * 100;
                        const favSide = homeP >= awayP ? 'home' : 'away';

                        // GOALS LEAN must inherit from the Safest Pick when it's a
                        // goals market — never from Over 1.5 (≥50% almost always,
                        // which falsely labels every match "over").
                        const pickRaw = ((match.prediction_en || match.prediction || match.bet_type) || '').toLowerCase();
                        const topName = getTopProbPicks(match)[0]?.name?.toLowerCase() || '';
                        const anchor = `${pickRaw} ${topName}`;
                        let goalLean: 'over' | 'under';
                        if (anchor.includes('under')) goalLean = 'under';
                        else if (anchor.includes('over')) goalLean = 'over';
                        else {
                            // Non-goals anchor: use expected total goals vs typical 2.6 baseline
                            const totalXg = (match.expected_goals_home ?? 0) + (match.expected_goals_away ?? 0);
                            goalLean = totalXg >= 2.6 ? 'over' : 'under';
                        }

                        // Backtest (n=1614): DC markets are strongest; goals slot uses
                        // the SAFE line for the inherited lean (over→1.5, under→3.5).
                        const over15 = (match.over15_prob || 0) * 100;
                        const over35 = (match.over35_prob || 0) * 100;
                        const candidates: { l: string; code: string; p: number; side?: string; goals?: string }[] = [
                            { l: 'Home or Draw', code: '1X', p: ((match.double_chance_1x || 0) * 100), side: 'home' },
                            { l: 'Draw or Away', code: 'X2', p: ((match.double_chance_x2 || 0) * 100), side: 'away' },
                            { l: 'Home or Away', code: '12', p: ((match.double_chance_12 || 0) * 100) },
                            goalLean === 'over'
                                ? { l: 'Over 1.5 Goals', code: 'O1.5', p: over15, goals: 'over' }
                                : { l: 'Under 3.5 Goals', code: 'U3.5', p: (100 - over35), goals: 'under' },
                        ];

                        // Only direction-aligned, value-worthy markets make the cut
                        const markets = candidates
                            .filter(m => m.p > 50)
                            .filter(m => !m.side || m.side === favSide)
                            .filter(m => !m.goals || m.goals === goalLean)
                            .sort((a, b) => b.p - a.p)
                            .slice(0, 4);
                        if (markets.length === 0) return null;
                        return (
                            <div className="mb-4 rounded-xl border border-vantage-cyan/20 bg-vantage-cyan/[0.04] p-3">
                                <span className="text-[10px] font-bold text-vantage-cyan uppercase tracking-widest block mb-2.5">
                                    {language === 'fr' ? 'AUTRES BONS MARCHÉS' : 'OTHER GOOD MARKETS'}
                                </span>
                                <div className="grid grid-cols-2 gap-2">
                                    {markets.map((m, i) => (
                                        <div key={i} className="rounded-lg bg-white/5 px-2.5 py-2">
                                            <div className="flex items-center justify-between gap-1 mb-1">
                                                <span className="text-[10px] font-semibold text-gray-300 truncate">{m.l}</span>
                                                <span className="text-[8px] font-black text-gray-500 shrink-0">{m.code}</span>
                                            </div>
                                            <div className="flex items-center justify-between gap-1">
                                                <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                                                    <div className="h-full bg-emerald-400/80 rounded-full" style={{ width: `${m.p}%` }} />
                                                </div>
                                                <span className="text-[11px] font-black font-mono text-emerald-400 ml-1.5 shrink-0">{m.p.toFixed(0)}%</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}

                    {/* Decision Guide */}
                    <div className="space-y-3 mb-6">
                        {/* AI Match Rating */}
                        {(() => {
                            const prob = (() => { const t = getTopProbPicks(match); return t.length > 0 ? Math.round(t[0].prob * 100) : (match.confidence ?? 0); })();
                            const quality = match.data_quality;
                            const agreement = match.model_agreement ?? match.result_confidence;
                            const hasRating = quality != null && agreement != null;
                            const rating = hasRating
                                ? Math.round(((prob/100 * 0.4) + (quality * 0.3) + (agreement * 0.3)) * 10)
                                : null;
                            return (
                                <div className="bg-gradient-to-r from-emerald-500/10 to-vantage-cyan/5 border border-emerald-500/20 rounded-xl p-3 flex items-center justify-between">
                                    <div>
                                        <span className="text-[9px] text-emerald-400 uppercase font-bold">AI Match Rating</span>
                                        <span className="text-2xl font-black text-white ml-2">{hasRating ? `${rating}/10` : '—'}</span>
                                    </div>
                                    {hasRating && (
                                        <div className="flex-1 mx-3 h-2 rounded-full bg-white/10 overflow-hidden">
                                            <div className="h-full bg-gradient-to-r from-emerald-500 to-vantage-cyan rounded-full" style={{width: `${rating*10}%`}} />
                                        </div>
                                    )}
                                    <span className="text-[9px] text-gray-500">{hasRating ? (rating >= 8 ? 'Strong Match' : rating >= 6 ? 'Solid Match' : 'Uncertain') : 'Data unavailable'}</span>
                                </div>
                            );
                        })()}

                        {/* Team Strength Intelligence (VTI radar, battles, raw metrics) */}
                        <TeamStrengthSection
                            homeTeamName={match.homeTeam || match.home_team || ''}
                            awayTeamName={match.awayTeam || match.away_team || ''}
                        />

                        {/* Why This Pick + Risk Factors */}
                        <div className="grid grid-cols-5 gap-3">
                            <div className="col-span-3 bg-white/5 border border-white/5 rounded-xl p-3">
                                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block mb-2">
                                    {language === 'fr' ? 'POURQUOI CE PICK' : 'WHY THIS PICK'}
                                </span>
                                <div className="space-y-1.5">
                                    {(() => {
                                        const reasons: string[] = [];
                                        const h = match.home_avg_scored;
                                        const a = match.away_avg_scored;
                                        const xg = (match.expected_goals_home ?? 0) + (match.expected_goals_away ?? 0);
                                        const ag = match.model_agreement ?? match.result_confidence ?? 0;

                                        if (h != null && Number(h) > 1.2) reasons.push(`${match.homeTeam} score often — about ${Number(h).toFixed(1)} goals a game`);
                                        if (a != null && Number(a) > 1.2) reasons.push(`${match.awayTeam} score often — about ${Number(a).toFixed(1)} goals a game`);
                                        if (xg > 2) reasons.push(`Expect a lively match — around ${xg.toFixed(0)} goals between both teams`);
                                        if (ag > 0.7) reasons.push(ag >= 0.9 ? 'Every part of our analysis points the same way' : 'Most angles of our analysis agree');
                                        if (Number(match.odds) > 1.05 && (match.expected_value ?? 0) > 0) reasons.push('The bookmaker price is better than the true chance — good value');
                                        if (match.vault_eligible) reasons.push('Ranked among our safest picks of the day');

                                        if (reasons.length === 0) return <p className="text-[10px] text-gray-500">Our model sees no strong edge here — treat this match with caution.</p>;
                                        return reasons.map((r, i) => (
                                            <p key={i} className="text-[11px] text-gray-300 flex items-start gap-1.5 leading-snug">
                                                <CheckCircle2 size={12} className="text-emerald-400 shrink-0 mt-px" />
                                                {r}
                                            </p>
                                        ));
                                    })()}
                                </div>
                            </div>
                            <div className="col-span-2 bg-white/5 border border-white/5 rounded-xl p-3">
                                <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider block mb-2">
                                    {language === 'fr' ? 'FACTEURS DE RISQUE' : 'RISK FACTORS'}
                                </span>
                                <div className="space-y-1.5">
                                    {(() => {
                                        const risks: string[] = [];
                                        const rest = Math.min(match.home_days_rest ?? 7, match.away_days_rest ?? 7);
                                        const injured = (match.home_sidelined_count ?? 0) + (match.away_sidelined_count ?? 0);
                                        if (rest < 4) risks.push(`Little rest — only ${rest} days since their last match`);
                                        if (injured >= 3) risks.push(`${injured} players missing through injury`);
                                        if ((match as any).line_signal === 'sharp_money_disagrees') risks.push('Big money is moving the other way');
                                        if (match.weather === 'windy' || match.weather === 'rainy') risks.push('Bad weather could disrupt the game');
                                        if ((match as any).btts_blanking_risk) risks.push('One side may not score at all');

                                        if (risks.length === 0) return (
                                            <p className="text-[11px] text-emerald-400/80 flex items-start gap-1.5 leading-snug">
                                                <CheckCircle2 size={12} className="shrink-0 mt-px" /> No red flags — all clear
                                            </p>
                                        );
                                        return risks.map((r, i) => (
                                            <p key={i} className="text-[11px] text-rose-400/80 flex items-start gap-1.5 leading-snug">
                                                <AlertTriangle size={12} className="shrink-0 mt-px" /> {r}
                                            </p>
                                        ));
                                    })()}
                                </div>
                            </div>
                        </div>

                        {/* What to Avoid */}
                        {(() => {
                            const avoidMarkets = [
                                { l: 'Home Win', p: (match.home_win_prob || 0) * 100 },
                                { l: 'Away Win', p: (match.away_win_prob || 0) * 100 },
                                { l: 'Draw', p: (match.draw_prob || 0) * 100 },
                            ].filter(m => m.p > 0).sort((a, b) => a.p - b.p);
                            if (avoidMarkets.length === 0) return null;
                            return (
                                <div className="bg-white/5 border border-white/5 rounded-xl p-3">
                                    <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider block mb-2">
                                        {language === 'fr' ? 'À ÉVITER' : 'WHAT TO AVOID'}
                                    </span>
                                    <div className="space-y-1">
                                        {avoidMarkets.slice(0, 2).map((m, i) => (
                                            <p key={i} className="text-[10px] text-gray-400">
                                                ❌ {m.l} — {m.p.toFixed(0)}% {language === 'fr' ? 'de chance' : 'chance'}
                                            </p>
                                        ))}
                                    </div>
                                    <p className="text-[9px] text-gray-500 mt-1">
                                        {language === 'fr' ? 'Ces marchés ont une faible probabilité.' : 'These markets have low probability of success.'}
                                    </p>
                                </div>
                            );
                        })()}

                        {/* Risk Meter */}
                        <div className="bg-white/5 border border-white/5 rounded-xl p-3">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">
                                {language === 'fr' ? 'NIVEAU DE RISQUE' : 'RISK LEVEL'}
                            </span>
                            {(() => {
                                const rest = Math.min(match.home_days_rest ?? 7, match.away_days_rest ?? 7);
                                const injured = (match.home_sidelined_count ?? 0) + (match.away_sidelined_count ?? 0);
                                const hasSharpDisagree = (match as any).line_signal === 'sharp_money_disagrees';
                                const hasWeather = match.weather === 'windy' || match.weather === 'rainy';
                                let riskScore = 20; // Base
                                if (rest < 3) riskScore += 30;
                                else if (rest < 4) riskScore += 15;
                                if (injured >= 6) riskScore += 25;
                                else if (injured >= 3) riskScore += 10;
                                if (hasSharpDisagree) riskScore += 20;
                                if (hasWeather) riskScore += 15;
                                riskScore = Math.min(riskScore, 100);
                                const label = riskScore < 30 ? (language === 'fr' ? 'Très Faible' : 'Very Low') : riskScore < 50 ? (language === 'fr' ? 'Faible' : 'Low') : riskScore < 70 ? (language === 'fr' ? 'Moyen' : 'Medium') : (language === 'fr' ? 'Élevé' : 'High');
                                const color = riskScore < 30 ? 'bg-emerald-500' : riskScore < 50 ? 'bg-vantage-cyan' : riskScore < 70 ? 'bg-amber-500' : 'bg-rose-500';
                                const textColor = riskScore < 30 ? 'text-emerald-400' : riskScore < 50 ? 'text-vantage-cyan' : riskScore < 70 ? 'text-amber-400' : 'text-rose-400';
                                return (
                                    <>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className={`text-xs font-bold ${textColor}`}>{label}</span>
                                            <span className="text-[9px] text-gray-500">{riskScore}/100</span>
                                        </div>
                                        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                                            <div className={`h-full rounded-full ${color}`} style={{width: `${riskScore}%`}} />
                                        </div>
                                        <p className="text-[9px] text-gray-500 mt-1">
                                            {riskScore < 30 ? (language === 'fr' ? 'Idéal pour les accumulators.' : 'Ideal for accumulators.') :
                                             riskScore < 50 ? (language === 'fr' ? 'Bon pour les paris simples.' : 'Good for single bets.') :
                                             riskScore < 70 ? (language === 'fr' ? 'À considérer avec prudence.' : 'Consider with caution.') :
                                             (language === 'fr' ? 'Éviter les accumulators.' : 'Avoid accumulators.')}
                                        </p>
                                    </>
                                );
                            })()}
                        </div>

                        {/* Confidence Breakdown */}
                        <div className="bg-white/5 border border-white/5 rounded-xl p-3">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">
                                {language === 'fr' ? 'CONFIANCE DÉTAILLÉE' : 'CONFIDENCE BREAKDOWN'}
                            </span>
                            <div className="space-y-1.5">
                                {(() => {
                                    const agreement = Math.round((match.model_agreement ?? match.result_confidence ?? 0.8) * 100);
                                    const quality = Math.round((match.data_quality ?? 0.8) * 100);
                                    const ev = (match.expected_value ?? 0) * 100;
                                    const evPct = Math.max(4, Math.min(100, Math.abs(ev) * 2));
                                    const rows = [
                                        { l: language === 'fr' ? 'Accord du Modèle' : 'Model Agreement', v: `${agreement}%`, w: `${Math.max(4, Math.min(100, agreement))}%` },
                                        { l: language === 'fr' ? 'Qualité Données' : 'Data Quality', v: `${quality}%`, w: `${Math.max(4, Math.min(100, quality))}%` },
                                        { l: language === 'fr' ? 'Valeur Marché' : 'Market Value', v: `${ev > 0 ? '+' : ''}${ev.toFixed(1)}% EV`, w: `${evPct}%` },
                                    ];
                                    return rows.map(row => (
                                        <div key={row.l} className="flex items-center gap-2">
                                            <span className="text-[10px] text-gray-400 w-28 truncate">{row.l}</span>
                                            <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                                                <div className="h-full bg-vantage-cyan/60 rounded-full transition-all duration-700" style={{ width: row.w }} />
                                            </div>
                                            <span className="text-[9px] font-mono text-gray-300 w-14 text-right">{row.v}</span>
                                        </div>
                                    ));
                                })()}
                            </div>
                        </div>

                        {/* Match Outlook — star ratings */}
                        <div className="grid grid-cols-3 gap-2">
                            {(() => {
                                const totalXg = (match.expected_goals_home ?? 0) + (match.expected_goals_away ?? 0);
                                const goalsStars = totalXg > 3.5 ? '★★★★★' : totalXg > 2.5 ? '★★★★☆' : totalXg > 1.5 ? '★★★☆☆' : '★★☆☆☆';
                                const goalsLabel = totalXg > 3.5 ? 'Very High' : totalXg > 2.5 ? 'High' : totalXg > 1.5 ? 'Moderate' : 'Low';
                                const homeStars = (match.home_win_prob ?? 0) > 0.5 ? '★★★★☆' : (match.home_win_prob ?? 0) > 0.35 ? '★★★☆☆' : '★★☆☆☆';
                                const awayStars = (match.away_win_prob ?? 0) > 0.4 ? '★★★★☆' : (match.away_win_prob ?? 0) > 0.25 ? '★★★☆☆' : '★★☆☆☆';
                                return (
                                    <>
                                        <div className="bg-white/5 rounded-xl p-2 text-center">
                                            <p className="text-[9px] text-gray-500">⚽ Goals Expected</p>
                                            <p className="text-sm text-white">{goalsStars}</p>
                                            <p className="text-[9px] text-gray-400">{goalsLabel}</p>
                                        </div>
                                        <div className="bg-white/5 rounded-xl p-2 text-center">
                                            <p className="text-[9px] text-gray-500">🏠 Home Strength</p>
                                            <p className="text-sm text-white">{homeStars}</p>
                                            <p className="text-[9px] text-gray-400">{match.home_win_prob ? Math.round((match.home_win_prob||0)*100) + '%' : '—'}</p>
                                        </div>
                                        <div className="bg-white/5 rounded-xl p-2 text-center">
                                            <p className="text-[9px] text-gray-500">✈ Away Threat</p>
                                            <p className="text-sm text-white">{awayStars}</p>
                                            <p className="text-[9px] text-gray-400">{match.away_win_prob ? Math.round((match.away_win_prob||0)*100) + '%' : '—'}</p>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>
                  </>)}

                    {/* Markets Analysis Grid Layout */}
                    {secondaryTab === 'Prediction' && (
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pb-6">
                        {/* Left Column */}
                        <div className="md:col-span-4 space-y-6">
                            <div className="bg-slate-900/60 border border-white/5 rounded-xl p-5">
                                <div className="flex justify-between items-center mb-5">
                                    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">ALL MARKETS</h3>
                                    <p className="text-[9px] text-gray-600 mt-1 mb-4">Model probabilities — the single source for every pick on this page</p>
                                </div>
                                <div className="space-y-4">
                                    {[
                                        { g: 'Match Result', items: [
                                            { l: 'Home', p: (match.home_win_prob || 0) * 100 },
                                            { l: 'Draw', p: (match.draw_prob || 0) * 100 },
                                            { l: 'Away', p: (match.away_win_prob || 0) * 100 },
                                        ].sort((a: any, b: any) => b.p - a.p) },
                                        { g: 'Goals Over', items: [
                                            { l: 'Over 0.5', p: (match.over05_prob || 0) * 100 },
                                            { l: 'Over 1.5', p: (match.over15_prob || 0) * 100 },
                                            { l: 'Over 2.5', p: (match.over25_prob || 0) * 100 },
                                            { l: 'Over 3.5', p: (match.over35_prob || 0) * 100 },
                                        ].filter((r: any) => r.p > 0).sort((a: any, b: any) => b.p - a.p) },
                                        { g: 'Goals Under', items: [
                                            { l: 'Under 0.5', p: (match.under05_prob || 0) * 100 },
                                            { l: 'Under 1.5', p: (match.under15_prob || 0) * 100 },
                                            { l: 'Under 2.5', p: (match.under25_prob || 0) * 100 },
                                            { l: 'Under 3.5', p: (match.under35_prob || 0) * 100 },
                                            { l: 'Under 4.5', p: (match.under45_prob || 0) * 100 },
                                        ].filter((r: any) => r.p > 0).sort((a: any, b: any) => b.p - a.p) },
                                        { g: 'BTTS', items: [
                                            { l: 'BTTS Yes', p: (match.btts_prob || 0) * 100 },
                                            { l: 'BTTS No', p: (1 - (match.btts_prob || 0)) * 100 },
                                        ].filter((r: any) => r.p > 0) },
                                    ].map((group, gi) => group.items.length > 0 && (
                                        <div key={group.g}>
                                            <span className="text-[10px] text-gray-500 block mb-2">{group.g}</span>
                                            <div className="space-y-2">
                                                {group.items.map((r: any) => (
                                                    <div key={r.l} className="flex items-center gap-3">
                                                        <span className="text-xs text-gray-300 w-16 truncate">{r.l}</span>
                                                        <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                                                            <div className={`h-full ${r.p >= 70 ? 'bg-emerald-500' : r.p >= 50 ? 'bg-vantage-cyan' : 'bg-slate-500'}`} style={{width: `${Math.min(r.p, 100)}%`}}></div>
                                                        </div>
                                                        <span className="text-xs font-mono w-10 text-right">{r.p.toFixed(0)}%</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Middle Column */}
                        <div className="md:col-span-4 space-y-4">
                            <div className="bg-slate-900/60 border border-white/5 rounded-xl p-5 h-full">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-5">TOP MARKETS</h3>
                                <div className="space-y-4">
                                    {(() => {
                                        const topMarkets = [
                                            { l: 'Over 1.5 Goals', p: (match.over15_prob || 0) * 100 },
                                            { l: 'Over 2.5 Goals', p: (match.over25_prob || 0) * 100 },
                                            { l: 'Under 2.5 Goals', p: (match.under25_prob || 0) * 100 },
                                            { l: 'BTTS Yes', p: (match.btts_prob || 0) * 100 },
                                            { l: 'FH Over 0.5', p: (match.fh_over05_prob || 0) * 100 },
                                        ].filter(m => m.p > 0).sort((a, b) => b.p - a.p).slice(0, 2);

                                        if (topMarkets.length === 0) {
                                            return <p className="text-sm text-gray-500">No top markets available.</p>;
                                        }

                                        return topMarkets.map((m, i) => (
                                            <div key={i} className="p-4 rounded-lg bg-vantage-cyan/5 border border-vantage-cyan/20 relative overflow-hidden group hover:bg-vantage-cyan/10 transition-colors">
                                                <div className="flex justify-between items-start mb-3 relative z-10">
                                                    <span className="text-sm font-bold text-white">{m.l}</span>
                                                    {Number(match.odds) > 1 && (
                                                        <span className="text-[10px] font-mono text-gray-400">@{Number(match.odds).toFixed(2)}</span>
                                                    )}
                                                </div>
                                                {/* Honest probability meter with 50% league-baseline marker */}
                                                <div className="relative h-2 rounded-full bg-white/10 mb-1">
                                                    <div
                                                        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500 to-vantage-cyan transition-all duration-700"
                                                        style={{ width: `${Math.min(100, m.p)}%` }}
                                                    />
                                                    <span className="absolute top-1/2 -translate-y-1/2 w-px h-3.5 bg-gray-300/70" style={{ left: '50%' }} />
                                                </div>
                                                <div className="flex items-center justify-between relative z-10 mt-2">
                                                    <div className="flex items-baseline gap-2">
                                                        <span className="text-2xl font-bold font-mono text-emerald-400">{Math.round(m.p)}%</span>
                                                        <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-wide">{m.p >= 80 ? 'Very Strong' : m.p >= 60 ? 'Strong' : 'Moderate'}</span>
                                                    </div>
                                                    <span className="text-[8px] text-gray-500 uppercase">| avg = 50%</span>
                                                </div>
                                            </div>
                                        ));
                                    })()}
                                </div>
                            </div>
                        </div>

                        {/* Right Column */}
                        <div className="md:col-span-4 space-y-6">
                            <div className="bg-slate-900/60 border border-white/5 rounded-xl p-5">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-5">KEY STATS</h3>
                                <div className="space-y-4">
                                    {[
                                        {label: 'Avg. Goals For', home: (match.home_avg_scored ?? match.homeAvgScored ?? 0).toFixed(2), away: (match.away_avg_scored ?? match.awayAvgScored ?? 0).toFixed(2)},
                                        {label: 'Avg. Goals Against', home: (match.home_avg_conceded ?? match.homeAvgConceded ?? 0).toFixed(2), away: (match.away_avg_conceded ?? match.awayAvgConceded ?? 0).toFixed(2)},
                                        {label: 'Shots Per Game', home: matchStats?.stats?.shots?.home || (match as any).home_shots_on_target || 0, away: matchStats?.stats?.shots?.away || (match as any).away_shots_on_target || 0},
                                        {label: 'Possession', home: matchStats?.stats?.possession?.home || (match as any).home_possession || 50, away: matchStats?.stats?.possession?.away || (match as any).away_possession || 50, isPct: true}
                                    ].map(stat => (
                                        <div key={stat.label}>
                                            <div className="flex justify-between text-[10px] mb-1">
                                                <span className="font-mono text-vantage-cyan font-bold">{stat.home}{stat.isPct?'%':''}</span>
                                                <span className="text-gray-500">{stat.label}</span>
                                                <span className="font-mono text-vantage-purple font-bold">{stat.away}{stat.isPct?'%':''}</span>
                                            </div>
                                            <div className="flex h-1.5 bg-white/5 rounded-full overflow-hidden">
                                                <div className="bg-vantage-cyan h-full" style={{width: `${Number(stat.home) / (Number(stat.home) + Number(stat.away) || 1) * 100}%`}}></div>
                                                <div className="bg-vantage-purple h-full" style={{width: `${Number(stat.away) / (Number(stat.home) + Number(stat.away) || 1) * 100}%`}}></div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Bottom Row */}
                        <div className="md:col-span-12 space-y-6">
                            {match.top_scorelines?.length > 0 && (
                                <div>
                                    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">LIKELY SCORELINES</h3>
                                    <div className="flex flex-wrap gap-2 md:gap-3">
                                        {(() => {
                                            const top5 = match.top_scorelines.slice(0, 5);
                                            const rawSum = top5.reduce((s: number, sl: any) => s + ((sl.prob || sl[1] || 0) * 100), 0) || 1;
                                            return top5.map((sl: any, i: number) => {
                                                // Normalize displayed shares so visible scorelines sum to 100
                                                const raw = (sl.prob || sl[1] || 0) * 100;
                                                const prob = (raw / rawSum) * 100;
                                                return (
                                                    <div key={i} onClick={() => setSelectedScoreline(i)} className={`cursor-pointer hover:bg-white/10 active:scale-95 flex-1 min-w-[70px] flex flex-col items-center justify-center p-2 rounded-lg border ${selectedScoreline === i ? 'bg-emerald-900/10 border-emerald-500/30' : 'bg-slate-900/60 border-white/5'} transition-colors`}>
                                                        <span className="text-sm md:text-base font-bold text-white mb-0.5">{sl.score || sl.scoreline || sl[0] || sl}</span>
                                                        <span className={`text-[10px] font-mono ${selectedScoreline === i ? 'text-emerald-400' : 'text-gray-400'}`}>{prob.toFixed(0)}%</span>
                                                    </div>
                                                );
                                            });
                                        })()}
                                    </div>
                                    <p className="text-[9px] text-gray-600 mt-2">Share of the 5 most likely scorelines</p>
                                </div>
                            )}

                            <div className="bg-slate-900/60 border border-white/5 rounded-xl p-5">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div>
                                        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">RECENT FORM</h3>
                                        <div className="flex items-center gap-6">
                                            <div className="flex items-center gap-2">
                                                <TeamLogo src={match.homeTeamLogo} teamName={match.homeTeam} className="w-8 h-8 opacity-80" />
                                                {match.homeForm || match.home_form ? (
                                                    <div className="flex gap-1">
                                                        {(match.homeForm || match.home_form || '').split(' ').slice(0, 5).map((res, i) => (
                                                            <span key={i} className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold ${res === 'W' ? 'bg-emerald-500/20 text-emerald-500' : res === 'L' ? 'bg-rose-500/20 text-rose-500' : 'bg-slate-500/20 text-slate-400'}`}>{res}</span>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <span className="text-[10px] text-gray-600">No form data</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {match.awayForm || match.away_form ? (
                                                    <div className="flex gap-1">
                                                        {(match.awayForm || match.away_form || '').split(' ').slice(0, 5).map((res, i) => (
                                                            <span key={i} className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold ${res === 'W' ? 'bg-emerald-500/20 text-emerald-500' : res === 'L' ? 'bg-rose-500/20 text-rose-500' : 'bg-slate-500/20 text-slate-400'}`}>{res}</span>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <span className="text-[10px] text-gray-600">No form data</span>
                                                )}
                                                <TeamLogo src={match.awayTeamLogo} teamName={match.awayTeam} className="w-8 h-8 opacity-80" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {(match as any).analysis_en && (
                                <div className="bg-slate-900/60 border border-white/5 rounded-xl p-5 flex gap-4 items-start">
                                    <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                                        <Zap size={20} className="text-blue-400" />
                                    </div>
                                    <div>
                                        <h4 className="text-[10px] font-bold uppercase text-emerald-400 tracking-widest mb-2">AI INSIGHT</h4>
                                        <p className="text-xs text-gray-300 leading-relaxed">
                                            {language === 'fr' ? ((match as any).analysis_fr || (match as any).analysis_en) : (match as any).analysis_en}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    )}

                    {/* Scorelines Tab */}
                    {secondaryTab === 'Correct Scores' && match.top_scorelines?.length > 0 && (
                        <div className="pb-6">
                            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">LIKELY SCORELINES</h3>
                            <div className="flex flex-wrap gap-2 md:gap-3">
                                {(() => {
                                    const top5 = match.top_scorelines.slice(0, 5);
                                    const rawSum = top5.reduce((s: number, sl: any) => s + ((sl.prob || sl[1] || 0) * 100), 0) || 1;
                                    return top5.map((sl: any, i: number) => {
                                        // Normalize displayed shares so visible scorelines sum to 100
                                        const raw = (sl.prob || sl[1] || 0) * 100;
                                        const prob = (raw / rawSum) * 100;
                                        return (
                                            <div key={i} onClick={() => setSelectedScoreline(i)} className={`cursor-pointer hover:bg-white/10 active:scale-95 flex-1 min-w-[70px] flex flex-col items-center justify-center p-3 rounded-lg border ${selectedScoreline === i ? 'bg-emerald-900/10 border-emerald-500/30' : 'bg-slate-900/60 border-white/5'} transition-colors`}>
                                                <span className="text-base font-bold text-white mb-0.5">{sl.score || sl.scoreline || sl[0] || sl}</span>
                                                <span className={`text-[10px] font-mono ${selectedScoreline === i ? 'text-emerald-400' : 'text-gray-400'}`}>{prob.toFixed(0)}%</span>
                                            </div>
                                        );
                                    });
                                })()}
                            </div>
                            <p className="text-[9px] text-gray-600 mt-2">Share of the 5 most likely scorelines</p>
                        </div>
                    )}

                    {/* Insights Tab */}
                    {secondaryTab === 'AI Reasons' && (
                        <div className="pb-6 space-y-4">
                            <div className="bg-slate-900/60 border border-white/5 rounded-xl p-5">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">MATCH INSIGHTS</h3>
                                {((match as any).analysis_en) ? (
                                    <p className="text-sm text-gray-300 leading-relaxed">
                                        {language === 'fr' ? ((match as any).analysis_fr || (match as any).analysis_en) : (match as any).analysis_en}
                                    </p>
                                ) : (
                                    <p className="text-sm text-gray-500">No insights available yet.</p>
                                )}
                            </div>
                            {getSmartBadges(match).length > 0 && (
                                <div className="bg-slate-900/60 border border-white/5 rounded-xl p-5">
                                    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">CONTEXTUAL SIGNALS</h3>
                                    <div className="flex flex-wrap gap-2">
                                        {getSmartBadges(match).map((b, i) => (
                                            <span key={i} className={`text-xs font-bold ${b.color} px-2 py-1 rounded bg-white/5`}>
                                                {b.icon} {b.text}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Trends Tab */}
                    {secondaryTab === 'Trends' && (
                        <div className="pb-6 space-y-4">
                            <div className="bg-slate-900/60 border border-white/5 rounded-xl p-5">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">RECENT FORM</h3>
                                <div className="flex items-center gap-6">
                                    <div className="flex items-center gap-2">
                                        <TeamLogo src={match.homeTeamLogo} teamName={match.homeTeam} className="w-8 h-8 opacity-80" />
                                        <div className="flex gap-1">
                                            {(match.homeForm ? match.homeForm.split(' ') : []).map((res, i) => (
                                                <span key={i} className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold ${res === 'W' ? 'bg-emerald-500/20 text-emerald-500' : res === 'L' ? 'bg-rose-500/20 text-rose-500' : res === 'D' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-500/20 text-slate-400'}`}>{res}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="flex gap-1">
                                            {(match.awayForm ? match.awayForm.split(' ') : []).map((res, i) => (
                                                <span key={i} className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold ${res === 'W' ? 'bg-emerald-500/20 text-emerald-500' : res === 'L' ? 'bg-rose-500/20 text-rose-500' : res === 'D' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-500/20 text-slate-400'}`}>{res}</span>
                                            ))}
                                        </div>
                                        <TeamLogo src={match.awayTeamLogo} teamName={match.awayTeam} className="w-8 h-8 opacity-80" />
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                {[
                                    { l: 'Win Rate', h: ((match.home_win_rate ?? 0) || 0).toFixed(0) + '%', a: ((match.away_win_rate ?? 0) || 0).toFixed(0) + '%' },
                                    { l: 'Avg Scored', h: ((match as any).home_avg_scored ?? '-'), a: ((match as any).away_avg_scored ?? '-') },
                                    { l: 'Rest', h: (match.home_days_rest ?? '?') + 'd', a: (match.away_days_rest ?? '?') + 'd' },
                                    { l: 'Injured', h: (match.home_sidelined_count ?? 0) || 0, a: (match.away_sidelined_count ?? 0) || 0 },
                                ].map(row => (
                                    <div key={row.l} className="bg-slate-900/60 border border-white/5 rounded-xl p-3">
                                        <p className="text-[10px] text-gray-500">{row.l}</p>
                                        <div className="flex justify-between text-xs font-mono mt-1">
                                            <span className="text-vantage-cyan"><span className="text-[8px] text-gray-600 mr-1">H</span>{row.h}</span>
                                            <span className="text-vantage-purple"><span className="text-[8px] text-gray-600 mr-1">A</span>{row.a}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Lineup Section */}
                    {secondaryTab === 'Lineup' && (
                        <div className="pb-6">
                            {isLoadingDetails ? (
                                <div className="space-y-2">
                                    {[...Array(6)].map((_, i) => <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />)}
                                </div>
                            ) : !lineup || (lineup.home.length === 0 && lineup.away.length === 0) ? (
                                <div className="rounded-xl border border-dashed border-white/15 px-4 py-10 text-center">
                                    <Users size={24} className="mx-auto text-gray-600 mb-2" />
                                    <p className="text-sm font-semibold text-gray-400">Lineup unavailable</p>
                                    <p className="text-[11px] text-gray-600 mt-1">Published lineups appear here once confirmed.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {(['home', 'away'] as const).map(sideKey => {
                                        const players = sideKey === 'home' ? lineup.home : lineup.away;
                                        const name = sideKey === 'home' ? match.homeTeam : match.awayTeam;
                                        const logo = sideKey === 'home' ? match.homeTeamLogo : match.awayTeamLogo;
                                        const accent = sideKey === 'home' ? 'text-vantage-cyan' : 'text-vantage-purple';
                                        return (
                                            <div key={sideKey} className="bg-slate-900/60 border border-white/5 rounded-xl p-4">
                                                <div className="flex items-center gap-2.5 mb-3">
                                                    <TeamLogo src={logo} teamName={name} className="w-8 h-8" />
                                                    <h3 className={`text-sm font-bold ${accent}`}>{name}</h3>
                                                </div>
                                                {players.length === 0 ? (
                                                    <p className="text-xs text-gray-500 py-3 text-center">Lineup unavailable</p>
                                                ) : (
                                                    <>
                                                        <p className="text-[9px] uppercase tracking-widest text-gray-500 mb-1.5">Starting XI</p>
                                                        <div className="space-y-1 mb-3">
                                                            {players.slice(0, 11).map((p: any, i: number) => (
                                                                <div key={i} className="flex items-center gap-2.5 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                                                                    <span className="w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center text-[9px] font-black font-mono text-gray-300 shrink-0">{p.number ?? '–'}</span>
                                                                    <span className="text-xs font-semibold text-white truncate flex-1">{p.name}</span>
                                                                    {p.position && <span className="text-[9px] font-bold text-gray-500 shrink-0">{p.position}</span>}
                                                                </div>
                                                            ))}
                                                        </div>
                                                        {players.length > 11 && (
                                                            <>
                                                                <p className="text-[9px] uppercase tracking-widest text-gray-500 mb-1.5">Substitutes</p>
                                                                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                                                                    {players.slice(11).map((p: any, i: number) => (
                                                                        <div key={i} className="flex items-center gap-2 text-[10px] text-gray-400">
                                                                            <span className="font-mono text-gray-600 w-4">{p.number ?? '–'}</span>
                                                                            <span className="truncate">{p.name}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* H2H Section */}
                    {secondaryTab === 'H2H' && (
                        <div className="pb-6">
                            {!realH2H ? (
                                <div className="rounded-xl border border-dashed border-white/15 px-4 py-10 text-center">
                                    <Scale size={22} className="mx-auto text-gray-600 mb-2" />
                                    <p className="text-sm font-semibold text-gray-400">Head-to-head unavailable</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-3 gap-3">
                                        <GlassCard className="p-3 text-center"><p className="text-xl font-black font-mono text-vantage-cyan">{realH2H.homeTeamWins}</p><p className="text-[9px] text-gray-500 uppercase">Home wins</p></GlassCard>
                                        <GlassCard className="p-3 text-center"><p className="text-xl font-black font-mono text-gray-300">{realH2H.draws}</p><p className="text-[9px] text-gray-500 uppercase">Draws</p></GlassCard>
                                        <GlassCard className="p-3 text-center"><p className="text-xl font-black font-mono text-vantage-purple">{realH2H.awayTeamWins}</p><p className="text-[9px] text-gray-500 uppercase">Away wins</p></GlassCard>
                                    </div>
                                    {realH2H.last5Goals && (
                                        <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4">
                                            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Last 5 Results</h3>
                                            <div className="flex flex-wrap gap-2">
                                                {realH2H.last5Goals.split(',').map((s, i) => (
                                                    <span key={i} className="px-3 py-1.5 rounded-lg bg-white/5 text-xs font-mono font-bold text-gray-200">{s.trim()}</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Team detail bottom sheet (crest tap) */}
            {match && (
                <TeamDetailSheet
                    open={detailSheet !== null}
                    onClose={() => setDetailSheet(null)}
                    teamName={detailSheet === 'home' ? (match.homeTeam || match.home_team || '') : (match.awayTeam || match.away_team || '')}
                    side={detailSheet ?? 'home'}
                    teamLogo={detailSheet === 'home' ? match.homeTeamLogo : match.awayTeamLogo}
                    fixtureId={match.fixtureId || match.fixture_id}
                />
            )}
        </div>
    );
};

export default MatchDetails;

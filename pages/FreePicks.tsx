
import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, Clock, Target, Loader2, Copy, Check, Lock, Zap,
  BarChart3, Shield, Activity, Flame, ChevronRight, Eye, EyeOff,
  ArrowRight, Star, Brain, Crown, ChevronDown, AlertCircle, Share2
} from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { useAppContext } from '../context/AppContext';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { TeamLogo } from '../components/TeamLogo';
import { NavigationTab, Match } from '../types';
import { getAppSettings } from '../services/db';

interface FreePicksProps {}

// ── Form indicator dots ─────────────────────────────────────────────────────
const FormDots = ({ form }: { form: string }) => {
  if (!form || form === 'N/A') return null;
  const results = form.split(' ').slice(0, 5);
  return (
    <div className="flex items-center gap-0.5">
      {results.map((r, i) => (
        <span key={i} className={`w-2.5 h-2.5 rounded-full flex items-center justify-center text-[6px] font-black text-white
          ${r === 'W' ? 'bg-emerald-500' : r === 'D' ? 'bg-amber-400' : 'bg-rose-500'}`}>
          {r}
        </span>
      ))}
    </div>
  );
};

// ── Mini stat pill ──────────────────────────────────────────────────────────
const StatPill = ({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) => (
  <div className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg bg-black/5 dark:bg-white/5">
    {icon}
    <span className="text-[10px] font-bold font-mono text-slate-700 dark:text-white">{value}</span>
    <span className="text-[8px] text-gray-500 uppercase tracking-wider">{label}</span>
  </div>
);

const getCountdownToNextPicks = (scheduleTime = '19:00') => {
  const now = new Date();
  const lagosNow = new Date(now.toLocaleString('en', { timeZone: 'Africa/Lagos' }));
  const [targetHour, targetMinute] = scheduleTime.split(':').map(Number);
  const next = new Date(lagosNow);
  next.setHours(Number.isFinite(targetHour) ? targetHour : 19, Number.isFinite(targetMinute) ? targetMinute : 0, 0, 0);
  if (lagosNow.getTime() >= next.getTime()) next.setDate(next.getDate() + 1);
  const diff = next.getTime() - lagosNow.getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return { h, m, total: diff };
};



export const FreePicks: React.FC<FreePicksProps> = () => {
  const navigate = useNavigate();
  const { t, language } = useAppContext();
  const { predictions, loading } = useData();
  const { userProfile, isAdmin } = useAuth();
  const isVip = userProfile?.isVip || isAdmin;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showAllLeans, setShowAllLeans] = useState(false);
  const [freePicksCount, setFreePicksCount] = useState(3);
  const [scheduledTime, setScheduledTime] = useState('19:00');
  const [countdown, setCountdown] = useState(getCountdownToNextPicks('19:00'));

  React.useEffect(() => {
    setCountdown(getCountdownToNextPicks(scheduledTime));
    const timer = setInterval(() => setCountdown(getCountdownToNextPicks(scheduledTime)), 60000);
    return () => clearInterval(timer);
  }, [scheduledTime]);

  React.useEffect(() => {
    getAppSettings().then(s => {
      if (s.freePicksCount !== undefined) setFreePicksCount(s.freePicksCount);
      if (s.footballGenTime) setScheduledTime(s.footballGenTime);
    });
  }, []);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    if (navigator.vibrate) navigator.vibrate(50);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const getPredictionText = (match: any) => {
    if (language === 'fr') return match.prediction_fr || match.prediction;
    return match.prediction_en || match.prediction;
  };

  // ── Categorize matches into tiers ─────────────────────────────────────
  const { hookPicks, vipTeasers, dataCards, leagueBreakdown } = useMemo(() => {
    const rankPriority: Record<string, number> = { high: 4, medium: 3, low: 2, none: 1 };
    const sorted = [...predictions].sort((a, b) => {
      const rankDiff = (rankPriority[b.value_rank] || 0) - (rankPriority[a.value_rank] || 0);
      if (rankDiff !== 0) return rankDiff;
      return (b.confidence || 0) - (a.confidence || 0);
    });

    // Top-tier picks: safe category only (value bets go to vault)
    const topPicks = sorted.filter(m => m.category === 'safe');

    // Hook: dynamic free picks based on admin setting
    const hook = topPicks.slice(0, freePicksCount);
    // VIP Teasers: next up to 8 picks (blurred)
    const teasers = topPicks.slice(freePicksCount, freePicksCount + 8);
    // Data cards: everything else
    const teaseIds = new Set([...hook, ...teasers].map(m => m.id));
    const data = sorted.filter(m => !teaseIds.has(m.id));

    // League breakdown for FOMO
    const leagues: Record<string, number> = {};
    sorted.forEach(m => {
      const l = m.league || 'Other';
      leagues[l] = (leagues[l] || 0) + 1;
    });

    return { hookPicks: hook, vipTeasers: teasers, dataCards: data, leagueBreakdown: leagues };
  }, [predictions, freePicksCount]);

  const totalAnalyzed = predictions.length;
  const topLeagues = Object.entries(leagueBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const scheduledTimeDisplay = (() => {
    const [h, m] = scheduledTime.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${String(h12).padStart(2, '0')}:${String(m || 0).padStart(2, '0')} ${period}`;
  })();

  const renderRichMatchCard = (match: any, idx: number, blurred: boolean = false) => {
    const pred = getPredictionText(match);
    const xgH = match.expected_goals_home ?? 0;
    const xgA = match.expected_goals_away ?? 0;
    const homeWinProb = Math.round((match.home_win_prob || 0) * 100);
    const drawProb = Math.round((match.draw_prob || 0) * 100);
    const awayWinProb = Math.round((match.away_win_prob || 0) * 100);
    const confidence = match.confidence || 0;

    return (
      <motion.div
        key={match.id}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: idx * 0.05, duration: 0.3 }}
        onClick={() => navigate(`/match/${match.id}`)}
        className="cursor-pointer"
      >
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-[#1a1d26] backdrop-blur-md shadow-lg hover:border-vantage-cyan/40 transition-colors">

          {/* ── Header row: league + time ── */}
          <div className="flex justify-between items-center px-4 pt-3.5 pb-2">
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
              <Target size={10} className="text-vantage-cyan" />
              <span className="truncate max-w-[120px]">{match.league}</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-md">
                <Clock size={10} /> {match.time || match.kickoff_local}
              </span>
              {!blurred && (
                <>
                  <button
                    onClick={() => {
                      const shareText = `🎯 ${match.homeTeam || match.home_team} vs ${match.awayTeam || match.away_team}\n⚡ Pick: ${pred}\n📊 Confidence: ${confidence}%\n\nVantage AI • vantage.app`;
                      if (navigator.share) {
                        navigator.share({ text: shareText, title: 'Vantage AI Pick' });
                      } else {
                        navigator.clipboard.writeText(shareText);
                        const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
                        window.open(whatsappUrl, '_blank');
                      }
                    }}
                    className="p-1.5 rounded-md bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors text-gray-400 hover:text-vantage-cyan"
                  >
                    <Share2 size={11} />
                  </button>
                  <button
                    onClick={() => handleCopy(`${match.homeTeam || match.home_team} vs ${match.awayTeam || match.away_team} — ${pred} (${confidence}%)`, match.id)}
                    className="p-1.5 rounded-md bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors text-gray-400 hover:text-vantage-cyan"
                  >
                    {copiedId === match.id ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ── Teams row ── */}
          <div className="flex justify-between items-center px-4 py-3">
            <div className="flex items-center gap-2.5 w-5/12 min-w-0">
              <div className="w-10 h-10 shrink-0 rounded-xl bg-slate-100 dark:bg-white/8 flex items-center justify-center border border-slate-200 dark:border-white/8 p-1.5">
                <TeamLogo src={match.homeTeamLogo || match.home_team_logo} teamName={match.homeTeam || match.home_team} className="w-full h-full" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{match.homeTeam || match.home_team}</span>
                <FormDots form={match.homeForm || match.home_form} />
              </div>
            </div>
            <div className="flex flex-col items-center shrink-0 px-2">
              <span className="text-[10px] font-black font-mono text-gray-300 dark:text-gray-600">VS</span>
              {xgH > 0 && (
                <span className="text-[9px] font-bold font-mono text-vantage-cyan mt-0.5">{xgH.toFixed(1)} - {xgA.toFixed(1)}</span>
              )}
            </div>
            <div className="flex items-center gap-2.5 w-5/12 min-w-0 flex-row-reverse">
              <div className="w-10 h-10 shrink-0 rounded-xl bg-slate-100 dark:bg-white/8 flex items-center justify-center border border-slate-200 dark:border-white/8 p-1.5">
                <TeamLogo src={match.awayTeamLogo || match.away_team_logo} teamName={match.awayTeam || match.away_team} className="w-full h-full" />
              </div>
              <div className="flex flex-col items-end min-w-0">
                <span className="text-sm font-bold text-slate-900 dark:text-white truncate text-right">{match.awayTeam || match.away_team}</span>
                <FormDots form={match.awayForm || match.away_form} />
              </div>
            </div>
          </div>

          {/* ── Match stats row — hidden for blurred (teaser) cards ── */}
          {!blurred && (
            <div className="px-4 pb-2">
              <div className="flex justify-center gap-1.5 flex-wrap">
                {homeWinProb > 0 && (
                  <>
                    <StatPill label="Home" value={`${homeWinProb}%`} />
                    <StatPill label="Draw" value={`${drawProb}%`} />
                    <StatPill label="Away" value={`${awayWinProb}%`} />
                  </>
                )}
                {match.over25_prob > 0 && (
                  <StatPill label="O2.5" value={`${Math.round(match.over25_prob * 100)}%`} />
                )}
                {match.btts_prob > 0 && (
                  <StatPill label="BTTS" value={`${Math.round(match.btts_prob * 100)}%`} />
                )}
              </div>
            </div>
          )}

          {/* ── Prediction section ── */}
          <div className="relative mx-4 mb-4 p-3 bg-slate-50 dark:bg-black/30 rounded-xl border border-slate-200 dark:border-white/5 overflow-hidden">
            {blurred ? (
              /* ── SOFTER FOMO: UNLOCK BADGE INSTEAD OF BLUR ── */
              <div className="flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wide">{t('free.pred_label')}</span>
                  <button
                    onClick={() => navigate('/vip')}
                    className="mt-1 px-3 py-1.5 bg-vantage-purple/10 hover:bg-vantage-purple/20 border border-vantage-purple/30 text-vantage-purple text-xs font-bold rounded-full transition-all flex items-center gap-1.5"
                  >
                    <Lock size={10} />
                    {language === 'fr' ? 'Débloquer' : 'Unlock'}
                  </button>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wide">{t('free.prob_label')}</span>
                  <span className="text-lg font-bold font-mono text-gray-300 mt-1">—</span>
                </div>
              </div>
            ) : (
              /* ── VISIBLE PREDICTION ── */
              <>
                <div className="flex justify-between items-center relative z-10">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wide">{t('free.pred_label')}</span>
                    <span className="text-sm font-bold text-vantage-cyan font-mono">{pred}</span>
                  </div>
                  <div className="h-8 w-px bg-slate-300 dark:bg-white/10 mx-2" />
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wide">{t('free.prob_label')}</span>
                    <div className="flex items-center text-sm font-bold font-mono text-green-500 dark:text-green-400">
                      <TrendingUp size={14} className="mr-1" />
                      {confidence}%
                    </div>
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-vantage-cyan to-green-400" style={{ width: `${confidence}%` }} />
              </>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  // ── VIP Intelligence Report Card (replaces "Other Analyzed Matches") ──────
  const renderVipConversionWall = () => {
    if (dataCards.length === 0 || isVip) return null;

    const hiddenCount = dataCards.length;

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl border border-vantage-purple/30 bg-gradient-to-b from-vantage-purple/5 to-black/20 dark:to-[#0a0c14] overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-vantage-purple/20 flex items-center justify-center">
                <Brain size={16} className="text-vantage-purple" />
              </div>
              <div>
                <p className="text-xs font-black text-white uppercase tracking-widest">
                  {language === 'fr' ? 'Rapport Intelligence IA' : 'AI Intelligence Report'}
                </p>
                <p className="text-[10px] text-gray-500">
                  {language === 'fr' ? 'Accès Alpha requis' : 'Alpha Access Required'}
                </p>
              </div>
            </div>
            <span className="flex items-center gap-1 text-xs font-black text-vantage-purple bg-vantage-purple/15 border border-vantage-purple/30 px-2.5 py-1 rounded-full">
              <Lock size={10} />
              {hiddenCount} {language === 'fr' ? 'cachés' : 'hidden'}
            </span>
          </div>
        </div>

        {/* Teaser stats */}
        <div className="px-5 py-4 space-y-3">

          {/* Match count + single-line upgrade CTA */}
          <div className="p-3 rounded-xl bg-white/5 border border-white/5">
            <p className="text-[10px] text-gray-500 mb-1">
              {language === 'fr'
                ? `Voir ce que l'IA a choisi — accès dès 1000 FCFA/semaine`
                : `See what the model picked — 7-day access from 1000 FCFA`}
            </p>
            <div className="text-[10px] text-vantage-purple font-bold mt-1">
              {language === 'fr' ? `${totalAnalyzed} matchs analysés` : `${totalAnalyzed} matches analyzed today`}
            </div>
          </div>
        </div>

        {/* CTA Button */}
        {/* @ts-ignore */}
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/vip')}
          className="w-full mx-0 px-5 py-4 flex items-center justify-between group"
          style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 50%, #06b6d4 100%)' }}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg shrink-0">
              <Crown size={16} className="text-yellow-300 fill-yellow-300" />
            </div>
            <div className="text-left">
              <div className="text-sm font-black text-white tracking-wide">
                {language === 'fr' ? `Débloquer les ${hiddenCount} analyses` : `Unlock all ${hiddenCount} analyses`}
              </div>
              <div className="text-[10px] text-white/70">
                {language === 'fr' ? 'Dès 2000 FCFA/semaine • Actif instantanément' : 'From 2000 FCFA/week • Active instantly'}
              </div>
            </div>
          </div>
          <ArrowRight size={20} className="text-white shrink-0 group-hover:translate-x-1 transition-transform" />
        </motion.button>
      </motion.div>
    );
  };

  return (
    <div className="space-y-6 pb-24">

      {/* ── Header with match count ── */}
      <div className="flex flex-col space-y-2">
        <h1 className="text-2xl font-bold font-orbitron text-slate-900 dark:text-white mb-2">
          {language === 'fr' ? 'Analyse' : 'Match'} <span className="text-vantage-cyan">{language === 'fr' ? 'des Matchs' : 'Analysis'}</span>
        </h1>

        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-500 shrink-0">
              <Target size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                {language === 'fr' ? 'Votre action gratuite' : 'Your free action'}
              </p>
              <p className="text-sm font-black text-slate-900 dark:text-white">
                {predictions.length > 0
                  ? (language === 'fr' ? `${Math.min(freePicksCount, hookPicks.length)} picks ouverts aujourd'hui` : `${Math.min(freePicksCount, hookPicks.length)} picks unlocked today`)
                  : (language === 'fr' ? `Prochains picks à ${scheduledTime}` : `Next picks at ${scheduledTimeDisplay}`)}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {predictions.length > 0
                  ? (language === 'fr' ? 'Copiez un pick, puis consultez le VIP pour le staking Kelly.' : 'Copy one pick, then use VIP for Kelly staking.')
                  : (language === 'fr' ? `Revenez dans ${countdown.h}h ${countdown.m}m.` : `Come back in ${countdown.h}h ${countdown.m}m.`)}
              </p>
            </div>
            {!isVip && predictions.length > 0 && (
              <button
                onClick={() => navigate('/vip')}
                className="shrink-0 px-3 py-2 rounded-xl bg-vantage-purple text-white text-xs font-black"
              >
                {language === 'fr' ? 'VIP' : 'Unlock'}
              </button>
            )}
          </div>
        </div>

        {/* Live match count banner */}
        {!loading && totalAnalyzed > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10"
          >
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold text-slate-700 dark:text-gray-300">
                <span className="text-vantage-cyan font-black">{totalAnalyzed}</span>
                {language === 'fr' ? ' matchs analysés par notre IA' : ' matches analyzed by AI today'}
              </span>
            </div>
            {!isVip && (
              <button onClick={() => navigate('/vip')} className="flex items-center gap-1 text-[10px] font-bold text-vantage-purple hover:text-purple-400 transition-colors">
                <Lock size={9} />
                {language === 'fr' ? 'Voir tout' : 'View all'}
                <ChevronRight size={10} />
              </button>
            )}
          </motion.div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-10">
          <Loader2 className="animate-spin text-vantage-cyan" size={40} />
        </div>
      ) : predictions.length === 0 ? (
        <div className="text-center py-10">
          <Activity size={28} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
          <p className="text-gray-500 mb-2">{language === 'fr' ? "Aucune analyse disponible" : "No analysis available yet"}</p>
          <p className="text-xs text-vantage-cyan font-medium italic">{language === 'fr' ? `Pronostics publiés à ${scheduledTime}. Revenez dans ${countdown.h}h ${countdown.m}m.` : `Match analysis publishes at ${scheduledTimeDisplay}. Come back in ${countdown.h}h ${countdown.m}m.`}</p>
        </div>
      ) : (
        <div className="space-y-6">

          {/* ── SECTION 1: THE HOOK (Free Top Picks) ── */}
          {hookPicks.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <Star size={14} className="fill-emerald-500 text-emerald-500" />
                  {language === 'fr' ? "Picks Gratuits du Jour" : "Today's Free Picks"}
                </h2>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 font-bold">FREE</span>
              </div>
              {hookPicks.map((match, idx) => renderRichMatchCard(match, idx, false))}
            </div>
          )}

          {/* ── SECTION 2: VIP TEASERS (Blurred for non-VIP) ── */}
          {vipTeasers.length > 0 && !isVip && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Lock size={12} className="text-vantage-purple" />
                <h2 className="text-sm font-bold uppercase tracking-widest text-vantage-purple flex items-center gap-1.5">
                  {language === 'fr' ? 'Signaux Alpha' : 'Alpha Signals'}
                </h2>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-vantage-purple/15 border border-vantage-purple/30 text-vantage-purple font-bold">
                  {vipTeasers.length} PICKS
                </span>
              </div>
              {vipTeasers.map((match, idx) => renderRichMatchCard(match, idx + 2, true))}

              {/* CTA after teasers */}
              {/* @ts-ignore */}
              <motion.button
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                onClick={() => navigate('/vip')}
                className="w-full py-4 px-5 rounded-2xl flex items-center justify-between group shadow-xl shadow-vantage-purple/20 relative overflow-hidden"
                style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 50%, #06b6d4 100%)' }}
              >
                <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative flex items-center gap-3">
                  <div className="p-2 bg-white/20 rounded-lg shrink-0">
                    <Zap size={18} className="text-yellow-300 fill-yellow-300" />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-black text-white tracking-wide">
                      {language === 'fr' ? `Débloquer ${vipTeasers.length} Signaux Alpha` : `Unlock ${vipTeasers.length} Alpha Signals`}
                    </div>
                    <div className="text-[10px] text-white/70 font-medium">
                      {language === 'fr' ? 'Analyse complète + Kelly Staking' : 'Full analysis + Kelly Staking'}
                    </div>
                  </div>
                </div>
                <ArrowRight size={20} className="relative text-white shrink-0 group-hover:translate-x-1 transition-transform" />
              </motion.button>
            </div>
          )}

          {/* VIP: show all teasers unblurred */}
          {vipTeasers.length > 0 && isVip && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Shield size={12} className="text-emerald-500" />
                <h2 className="text-sm font-bold uppercase tracking-widest text-slate-600 dark:text-gray-300">
                  {language === 'fr' ? 'Tous les Picks' : 'All Value Picks'}
                </h2>
              </div>
              {vipTeasers.map((match, idx) => renderRichMatchCard(match, idx + 2, false))}
            </div>
          )}

          {/* ── SECTION 3: VIP Intelligence Report (non-VIP) or full data cards (VIP) ── */}
          {isVip && dataCards.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 size={12} className="text-slate-500" />
                <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">
                  {language === 'fr' ? 'Leans du Marché' : 'Market Leans'}
                </h2>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-500/15 border border-slate-500/30 text-slate-500 font-bold">{dataCards.length}</span>
              </div>
              {(showAllLeans ? dataCards : dataCards.slice(0, 10)).map((match, idx) => renderRichMatchCard(match, idx + 10, false))}
              {dataCards.length > 10 && !showAllLeans && (
                <button
                  onClick={() => setShowAllLeans(true)}
                  className="w-full py-3 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-bold text-gray-500 hover:text-vantage-cyan transition-colors flex items-center justify-center gap-1.5"
                >
                  <ChevronDown size={14} />
                  {language === 'fr' ? `Voir ${dataCards.length - 10} autres` : `Show ${dataCards.length - 10} more`}
                </button>
              )}
            </div>
          ) : (
            renderVipConversionWall()
          )}
        </div>
      )}

      <div className="text-center">
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('free.disclaimer')}</p>
      </div>
    </div>
  );
};

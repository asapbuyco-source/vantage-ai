import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Zap, Activity, ArrowRight, Lock, Globe, Clock, Calendar, Sun, Moon,
  Trophy, AlertTriangle, Hourglass, Search, SlidersHorizontal, ChevronDown,
  Flame, TrendingUp, ChevronRight, Shield, BarChart3, Copy, Check, Share2, Target
} from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { CircularProgress } from '../components/CircularProgress';
import { AnalyzingLoader } from '../components/AnalyzingLoader';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { NavigationTab, Match, Sport } from '../types';
import { TeamLogo } from '../components/TeamLogo';
import { getAppSettings } from '../services/db';
import { TicketWizard } from '../components/TicketWizard';
import { MotionDiv } from '../components/MotionDiv';
import { getTopProbPicks, getPrimaryPredictionText, getPrimaryPredictionProb, getTopPickText } from '../utils';
import { db } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';

interface HomeProps {}

type SortKey = 'probability' | 'time' | 'league';

const CATEGORY_CONFIG = {
  safe: { label: 'SAFE', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  value: { label: 'VALUE', bg: 'bg-amber-500/15', border: 'border-amber-500/30', text: 'text-amber-400', dot: 'bg-amber-400' },
  risky: { label: 'RISKY', bg: 'bg-rose-500/15', border: 'border-rose-500/30', text: 'text-rose-400', dot: 'bg-rose-400' },
  lean: { label: 'LEAN', bg: 'bg-slate-500/15', border: 'border-slate-500/30', text: 'text-slate-400', dot: 'bg-slate-400' },
  no_edge: { label: 'DATA', bg: 'bg-gray-500/15', border: 'border-gray-500/30', text: 'text-gray-400', dot: 'bg-gray-400' },
};

const TOP_LEAGUES = [
  'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1',
  'Champions League', 'Europa League', 'World Cup', 'Euro', 'Copa America'
];

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

function getLeagueTier(match: Match): number {
  if (match.league_tier !== undefined && match.league_tier > 0) return match.league_tier;
  const leagueName = match.league || '';
  for (let i = 0; i < TOP_LEAGUES.length; i++) {
    if (leagueName.includes(TOP_LEAGUES[i])) return 1;
  }
  return 99;
}

const FormDots = ({ form }: { form?: string }) => {
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

export const Home: React.FC<HomeProps> = () => {
  const navigate = useNavigate();
  const { t, language, setLanguage, theme, toggleTheme, showToast } = useAppContext();
  const { user, userProfile, isAdmin } = useAuth();
  const {
    activeDate, predictions, rawFixtures, basketballPredictions, cricketPredictions,
    winRateStats, loading, isSystemGenerating, systemError
  } = useData();

  const isVip = userProfile?.isVip || isAdmin;

  // Load the scheduled football gen time from Firestore settings (for display only)
  const [scheduledTime, setScheduledTime] = useState('19:00');
  const [freePicksCount, setFreePicksCount] = useState(3);
  const [countdown, setCountdown] = useState(getCountdownToNextPicks('19:00'));
  useEffect(() => {
    setCountdown(getCountdownToNextPicks(scheduledTime));
    const timer = setInterval(() => setCountdown(getCountdownToNextPicks(scheduledTime)), 60000);
    return () => clearInterval(timer);
  }, [scheduledTime]);
  const [visibleCount, setVisibleCount] = useState(15);
  const [showTicket, setShowTicket] = useState(false);
  const [ticketPicks, setTicketPicks] = useState<Array<{ id: string; home: string; away: string; pick: string; odds: number }>>([]);
  useEffect(() => {
    getAppSettings().then(s => {
      if (s.footballGenTime) setScheduledTime(s.footballGenTime);
      if (s.freePicksCount !== undefined) setFreePicksCount(s.freePicksCount);
    }).catch(() => { }); // silently fail — display is non-critical
  }, []);

  // Format for display: '08:30' -> '08:30 AM'
  const scheduledTimeDisplay = (() => {
    const [h, m] = scheduledTime.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
  })();

  // ─── Filters ─────────────────────────────────────────────────────────────
  const [activeSport, setActiveSport] = useState<Sport>('football');
  const [sortKey, setSortKey] = useState<SortKey>('probability');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // BUG-11 FIX: Reset visibleCount when switching sports to prevent stale offset
  useEffect(() => { setVisibleCount(15); }, [activeSport]);


  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    if (navigator.vibrate) navigator.vibrate(50);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleShare = async (match: Match) => {
    const pred = getPrimaryPredictionText(match, language);
    const text = `🎯 ${match.homeTeam} vs ${match.awayTeam}\n⚡ Pick: ${pred}${match.odds && match.odds > 1 ? ` @ ${Number(match.odds).toFixed(2)}` : ''}\n📊 Confidence: ${match.confidence || 0}%\n\n📱 Vantage AI — Data-driven picks`;
    try {
      if (navigator.share) {
        await navigator.share({ text, title: 'Vantage AI Pick' });
      } else {
        await navigator.clipboard.writeText(text);
        showToast(language === 'fr' ? 'Pick copié !' : 'Pick copied!', 'success');
      }
    } catch (e) { /* user cancelled */ }
  };

  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [bankerSummary, setBankerSummary] = useState<any>(null);
  const [todayBanker, setTodayBanker] = useState<any>(null);

  // Fetch Banker of the Day
  useEffect(() => {
    const todayKey = activeDate || new Date().toISOString().split('T')[0];
    Promise.all([
      getDoc(doc(db, 'banker_summary', 'current')),
      getDoc(doc(db, 'banker_picks', todayKey)),
    ]).then(([summarySnap, todaySnap]) => {
      if (summarySnap.exists()) setBankerSummary(summarySnap.data());
      if (todaySnap.exists()) setTodayBanker(todaySnap.data());
    }).catch(() => {});
  }, [activeDate]);

  // predictions = AI-analyzed matches with full data (prediction_en, confidence, analysis_en) — shown first
  // rawFixtures = raw API fixtures with no AI analysis — only shown as a fallback if predictions are empty
  const fixturePool = activeSport === 'football'
    ? (predictions.length > 0 ? predictions : rawFixtures)
    : activeSport === 'basketball'
      ? basketballPredictions
      : cricketPredictions;

  const freeMatchIds = useMemo(() => {
    const sorted = [...predictions].sort((a, b) => {
      const probA = getPrimaryPredictionProb(a);
      const probB = getPrimaryPredictionProb(b);
      return probB - probA;
    });
    const topPicks = sorted.filter(m => m.category === 'safe');
    return new Set(topPicks.slice(0, freePicksCount).map(m => m.id));
  }, [predictions, freePicksCount]);

  const filteredMatches = useMemo(() => {
    let result = [...fixturePool];

    // Filter out matches that have already started if we are viewing today
    const now = new Date();
    let isToday = true;
    if (activeDate) {
      const [y, m, d] = activeDate.split('-').map(Number);
      isToday = y === now.getFullYear() && (m - 1) === now.getMonth() && d === now.getDate();
    }

    if (isToday) {
      result = result.filter(match => match.status !== 'void');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(m =>
        m.homeTeam.toLowerCase().includes(q) ||
        m.awayTeam.toLowerCase().includes(q) ||
        m.league.toLowerCase().includes(q)
      );
    }
    const categoryPriority: Record<string, number> = { safe: 4, value: 3, risky: 2, lean: 1 };

    switch (sortKey) {
      case 'probability':
        result.sort((a, b) => {
          const probA = getPrimaryPredictionProb(a);
          const probB = getPrimaryPredictionProb(b);
          if (probA !== probB) return probB - probA;
          return (categoryPriority[b.category] || 0) - (categoryPriority[a.category] || 0);
        });
        break;
      case 'time': 
        result.sort((a, b) => {
          const timeCompare = a.time.localeCompare(b.time);
          if (timeCompare !== 0) return timeCompare;
          return (categoryPriority[b.category] || 0) - (categoryPriority[a.category] || 0);
        }); 
        break;
      case 'league': 
        result.sort((a, b) => {
          const tierA = getLeagueTier(a);
          const tierB = getLeagueTier(b);
          if (tierA !== tierB) return tierA - tierB;
          const leagueCompare = a.league.localeCompare(b.league);
          if (leagueCompare !== 0) return leagueCompare;
          const timeCompare = a.time.localeCompare(b.time);
          if (timeCompare !== 0) return timeCompare;
          return (categoryPriority[b.category] || 0) - (categoryPriority[a.category] || 0);
        }); 
        break;
    }
    // Push free picks to the top for non-VIP users
    if (!isVip && freeMatchIds.size > 0) {
      result.sort((a, b) => {
        const aFree = freeMatchIds.has(a.id) ? 0 : 1;
        const bFree = freeMatchIds.has(b.id) ? 0 : 1;
        return aFree - bFree;
      });
    }
    return result;
  }, [fixturePool, searchQuery, sortKey, isVip, freeMatchIds]);

  const groupedMatches = useMemo(() => {
    if (sortKey !== 'league') return { 'All Matches': filteredMatches };
    const groups: Record<string, Match[]> = {};
    filteredMatches.forEach(p => {
      if (!groups[p.league]) groups[p.league] = [];
      groups[p.league].push(p);
    });
    return groups;
  }, [filteredMatches, sortKey]);

  const [year, month, day] = activeDate ? activeDate.split('-').map(Number) : [];
  const displayDateObj = activeDate ? new Date(year, month - 1, day) : new Date();

  const todayDisplay = displayDateObj.toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'short', day: 'numeric', month: 'short'
  });

  const topPick = useMemo(() => {
    const ranked = [...predictions].sort((a, b) => {
      const probA = getPrimaryPredictionProb(a);
      const probB = getPrimaryPredictionProb(b);
      return probB - probA;
    });
    return ranked[0];
  }, [predictions]);

  const sortLabels: Record<SortKey, string> = {
    probability: language === 'fr' ? 'Probabilité' : 'Probability',
    time: language === 'fr' ? 'Heure' : 'Time',
    league: language === 'fr' ? 'Ligue' : 'League',
  };

  if (isSystemGenerating) return <AnalyzingLoader />;

  return (
    <div className="space-y-5 pb-32">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-orbitron text-slate-900 dark:text-white">
            VANTAGE<span className="text-vantage-cyan">AI</span>
          </h1>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 tracking-widest">{t('home.system')}</p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setLanguage(language === 'fr' ? 'en' : 'fr')}
            className="flex items-center space-x-1 bg-slate-100 dark:bg-white/5 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
          >
            <Globe size={12} className="text-slate-500 dark:text-gray-400" />
            <span className="text-[10px] font-bold font-orbitron text-slate-700 dark:text-gray-300 w-4 text-center">
              {language.toUpperCase()}
            </span>
          </button>
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center bg-slate-100 dark:bg-white/5 w-8 h-7 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
          >
            {theme === 'dark' ? <Sun size={14} className="text-yellow-500" /> : <Moon size={14} className="text-slate-600" />}
          </button>
          {/* Live status dot */}
          <div className={`flex items-center justify-center w-8 h-7 rounded-lg border ${isSystemGenerating ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-vantage-cyan/10 border-vantage-cyan/20'}`}>
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isSystemGenerating ? 'bg-yellow-500' : 'bg-vantage-cyan'}`} />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isSystemGenerating ? 'bg-yellow-500' : 'bg-vantage-cyan'}`} />
            </span>
          </div>
        </div>
      </div>

      {/* Rolling Results Ticker */}
      {predictions.some(m => m.status === 'won' || m.status === 'lost') && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/5">
          {(() => {
            const graded = predictions.filter(m => m.status === 'won' || m.status === 'lost');
            const won = graded.filter(m => m.status === 'won').length;
            const lost = graded.filter(m => m.status === 'lost').length;
            const total = won + lost;
            const rate = total > 0 ? Math.round((won / total) * 100) : 0;
            const sorted = [...graded].sort((a, b) => (b.time || '').localeCompare(a.time || ''));
            let streak = 0;
            for (const m of sorted) {
              if (m.status === 'won') streak++;
              else break;
            }
            return (
              <>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-black font-mono text-green-500">{won}W</span>
                  <span className="text-[10px] text-gray-600">-</span>
                  <span className="text-[10px] font-black font-mono text-red-400">{lost}L</span>
                </div>
                <div className="h-3 w-px bg-white/10" />
                <span className={`text-[10px] font-black font-mono ${rate >= 60 ? 'text-green-500' : 'text-amber-400'}`}>
                  {rate}% today
                </span>
                {streak >= 3 && (
                  <span className="text-[10px] font-black text-orange-500 animate-pulse flex items-center gap-0.5">
                    🔥 {streak} streak
                  </span>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* ── Banker of the Day ── */}
      {(todayBanker || bankerSummary) && (
        <div className="rounded-2xl bg-gradient-to-r from-amber-500/10 to-yellow-500/5 border border-amber-500/30 p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="shrink-0 w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
              <Trophy size={18} className="text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-bold text-amber-500 uppercase tracking-widest">
                {language === 'fr' ? 'Banker du Jour' : 'Banker of the Day'}
              </p>
              {todayBanker?.pick ? (
                <>
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {todayBanker.pick.home_team} vs {todayBanker.pick.away_team}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {todayBanker.pick.market} · {(todayBanker.pick.probability * 100).toFixed(0)}% confidence
                  </p>
                </>
              ) : (
                <p className="text-sm font-bold text-slate-900 dark:text-white">
                  {language === 'fr' ? 'En attente...' : 'Coming soon...'}
                </p>
              )}
            </div>
            {todayBanker?.pick?.odds > 0 && (
              <div className="shrink-0 text-right">
                <p className="text-lg font-black font-mono text-amber-400">{todayBanker.pick.odds.toFixed(2)}x</p>
                {todayBanker.pick.status === 'won' && (
                  <p className="text-[10px] font-bold text-emerald-500">✅ WON {todayBanker.pick.score}</p>
                )}
                {todayBanker.pick.status === 'lost' && (
                  <p className="text-[10px] font-bold text-rose-500">❌ LOST {todayBanker.pick.score}</p>
                )}
                {todayBanker.pick.status === 'pending' && (
                  <p className="text-[10px] text-gray-400">{language === 'fr' ? 'En cours' : 'Pending'}</p>
                )}
              </div>
            )}
          </div>
          {bankerSummary && (
            <div className="flex items-center gap-3 text-[10px]">
              <span className="text-emerald-400 font-bold">
                {bankerSummary.win_rate_pct}% {language === 'fr' ? 'de réussite' : 'win rate'}
              </span>
              <span className="text-gray-500">·</span>
              <span className="text-gray-400">
                {bankerSummary.wins}W — {bankerSummary.losses}L ({language === 'fr' ? '30 derniers jours' : 'last 30 days'})
              </span>
              {bankerSummary.streak_type === 'win' && bankerSummary.current_streak >= 3 && (
                <>
                  <span className="text-gray-500">·</span>
                  <span className="text-amber-400 font-bold">
                    🔥 {bankerSummary.current_streak} {language === 'fr' ? 'victoires d\'affilée' : 'win streak'}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Date Bar ── */}
      <div className="flex items-center justify-between bg-black/5 dark:bg-white/5 px-4 py-2.5 rounded-xl border border-black/5 dark:border-white/5 text-xs">
        <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
          <Clock size={12} />
          <span className="font-medium uppercase tracking-wide">
            {language === 'fr' ? `Prochain: ${scheduledTime}` : `Next: ${scheduledTimeDisplay}`}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-vantage-cyan font-bold">
          <Calendar size={12} />
          <span className="uppercase">{todayDisplay}</span>
          {predictions.length > 0 && (
            <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              {language === 'fr' ? '✓ Publié aujourd\'hui' : '✓ Published today'}
            </span>
          )}
        </div>
      </div>

      {/* ─── SORT & FILTER TOOLBAR ─── */}
      <div className="space-y-3 sticky top-[72px] z-20 bg-vantage-lightBg dark:bg-vantage-bg backdrop-blur-md py-2 -mx-2 px-2">
        {/* Sport Toggle */}
        <div className="flex bg-slate-100 dark:bg-white/5 rounded-xl p-1 border border-slate-200 dark:border-white/10">
          {(['football', 'basketball', 'cricket'] as Sport[]).map(sport => (
            <button
              key={sport}
              onClick={() => setActiveSport(sport)}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${activeSport === sport
                ? 'bg-white dark:bg-white/10 shadow text-slate-900 dark:text-white'
                : 'text-gray-500'
                }`}
            >
              {sport === 'football' ? '⚽' : sport === 'basketball' ? '🏀' : '🏏'}
              {sport === 'football'
                ? (language === 'fr' ? 'Football' : 'Football')
                : sport === 'cricket'
                  ? (language === 'fr' ? 'Cricket' : 'Cricket')
                : (language === 'fr' ? 'Basketball' : 'Basketball')}
            </button>
          ))}
        </div>

        {/* Search + Sort Row */}
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={language === 'fr' ? 'Chercher équipe ou ligue...' : 'Search team or league...'}
              className="bg-transparent text-xs outline-none text-slate-800 dark:text-white placeholder-gray-500 w-full"
            />
          </div>
          <div className="relative">
            <button
              onClick={() => setShowSortDropdown(v => !v)}
              className="h-full px-3 py-2 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-white shrink-0"
            >
              <SlidersHorizontal size={13} />
              {sortLabels[sortKey]}
              <ChevronDown size={12} className={`transition-transform ${showSortDropdown ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
              {showSortDropdown && (
                <MotionDiv
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  className="absolute right-0 top-full mt-1 z-30 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-xl overflow-hidden min-w-[130px]"
                >
                  {(Object.entries(sortLabels) as [SortKey, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => { setSortKey(key); setShowSortDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-xs font-bold hover:bg-slate-50 dark:hover:bg-white/10 transition-colors ${sortKey === key ? 'text-vantage-cyan' : 'text-slate-700 dark:text-white'
                        }`}
                    >
                      {label}
                    </button>
                  ))}
                </MotionDiv>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Match Count */}
        <div className="text-xs text-gray-500 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <TrendingUp size={11} />
            {language === 'fr'
              ? `${filteredMatches.length} matchs analysés`
              : `${filteredMatches.length} matches today`}
          </span>
          {rawFixtures.length === 0 && predictions.length > 0 && (
            <span className="text-[10px] text-amber-400 flex items-center gap-1">
              <Zap size={10} /> {language === 'fr' ? 'Mode IA' : 'AI Mode'}
            </span>
          )}
        </div>
      </div>

      {/* ─── MATCH LIST ─── */}
      <div className="space-y-6">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-[88px] w-full bg-slate-200 dark:bg-white/5 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : filteredMatches.length === 0 ? (
          <GlassCard className="text-center py-10 flex flex-col items-center justify-center min-h-[160px]">
            {systemError ? (
              <>
                <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mb-3">
                  <AlertTriangle size={24} className="text-red-500" />
                </div>
                <h3 className="text-slate-900 dark:text-white font-bold mb-1">
                  {language === 'fr' ? "Erreur de l'IA" : 'AI Analysis Error'}
                </h3>
                <p className="text-xs text-gray-500 max-w-[220px]">
                  {language === 'fr' ? 'Réessayez plus tard.' : 'Please try again later.'}
                </p>
              </>
            ) : searchQuery ? (
              <>
                <div className="w-12 h-12 bg-vantage-cyan/10 rounded-full flex items-center justify-center mb-3">
                  <Search size={24} className="text-vantage-cyan" />
                </div>
                <h3 className="text-slate-900 dark:text-white font-bold mb-1">
                  {language === 'fr' ? 'Aucun résultat' : 'No matches found'}
                </h3>
                <p className="text-xs text-gray-500">
                  {language === 'fr' ? 'Essayez une autre recherche.' : 'Try adjusting your search.'}
                </p>
              </>
            ) : (
              <>
                <div className="w-12 h-12 bg-vantage-cyan/10 rounded-full flex items-center justify-center mb-3">
                  <Hourglass size={24} className="text-vantage-cyan" />
                </div>
                <h3 className="text-slate-900 dark:text-white font-bold mb-1">
                  {language === 'fr' ? 'Pronostics pas encore disponibles' : "Not Yet Available"}
                </h3>
                <p className="text-xs text-gray-500 max-w-[220px] leading-relaxed">
                  {activeSport === 'basketball'
                    ? (language === 'fr' ? "Pas de pronostics basketball pour aujourd'hui. Revenez plus tard." : 'No basketball predictions yet. Come back later.')
                    : activeSport === 'cricket'
                      ? (language === 'fr' ? "Pas de pronostics cricket pour aujourd'hui. Revenez plus tard." : 'No cricket predictions yet. Come back later.')
                    : (language === 'fr'
                      ? `Les pronostics sont publiés à ${scheduledTime}. Revenez dans ${countdown.h}h ${countdown.m}m.`
                      : `Predictions publish at ${scheduledTimeDisplay}. Come back in ${countdown.h}h ${countdown.m}m.`
                    )}
                </p>
              </>
            )}
          </GlassCard>
        ) : (
          Object.keys(groupedMatches).map(groupKey => (
            <div key={groupKey} className="space-y-3">
              {groupKey !== 'All Matches' && (
                <div className="sticky top-[72px] z-10 py-2 bg-gradient-to-b from-vantage-lightBg/95 to-vantage-lightBg/50 dark:from-vantage-bg/95 dark:to-vantage-bg/50 backdrop-blur-md">
                  <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-slate-200/50 dark:bg-white/10 border border-slate-300 dark:border-white/10">
                    <Trophy size={12} className="text-vantage-purple" />
                    <span className="text-[10px] font-bold text-slate-800 dark:text-white uppercase tracking-wider">{groupKey}</span>
                  </div>
                </div>
              )}

              <AnimatePresence>
                {groupedMatches[groupKey].slice(0, visibleCount).map((match, idx) => {
                  const pred = getPrimaryPredictionText(match, language);
                  const confidence = getPrimaryPredictionProb(match);
                  const xgH = match.expected_goals_home ?? 0;
                  const xgA = match.expected_goals_away ?? 0;
                  const homeProb = Math.round((match.home_win_prob || 0) * 100);
                  const drawProb = Math.round((match.draw_prob || 0) * 100);
                  const awayProb = Math.round((match.away_win_prob || 0) * 100);
                  const isFreeMatch = freeMatchIds.has(match.id);
                  const unlocked = isVip || isFreeMatch;

                  return (
                    <motion.div
                      key={match.id}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ delay: idx * 0.03 }}
                      onClick={() => navigate(`/match/${match.id}`)}
                      className="cursor-pointer"
                    >
                      <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-[#1a1d26] backdrop-blur-md shadow-sm hover:border-vantage-cyan/40 hover:shadow-md transition-all">
                        {/* Header: league + time */}
                        <div className="flex justify-between items-center px-4 pt-3 pb-1.5">
                          <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest truncate max-w-[140px]">{match.league}</span>
                          <span className="flex items-center gap-1 text-[10px] text-gray-400 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-md"><Clock size={10} /> {match.time || match.kickoff_local}</span>
                        </div>

                        {/* Teams */}
                        <div className="flex items-center justify-between px-4 py-2">
                          <div className="flex items-center gap-2 w-5/12 min-w-0">
                            <div className="w-9 h-9 shrink-0 rounded-xl bg-slate-100 dark:bg-white/8 flex items-center justify-center border border-slate-200 dark:border-white/8 p-1">
                              <TeamLogo src={match.homeTeamLogo} teamName={match.homeTeam} className="w-full h-full" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{match.homeTeam}</p>
                              <FormDots form={match.homeForm || match.home_form} />
                            </div>
                          </div>
                          <div className="shrink-0 flex flex-col items-center px-1">
                            <span className="text-[10px] font-mono text-gray-400">VS</span>
                            {xgH > 0 && <span className="text-[8px] font-mono text-vantage-cyan">{xgH.toFixed(1)}-{xgA.toFixed(1)}</span>}
                          </div>
                          <div className="flex items-center gap-2 w-5/12 min-w-0 flex-row-reverse">
                            <div className="w-9 h-9 shrink-0 rounded-xl bg-slate-100 dark:bg-white/8 flex items-center justify-center border border-slate-200 dark:border-white/8 p-1">
                              <TeamLogo src={match.awayTeamLogo} teamName={match.awayTeam} className="w-full h-full" />
                            </div>
                            <div className="min-w-0 text-right">
                              <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{match.awayTeam}</p>
                              <div className="flex justify-end"><FormDots form={match.awayForm || match.away_form} /></div>
                            </div>
                          </div>
                        </div>

                        {/* Stats row */}
                        {unlocked ? (
                          <div className="px-4 pb-1.5 flex justify-center gap-1 flex-wrap">
                            {homeProb > 0 && (
                              <>
                                <span className="text-[9px] font-mono text-slate-500 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded">H {homeProb}%</span>
                                <span className="text-[9px] font-mono text-slate-500 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded">D {drawProb}%</span>
                                <span className="text-[9px] font-mono text-slate-500 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded">A {awayProb}%</span>
                              </>
                            )}
                            {match.over25_prob > 0 && <span className="text-[9px] font-mono text-vantage-cyan/80 bg-vantage-cyan/5 px-1.5 py-0.5 rounded">O2.5 {Math.round(match.over25_prob * 100)}%</span>}
                            {match.btts_prob > 0 && <span className="text-[9px] font-mono text-amber-400/80 bg-amber-400/5 px-1.5 py-0.5 rounded">BTTS {Math.round(match.btts_prob * 100)}%</span>}
                          </div>
                        ) : (
                          <div className="px-4 pb-1.5 flex justify-center">
                            <span onClick={(e) => { e.stopPropagation(); navigate('/vip'); }} className="text-[9px] font-bold text-vantage-purple bg-vantage-purple/10 border border-vantage-purple/20 px-3 py-1 rounded-full cursor-pointer hover:bg-vantage-purple/20">
                              <Lock size={9} className="inline mr-1" />{language === 'fr' ? 'Stats VIP' : 'VIP Stats'}
                            </span>
                          </div>
                        )}

                        {/* Prediction — show each pick with its percentage */}
                        {unlocked ? (
                          <div className="mx-3 mb-3 p-2.5 rounded-xl bg-gradient-to-r from-vantage-cyan/5 to-transparent border border-vantage-cyan/15 overflow-hidden">
                            <span className="text-[8px] text-gray-500 uppercase tracking-wide block mb-1.5">{t('free.pred_label') || 'Prediction'}</span>
                            <div className="space-y-1">
                              {getTopProbPicks(match).map((p, pi) => (
                                <div key={pi} className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] font-bold text-vantage-cyan truncate">{p.name}</span>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <div className="w-12 h-1 rounded-full bg-slate-200 dark:bg-white/10">
                                      <motion.div className="h-full rounded-full bg-gradient-to-r from-vantage-cyan to-emerald-400" initial={{ width: 0 }} animate={{ width: `${Math.round(p.prob * 100)}%` }} transition={{ duration: 1, delay: idx * 0.05 + 0.3 }} style={{ width: `${Math.round(p.prob * 100)}%` }} />
                                    </div>
                                    <span className="text-[10px] font-bold font-mono text-emerald-400 w-8 text-right">{Math.round(p.prob * 100)}%</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-vantage-cyan/10">
                              {match.odds > 1 && <span className="text-[9px] font-mono text-gray-400">{Number(match.odds).toFixed(2)}x</span>}
                              <span className="text-[9px] font-mono text-gray-400">{confidence}% match</span>
                              {isVip && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setTicketPicks(prev => { if (prev.some(p => p.id === match.id)) return prev; return [...prev, { id: match.id, home: match.homeTeam || match.home_team || '', away: match.awayTeam || match.away_team || '', pick: pred || '', odds: Number(match.odds) || 0 }]; }); }}
                                  className="p-1 rounded-lg bg-vantage-cyan/10 hover:bg-vantage-cyan/20 text-vantage-cyan transition-colors"
                                  title={language === 'fr' ? 'Ajouter au ticket' : 'Add to ticket'}
                                >
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="mx-3 mb-3 p-2.5 rounded-xl bg-vantage-purple/5 border border-vantage-purple/20">
                            <div className="flex items-center justify-between">
                              <div className="flex flex-col">
                                <span className="text-[8px] text-vantage-purple uppercase tracking-wide">{t('free.pred_label') || 'Prediction'}</span>
                                <span className="text-[11px] font-bold text-vantage-purple/40">{language === 'fr' ? 'Réservé VIP' : 'VIP Only'}</span>
                              </div>
                              <span onClick={(e) => { e.stopPropagation(); navigate('/vip'); }} className="text-[9px] font-bold text-vantage-purple bg-vantage-purple/10 border border-vantage-purple/20 px-2.5 py-1 rounded-full cursor-pointer hover:bg-vantage-purple/20 flex items-center gap-1">
                                <Lock size={9} /> {language === 'fr' ? 'Débloquer' : 'Unlock'}
                              </span>
                            </div>
                          </div>
                        )}
                        <div className="px-3 pb-2 flex justify-center">
                          <span className="text-[8px] text-gray-400 flex items-center gap-1">
                            <ChevronRight size={10} /> {language === 'fr' ? 'Voir les détails' : 'Tap to view'}
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {filteredMatches.length > visibleCount && (
                <button
                  onClick={() => setVisibleCount(v => v + 15)}
                  className="w-full py-3 rounded-xl border border-white/10 text-xs font-bold text-gray-400 hover:text-vantage-cyan transition-colors flex items-center justify-center gap-1.5"
                >
                  <ChevronDown size={14} />
                  {language === 'fr'
                    ? `Afficher ${Math.min(15, filteredMatches.length - visibleCount)} de plus`
                    : `Show ${Math.min(15, filteredMatches.length - visibleCount)} more`}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Floating Action Button — Smart Ticket (VIP only) */}
      {isVip && (
        <>
          {ticketPicks.length > 0 && (
            <div className="fixed bottom-24 right-4 z-30 flex items-center gap-2">
              <span className="text-[10px] font-black bg-emerald-500 text-white px-2 py-1 rounded-full shadow-lg">{ticketPicks.length}</span>
            </div>
          )}
          <button
            onClick={() => setShowTicket(true)}
            className="fixed bottom-24 right-4 z-30 w-14 h-14 rounded-2xl bg-gradient-to-br from-vantage-cyan to-vantage-purple text-white shadow-xl shadow-vantage-purple/30 flex items-center justify-center active:scale-95 transition-transform hover:shadow-2xl hover:scale-105"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5v2M15 11v2M15 17v2M5 5h14a2 2 0 012 2v3a2 2 0 000 4v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3a2 2 0 000-4V7a2 2 0 012-2z" />
            </svg>
          </button>

          {/* Ticket Modal */}
          <AnimatePresence>
            {showTicket && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
                onClick={() => setShowTicket(false)}
              >
                <motion.div
                  initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                  transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#1a1d26] shadow-2xl"
                >
                  <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 bg-white dark:bg-[#1a1d26] border-b border-slate-200 dark:border-white/10 rounded-t-3xl">
                    <h2 className="text-lg font-black text-slate-900 dark:text-white">
                      {language === 'fr' ? 'Ticket Pro' : 'Pro Ticket'}
                    </h2>
                    <button onClick={() => setShowTicket(false)} className="p-2 rounded-xl bg-slate-100 dark:bg-white/5 text-gray-500 hover:text-red-500 transition-colors">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                  <div className="p-4">
                    {ticketPicks.length > 0 && (
                      <div className="mb-4 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                        <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-2">{ticketPicks.length} picks added</p>
                        <div className="space-y-1.5">
                          {ticketPicks.map((p, i) => (
                            <div key={i} className="flex items-center justify-between text-[10px]">
                              <span className="font-bold text-slate-700 dark:text-gray-200 truncate mr-2">{p.home} vs {p.away}</span>
                              <span className="font-mono text-vantage-cyan shrink-0">{p.pick} @ {p.odds.toFixed(2)}</span>
                              <button onClick={() => setTicketPicks(prev => prev.filter((_, j) => j !== i))} className="ml-1 p-0.5 text-red-400 hover:text-red-300">✕</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <TicketWizard />
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
};

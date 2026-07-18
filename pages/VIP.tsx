import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Lock, Star, ShieldCheck, CheckCircle2, Loader2, Zap, Flame, Copy, Check, Clock, User, ArrowRight, ShieldAlert, BrainCircuit, Layers, RefreshCw, Crown, Sparkles, TrendingUp, BarChart2, ChevronDown, ChevronUp, ChevronRight, Calendar, Activity, Pencil, Banknote, Radio, LayoutGrid, Radar } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { useAppContext } from '../context/AppContext';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { PaymentModal } from '../components/PaymentModal';
import { NavigationTab, Match } from '../types';
import { TeamLogo } from '../components/TeamLogo';
import { AccumulatorModal } from '../components/AccumulatorModal';
import { VaultTab } from '../components/VaultTab';
import { getAppSettings, getGlobalTodayKey, getInternalSettings } from '../services/db';
import { normalizeQuantPrediction } from '../services/db';
import { getTomorrowFixturesFromDB } from '../services/sportsData';
import { PortfolioOnboarding } from '../components/PortfolioOnboarding';
import { Sparkline } from '../components/Sparkline';
import { getTopProbPicks } from '../utils';
import { Screener } from '../components/Screener';
import { MatchCardAlpha } from '../components/MatchCardAlpha';
import { ResponsibleGambling } from '../components/ResponsibleGambling';

import { db } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';

const backendUrl = import.meta.env.VITE_BACKEND_URL || '';

// ── Currency detection helper ──â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const CURRENCY_MAP: Record<string, { symbol: string; rate: number; label: string }> = {
  'ng': { symbol: '₦', rate: 1500, label: 'NGN' },
  'ke': { symbol: 'KSh', rate: 130, label: 'KES' },
  'gh': { symbol: 'GH₵', rate: 15, label: 'GHS' },
  'za': { symbol: 'R', rate: 19, label: 'ZAR' },
  'cm': { symbol: 'FCFA', rate: 600, label: 'XAF' },
  'ci': { symbol: 'FCFA', rate: 600, label: 'XOF' },
  'sn': { symbol: 'FCFA', rate: 600, label: 'XOF' },
  'gb': { symbol: '£', rate: 0.79, label: 'GBP' },
  'eu': { symbol: '€', rate: 0.92, label: 'EUR' },
};

function getPricingForCountry(baseUsd: number, countryCode: string = 'other') {
  if (CURRENCY_MAP[countryCode]) {
    const cur = CURRENCY_MAP[countryCode];
    const converted = Math.round(baseUsd * cur.rate);
    return { amount: converted, symbol: cur.symbol, code: cur.label, isConverted: true, originalValue: baseUsd };
  }
  return { amount: baseUsd, symbol: '$', code: 'USD', isConverted: false, originalValue: baseUsd };
}

interface VIPProps {}

export const VIP: React.FC<VIPProps> = () => {
  const navigate = useNavigate();
  const { t, language, showToast } = useAppContext();
  const { predictions, accumulators: dataContextAccumulators, loading, basketballPredictions, cricketPredictions } = useData();
  const { user, userProfile, isAdmin, verifyTransaction } = useAuth();

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<'weekly' | 'monthly' | 'quarterly' | 'annual'>('monthly');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  // Accumulator Modal State
  const [isAccuOpen, setIsAccuOpen] = useState(false);
  const [accuTier, setAccuTier] = useState<string>('baseline');
  const [whatsappGroupUrl, setWhatsappGroupUrl] = useState<string | null>(null);

  useEffect(() => {
    getInternalSettings().then(s => {
      if (s.whatsappGroupUrl) setWhatsappGroupUrl(s.whatsappGroupUrl);
    });
  }, []);

  const [activeVipTab, setActiveVipTab] = useState<'predictions' | 'vault' | 'accumulators'>('predictions');
  const [hasSeenPicksSection, setHasSeenPicksSection] = useState(false);
  const [showPicksHighlight, setShowPicksHighlight] = useState(false);
  const [activeSport, setActiveSport] = useState<'football' | 'basketball' | 'cricket'>('football');
  const activeAltPredictions = activeSport === 'cricket' ? cricketPredictions : basketballPredictions;
  const activeAltSportLabel = activeSport === 'cricket' ? 'Cricket' : 'Basketball';
  const activeAltLeagueLabel = activeSport === 'cricket' ? 'Cricket' : 'NBA';
  const activeAltIcon = activeSport === 'cricket' ? '🏏' : '🏀';
  const [picksDay, setPicksDay] = useState<'today' | 'tomorrow'>('today');
  const [tomorrowFixtures, setTomorrowFixtures] = useState<Match[]>([]);
  const [tomorrowLoading, setTomorrowLoading] = useState(false);

  useEffect(() => {
    if (picksDay === 'tomorrow') {
      setTomorrowLoading(true);
      getTomorrowFixturesFromDB()
        .then(fixtures => setTomorrowFixtures(fixtures as Match[]))
        .finally(() => setTomorrowLoading(false));
    }
  }, [picksDay]);

  // isUnlocked must be declared HERE (before the useEffect that references it)
  // to avoid a Temporal Dead Zone (TDZ) ReferenceError crash.
  const isUnlocked = (userProfile?.isVip === true) || isAdmin;

  // â”€â”€ Quant Model State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Use DataContext predictions to avoid duplicate Firestore reads.
  // DataContext already streams quant_predictions via onSnapshot.
  const [quantAccumulators, setQuantAccumulators] = useState<Record<string, any[]>>({});
  const [quantLoading, setQuantLoading] = useState(false);
  const [quantBetFilter, setQuantBetFilter] = useState<string>('All');
  const [quantLeagueFilter, setQuantLeagueFilter] = useState<string>('All');
  const [quantExpanded, setQuantExpanded] = useState(true);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [showPortfolioEdit, setShowPortfolioEdit] = useState(false);
  const [showAllPlans, setShowAllPlans] = useState(false);
  const [leagueRadar, setLeagueRadar] = useState<any>(null);
  const [accaCopilot, setAccaCopilot] = useState<any>(null);
  const [dailyTip, setDailyTip] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  // Sort predictions by rank priority (same logic as before but now uses DataContext data)
  const quantPredictions = useMemo(() => {
    const sorted = [...predictions].map(normalizeQuantPrediction) as Match[];
    const rankPriority: Record<string, number> = { high: 4, medium: 3, low: 2, none: 1 };
    sorted.sort((a, b) => (rankPriority[b.value_rank ?? ''] || 0) - (rankPriority[a.value_rank ?? ''] || 0));
    return sorted;
  }, [predictions]);

  // Auto-expand Model Picks on first visit to predictions tab
  useEffect(() => {
    if (activeVipTab === 'predictions' && !hasSeenPicksSection && quantPredictions.length > 0) {
      setQuantExpanded(true);
      setHasSeenPicksSection(true);
      setShowPicksHighlight(true);
      setTimeout(() => setShowPicksHighlight(false), 2500);
    }
  }, [activeVipTab, hasSeenPicksSection, quantPredictions.length]);

  // Load accumulators from DataContext accumulators or fallback to Firestore
  useEffect(() => {
    if (!isUnlocked) return;
    if (dataContextAccumulators) {
      setQuantAccumulators(dataContextAccumulators as Record<string, any[]> || {});
      return;
    }
    setQuantLoading(true);
    const dateKey = getGlobalTodayKey();
    getDoc(doc(db, 'quant_predictions', dateKey)).then(snap => {
      if (snap.exists() && snap.data().accumulators) {
        setQuantAccumulators(snap.data().accumulators);
      }
    }).catch(() => {}).finally(() => setQuantLoading(false));
  }, [isUnlocked]);

  // Fetch AI-powered features when predictions are loaded
  useEffect(() => {
    if (!isUnlocked || quantPredictions.length === 0) return;
    
    const fetchAIFeatures = async () => {
      setAiLoading(true);
      try {
        const response = await fetch(`${backendUrl}/api/ai/features`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ predictions: quantPredictions })
        });
        if (response.ok) {
          const data = await response.json();
          setLeagueRadar(data.leagueRadar);
          setAccaCopilot(data.accaCopilot);
          setDailyTip(data.dailyTip);
        }
      } catch (e) {
        console.warn('AI features fetch failed:', e);
      } finally {
        setAiLoading(false);
      }
    };

    fetchAIFeatures();
  }, [isUnlocked, quantPredictions.length, backendUrl]);

  const BET_TYPE_FILTERS = ['All', 'Home Win', 'Away Win', 'Over 2.5 Goals', 'BTTS', 'Double Chance (1X)', 'Double Chance (X2)'];
  const BET_TYPE_LABELS: Record<string, string> = {
    'All': 'All Bets',
    'Home Win': 'Straight Win',
    'Away Win': 'Straight Win',
    'Over 2.5 Goals': 'Over/Under',
    'Under 2.5 Goals': 'Over/Under',
    'BTTS': 'BTTS',
    'Double Chance (1X)': 'Double Chance',
    'Double Chance (X2)': 'Double Chance',
    'Double Chance (12)': 'Double Chance',
  };
  const BET_FILTER_GROUPS: Record<string, string[]> = {
    'All': [],
    'Straight Win': ['Home Win', 'Away Win', 'Draw No Bet (Home)', 'Draw No Bet (Away)'],
    'Over/Under': ['Over 1.5 Goals', 'Over 2.5 Goals', 'Under 2.5 Goals', 'Over 3.5 Goals', 'Under 3.5 Goals'],
    'BTTS': ['BTTS', 'BTTS No'],
    'Double Chance': ['Double Chance (1X)', 'Double Chance (X2)', 'Double Chance (12)'],
  };

  // Unique league names for the league filter
  const availableLeagues = ['All', ...Array.from(new Set(quantPredictions.map(m => m.league || '').filter(Boolean))).sort()];

  const filteredQuantPredictions = quantPredictions
    .filter(m => {
      if (quantBetFilter === 'All') return true;
      const betType = m.bet_type || m.prediction || '';
      const group = BET_FILTER_GROUPS[quantBetFilter] || [];
      return group.some(g => betType.includes(g)) || betType === quantBetFilter;
    })
    .filter(m => quantLeagueFilter === 'All' || (m.league || '') === quantLeagueFilter);

  const isFirstTime = userProfile && (!userProfile.totalPaid || userProfile.totalPaid === 0);

  const plans: Array<{
    id: 'weekly' | 'monthly' | 'quarterly' | 'annual';
    label: string;
    badge: string | null;
    price: string;
    icon: React.ReactNode;
    features: string[];
    color: string;
    claimColor: string;
  }> = [
      {
        id: 'weekly',
        label: t('vip.plan_weekly'),
        badge: '📊 7-DAY ACCESS',
        price: '14.99',
        icon: <Activity size={20} />,
        features: ['Full +EV Signal Feed', 'Kelly Bankroll Sizing', 'Alpha Screener Access'],
        color: 'border-slate-200 dark:border-white/10 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm',
        claimColor: 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90',
      },
      {
        id: 'monthly',
        label: t('vip.plan_monthly'),
        badge: '🔥 MOST POPULAR',
        price: '24.99',
        icon: <Star size={20} />,
        features: ['Full +EV Signal Feed', 'Alpha Screener Access', 'VIP WhatsApp Group'],
        color: 'border-vantage-cyan bg-vantage-cyan/5 dark:bg-vantage-cyan/10 shadow-[0_0_40px_rgba(34,211,238,0.1)]',
        claimColor: 'bg-vantage-cyan hover:bg-cyan-400 text-slate-900 shadow-lg shadow-vantage-cyan/25',
      },
      {
        id: 'quarterly',
        label: t('vip.plan_quarterly'),
        badge: '💎 BEST VALUE',
        price: '59.99',
        icon: <ShieldCheck size={20} />,
        features: ['Full +EV Signal Feed', 'Alpha Screener Access', 'VIP WhatsApp Group', 'Priority Support'],
        color: 'border-slate-200 dark:border-white/10 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm',
        claimColor: 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90',
      },
      {
        id: 'annual',
        label: t('vip.plan_annual') || 'Annual Access',
        badge: '👑 ULTIMATE',
        price: '99.99',
        icon: <Crown size={20} />,
        features: ['Full +EV Signal Feed', 'Alpha Screener Access', 'VIP WhatsApp Group', 'Priority Support', 'Monthly 1-on-1 Review'],
        color: 'border-vantage-purple bg-vantage-purple/5 dark:bg-vantage-purple/10 shadow-[0_0_40px_rgba(168,85,247,0.1)]',
        claimColor: 'bg-vantage-purple hover:bg-purple-500 text-white shadow-lg shadow-vantage-purple/25',
      },
    ];

  const handlePlanClick = (planId: 'weekly' | 'monthly' | 'quarterly' | 'annual') => {
    setSelectedPlanId(planId);
    setShowPaymentModal(true);
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    if (navigator.vibrate) navigator.vibrate(50);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const openAccumulator = (tier: string) => {
    setAccuTier(tier);
    setIsAccuOpen(true);
  };

  const handleManualCheck = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const transId = urlParams.get('transId');

    if (!transId) {
      showToast(
        language === 'fr' ? "Aucune transaction trouvée dans l'URL." : "No transaction ID found.",
        'info'
      );
      return;
    }

    setIsVerifying(true);
    const success = await verifyTransaction(transId);
    setIsVerifying(false);

    if (success) {
      showToast(
        language === 'fr' ? "Transaction validée ! Bienvenue VIP." : "Transaction verified! Welcome VIP.",
        'success'
      );
    } else {
      showToast(
        language === 'fr' ? "Transaction non trouvée ou échouée." : "Transaction not found or failed.",
        'warning'
      );
    }
  };

  const getPredictionText = (match: Match) => {
    if (language === 'fr') return match.prediction_fr || match.prediction;
    return match.prediction_en || match.prediction;
  };

  const getAnalysisText = (match: Match) => {
    if (language === 'fr') return match.analysis_fr || match.analysis;
    return match.analysis_en || match.analysis;
  };

  // isUnlocked is declared above (near line 78) to avoid TDZ crash.

  const safeBets = predictions.filter(m => m.category === 'safe');
  const valueBets = predictions.filter(m => m.category === 'value');
  const riskyBets = predictions.filter(m => m.category === 'risky');

  // â”€â”€ Category styling config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const CAT_CONFIG = {
    safe: { border: 'border-l-green-500', badge: 'bg-green-500/15 text-green-500 border-green-500/30', icon: <ShieldCheck size={12} />, label: '🟢 Safe' },
    value: { border: 'border-l-vantage-cyan', badge: 'bg-vantage-cyan/15 text-vantage-cyan border-vantage-cyan/30', icon: <Star size={12} />, label: 'â­ Value' },
    risky: { border: 'border-l-orange-500', badge: 'bg-orange-500/15 text-orange-500 border-orange-500/30', icon: <Flame size={12} />, label: '🔥 Risky' },
    lean: { border: 'border-l-slate-500', badge: 'bg-slate-500/15 text-slate-500 border-slate-500/30', icon: <BarChart2 size={12} />, label: '📊 Lean' },
  } as const;

  const renderMatchList = (matches: Match[], title: string, icon: React.ReactNode, color: string) => {
    if (matches.length === 0) return null;
    return (
      <div className="space-y-3 mb-6">
        <h3 className={`text-sm font-bold uppercase tracking-widest flex items-center gap-2 ${color}`}>
          {icon} {title}
          <span className="ml-auto text-[10px] font-normal text-gray-500">{matches.length} picks</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-3">
          <AnimatePresence>
            {matches.map((match, idx) => {
              const cat = match.category as keyof typeof CAT_CONFIG;
              const cfg = CAT_CONFIG[cat] || CAT_CONFIG.safe;
              return (
                <motion.div
                  key={match.id}
                  initial={{ opacity: 0, y: 20, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.35, delay: idx * 0.07, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className="h-full"
                >
                  <div className={`relative overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-md shadow-lg border-l-4 h-full flex flex-col ${cfg.border}`}>

                    {/* Header row */}
                    <div className="flex justify-between items-center px-4 pt-4 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest leading-none truncate max-w-[80px]">{match.league}</span>
                        <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${cfg.badge}`}>
                          {cfg.icon} {cfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
                          <Clock size={10} />{match.time}
                        </span>
                        <button
                          onClick={() => handleCopy(`${match.homeTeam} vs ${match.awayTeam} - ${getPredictionText(match)}`, match.id)}
                          className="p-1.5 rounded-md bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors text-gray-400 hover:text-vantage-cyan shrink-0"
                        >
                          {copiedId === match.id ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                        </button>
                      </div>
                    </div>

                    {/* Teams row */}
                    <div className="flex justify-between items-center px-4 py-3">
                      <div className="flex items-center gap-2.5 w-5/12 overflow-hidden">
                        <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center border border-slate-200 dark:border-white/5 shrink-0 p-1">
                          <TeamLogo src={match.homeTeamLogo} teamName={match.homeTeam} className="w-7 h-7" />
                        </div>
                        <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate leading-tight">{match.homeTeam}</span>
                      </div>
                      <div className="flex flex-col items-center gap-1 shrink-0 px-1">
                        <span className="text-[10px] font-mono text-gray-400">VS</span>
                        {match.odds > 1 && (
                          <span className="text-[10px] font-bold font-mono bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-300">{match.odds.toFixed(2)}x</span>
                        )}
                      </div>
                      <div className="flex items-center justify-end gap-2.5 w-5/12 overflow-hidden">
                        <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white text-right truncate leading-tight">{match.awayTeam}</span>
                        <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center border border-slate-200 dark:border-white/5 shrink-0 p-1">
                          <TeamLogo src={match.awayTeamLogo} teamName={match.awayTeam} className="w-7 h-7" />
                        </div>
                      </div>
                    </div>

                    {/* Prediction + confidence row */}
                    <div className="relative mx-4 mb-3 p-3 bg-slate-50 dark:bg-black/30 rounded-xl border border-slate-200 dark:border-white/5 overflow-hidden mt-auto">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wide block mb-1.5">{t('free.pred_label')}</span>
                      <div className="space-y-1">
                        {getTopProbPicks(match).map((p, pi) => (
                          <div key={pi} className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-bold text-vantage-cyan truncate">{p.name}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-white/10">
                                <motion.div className="h-full rounded-full bg-gradient-to-r from-vantage-cyan to-emerald-400" initial={{ width: 0 }} animate={{ width: `${Math.round(p.prob * 100)}%` }} transition={{ duration: 1, delay: idx * 0.05 + 0.3 }} style={{ width: `${Math.round(p.prob * 100)}%` }} />
                              </div>
                              <span className="text-[10px] font-bold font-mono text-emerald-400 w-8 text-right">{Math.round(p.prob * 100)}%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* AI Reasoning */}
                    <div className="mx-4 mb-4 p-3 rounded-xl bg-gradient-to-r from-vantage-purple/5 to-transparent border border-vantage-purple/15">
                      <div className="flex items-start gap-2">
                        <BrainCircuit size={13} className="text-vantage-purple mt-0.5 shrink-0" />
                        <div>
                          <span className="text-[10px] text-vantage-purple font-bold uppercase tracking-wide">AI Analysis</span>
                          <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed mt-0.5 line-clamp-3" title={getAnalysisText(match)}>{getAnalysisText(match)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    );
  };

  const selectedPlanObj = plans.find(p => p.id === selectedPlanId) || plans[0];

  // --- UNLOCKED VIEW (Active VIP) ---
  if (isUnlocked) {
    const expiryDate = userProfile?.vipExpiry ? new Date(userProfile.vipExpiry) : null;
    const daysLeft = expiryDate ? Math.max(0, Math.ceil((expiryDate.getTime() - Date.now()) / 86400000)) : null;

    const needsPortfolioOnboarding = userProfile && !userProfile.portfolioBankroll;

    if (needsPortfolioOnboarding) {
        return <PortfolioOnboarding onComplete={() => {}} />;
    }

    if (showPortfolioEdit) {
        return (
            <PortfolioOnboarding
                onComplete={() => setShowPortfolioEdit(false)}
                onCancel={() => setShowPortfolioEdit(false)}
                initialBankroll={userProfile?.portfolioBankroll}
                initialRisk={userProfile?.riskTolerance}
                isEditMode
            />
        );
    }

    return (
      <div className="space-y-4 pb-24 relative min-h-screen">
        {/* Header */}
        <motion.div
          className="flex flex-col space-y-1"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="text-2xl font-black font-orbitron text-slate-900 dark:text-white uppercase tracking-tight">
            {t('vip.title')} <span className="text-vantage-cyan">{t('vip.title_accent')}</span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">{t('vip.subtitle')}</p>
        </motion.div>

        {/* Premium VIP status badge */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className={`relative overflow-hidden rounded-2xl p-4 border ${isAdmin
            ? 'border-red-500/30 bg-red-500/5'
            : 'border-vantage-purple/40 bg-gradient-to-r from-vantage-purple/10 to-vantage-cyan/5'
            }`}
        >
          {/* Animated ring */}
          {!isAdmin && (
            <motion.div
              className="absolute -top-4 -right-4 w-24 h-24 rounded-full border-2 border-vantage-purple/20"
              animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isAdmin ? 'bg-red-500/20 text-red-500' : 'bg-vantage-purple/20 text-vantage-purple'
                }`}>
                {isAdmin ? <ShieldAlert size={20} /> : <Crown size={20} />}
              </div>
              <div>
                <p className="font-bold text-slate-900 dark:text-white text-sm">
                  {isAdmin ? 'Admin Bypass Active' : t('vip.active')}
                </p>
                {daysLeft !== null && !isAdmin && (
                  <p className="text-[11px] text-vantage-purple font-semibold">
                    {daysLeft === 0 ? 'Expires today!' : `${daysLeft}d remaining`}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {expiryDate && !isAdmin && (
                <div className="text-right">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide">Expires</p>
                  <p className="text-xs font-bold font-orbitron text-slate-900 dark:text-white">
                    {expiryDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </p>
                </div>
              )}
              {!isAdmin && (
                <button
                  onClick={() => setShowPortfolioEdit(true)}
                  className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-vantage-cyan transition-colors"
                  title={language === 'fr' ? 'Modifier le portefeuille' : 'Edit bankroll'}
                >
                  <Pencil size={16} />
                </button>
              )}
            </div>
          </div>
        </motion.div>

        {/* WhatsApp Community CTA (for active VIPs) */}
        {whatsappGroupUrl && (
          <a
            href={whatsappGroupUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-[#25D366]/15 border border-[#25D366]/30 text-[#25D366] font-bold text-sm hover:bg-[#25D366]/25 active:scale-[0.98] transition-all"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.125.553 4.122 1.523 5.858L.057 23.945l6.305-1.654A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.906a9.896 9.896 0 01-5.043-1.38l-.361-.214-3.744.982.999-3.648-.235-.374A9.86 9.86 0 012.094 12C2.094 6.58 6.58 2.094 12 2.094S21.906 6.58 21.906 12 17.42 21.906 12 21.906z" />
            </svg>
            {language === 'fr' ? 'Rejoindre le Groupe VIP WhatsApp' : 'Join VIP WhatsApp Group'}
          </a>
        )}

       {/* â”€â”€ TAB SWITCH â”€â”€ */}
       <div className="flex bg-slate-100 dark:bg-white/5 rounded-xl p-1 mb-6">
          <button
            onClick={() => setActiveVipTab('predictions')}
            className={`flex-1 py-2 text-[10px] sm:text-xs font-bold rounded-lg transition-colors flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 ${activeVipTab === 'predictions' ? 'bg-white dark:bg-[#1a1d26] shadow-sm text-vantage-cyan' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <BarChart2 size={16} /> <span>Signals</span>
          </button>

          <button
            onClick={() => setActiveVipTab('vault')}
            className={`flex-1 py-2 text-[10px] sm:text-xs font-bold rounded-lg transition-colors flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 ${activeVipTab === 'vault' ? 'bg-white dark:bg-[#1a1d26] shadow-sm text-emerald-500' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <Banknote size={16} /> <span>Vault</span>
          </button>

          <button
            onClick={() => setActiveVipTab('accumulators')}
            className={`flex-1 py-2 text-[10px] sm:text-xs font-bold rounded-lg transition-colors flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 ${activeVipTab === 'accumulators' ? 'bg-white dark:bg-[#1a1d26] shadow-sm text-purple-500' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <LayoutGrid size={16} /> <span>Accumulators</span>
          </button>
        </div>



        {/* â”€â”€ VAULT SECTION â”€â”€ */}
        {activeVipTab === 'vault' && (
          <div className="mb-6">
            <VaultTab quantPredictions={quantPredictions} onEditBankroll={() => setShowPortfolioEdit(true)} />
          </div>
        )}

        {/* â”€â”€ ACCUMULATORS SECTION â”€â”€ */}
        {activeVipTab === 'accumulators' && (
          <div className="mb-6">
            <div className="mb-4">
              <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2 text-purple-500">
                <LayoutGrid size={16} />
                <span>Accumulators</span>
                <span className="text-[9px] font-normal text-gray-500 ml-1">
                  {(() => {
                    let total = 0;
                    Object.values(quantAccumulators).forEach((arr: any[]) => { total += (arr as any[]).length; });
                    return `${total} slips across ${Object.keys(quantAccumulators).filter(k => quantAccumulators[k]?.length > 0).length} tiers`;
                  })()}
                </span>
              </h3>
            </div>
            {!quantLoading && Object.keys(quantAccumulators).length === 0 ? (
              <div className="text-center py-10 rounded-2xl border-2 border-dashed border-purple-500/20 bg-purple-500/5">
                <LayoutGrid size={28} className="mx-auto mb-2 text-purple-500/40" />
                <p className="text-sm font-medium text-gray-500">No accumulators generated today</p>
                <p className="text-xs text-gray-400 mt-1">Check back after 19:00 Lagos time</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { key: 'safe_stack', icon: '🔒', label: 'Safe Stack', color: 'teal', desc: '85%+ probability' },
                  { key: 'baseline', icon: '🛡️', label: 'Baseline', color: 'emerald', desc: language === 'fr' ? 'Safest picks' : 'Safest combinations' },
                  { key: 'alpha_edge', icon: '⚡', label: 'Alpha Edge', color: 'cyan', desc: language === 'fr' ? 'Balanced risk-reward' : 'Balanced risk-reward' },
                  { key: 'syndicate', icon: '🎯', label: 'Syndicate', color: 'yellow', desc: language === 'fr' ? 'Medium risk' : 'Medium risk' },
                  { key: 'variance_play', icon: '🚀', label: 'Variance', color: 'purple', desc: language === 'fr' ? 'Higher odds' : 'Higher odds' },
                ].map(tier => {
                  const tierData = quantAccumulators[tier.key];
                  if (!tierData || tierData.length === 0) return null;
                  const colorMap: Record<string, { border: string; bg: string; text: string; icon: string }> = {
                    teal: { border: 'border-teal-500/30', bg: 'bg-teal-500/5', text: 'text-teal-500', icon: '🔒' },
                    emerald: { border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', text: 'text-emerald-500', icon: '🛡️' },
                    cyan: { border: 'border-cyan-500/30', bg: 'bg-cyan-500/5', text: 'text-cyan-500', icon: '⚡' },
                    yellow: { border: 'border-yellow-500/30', bg: 'bg-yellow-500/5', text: 'text-yellow-500', icon: '🎯' },
                    purple: { border: 'border-purple-500/30', bg: 'bg-purple-500/5', text: 'text-purple-500', icon: '🚀' },
                  };
                  const cfg = colorMap[tier.color];
                  const bestSlip = tierData[0];

                  return (
                    <motion.button
                      key={tier.key}
                      onClick={() => openAccumulator(tier.key)}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileTap={{ scale: 0.98 }}
                      className={`p-5 rounded-2xl border-2 ${cfg.border} ${cfg.bg} text-left hover:scale-[1.02] transition-all`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl">{tier.icon}</span>
                          <div>
                            <p className={`text-lg font-black ${cfg.text}`}>{tier.label}</p>
                            <p className="text-[10px] text-gray-400">{tier.desc}</p>
                          </div>
                        </div>
                        <div className={`px-3 py-1.5 rounded-full ${cfg.bg} border ${cfg.border}`}>
                          <span className={`text-sm font-black font-mono ${cfg.text}`}>{bestSlip.combined_odds?.toFixed(2) || '-'}x</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-gray-400 uppercase tracking-wider">{language === 'fr' ? 'Meilleur slip' : 'Top Slip'}</p>
                        {bestSlip.matches?.slice(0, 3).map((m: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 text-[11px]">
                            <span className="text-gray-400">{i + 1}.</span>
                            <span className="font-bold text-gray-700 dark:text-gray-200 truncate">{m.homeTeam || m.home_team}</span>
                            <span className="text-gray-400">vs</span>
                            <span className="font-bold text-gray-700 dark:text-gray-200 truncate">{m.awayTeam || m.away_team}</span>
                          </div>
                        ))}
                        {(bestSlip.matches?.length || 0) > 3 && (
                          <p className="text-[10px] text-gray-400">+{(bestSlip.matches?.length || 0) - 3} more picks</p>
                        )}
                      </div>
                      <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between">
                        <span className="text-[10px] text-gray-400">{tierData.length} {language === 'fr' ? 'slips disponibles' : 'slips available'}</span>
                        <span className={`text-[10px] font-bold ${cfg.text} flex items-center gap-1`}>
                          {language === 'fr' ? 'Voir tout' : 'View all'} <ChevronRight size={12} />
                        </span>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </div>
        )}


        {/* â”€â”€ VANTAGE MODEL PICKS SECTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {activeVipTab === 'predictions' && (
        <div className={`mb-6 animate-in slide-in-from-left duration-300 ${showPicksHighlight ? 'ring-2 ring-cyan-400 ring-opacity-50 rounded-2xl' : ''}`}>
          {/* Sticky Header */}
          <div className={`${quantExpanded ? 'sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm -mx-2 px-2 py-2 rounded-xl' : ''}`}>
          {/* Header */}
          <button
            onClick={() => setQuantExpanded(v => !v)}
            className="w-full flex items-center justify-between mb-3"
          >
            <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2 text-slate-700 dark:text-gray-300">
              <BarChart2 size={16} className="text-emerald-500" />
              <span>Model Picks</span>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 ml-1">VANTAGE AI</span>
              {!quantExpanded && quantPredictions.length > 0 && (
                <motion.span
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 0.6, repeat: Infinity }}
                  className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-cyan-500 text-white ml-1"
                >
                  NEW
                </motion.span>
              )}
              {quantPredictions.length > 0 && (
                <span className="text-[10px] font-normal text-gray-500">{quantPredictions.length} bets</span>
              )}
            </h3>
            {quantExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
          </button>
          </div>

          <AnimatePresence>
            {quantExpanded && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>

                {/* â”€â”€ Sport Toggle â”€â”€ */}
                <div className="flex bg-slate-100 dark:bg-white/5 rounded-xl p-1 mb-4">
                  <button
                    onClick={() => setActiveSport('football')}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                      activeSport === 'football'
                        ? 'bg-white dark:bg-slate-800 shadow text-vantage-cyan'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    ⚽ Football
                  </button>
                  <button
                    onClick={() => setActiveSport('basketball')}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                      activeSport === 'basketball'
                        ? 'bg-white dark:bg-slate-800 shadow text-orange-400'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    🏀 NBA
                  </button>
                  <button
                    onClick={() => setActiveSport('cricket')}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                      activeSport === 'cricket'
                        ? 'bg-white dark:bg-slate-800 shadow text-emerald-400'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    🏏 Cricket
                  </button>
                </div>

                {/* â”€â”€ AI Quick Stats (Football only) â”€â”€ */}
                {activeSport === 'football' && (dailyTip || leagueRadar || accaCopilot) && (
                  <div className="flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-none">
                    {dailyTip && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="shrink-0 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 min-w-[200px]"
                      >
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Sparkles size={10} className="text-amber-500" />
                          <span className="text-[9px] font-bold text-amber-500">TIP</span>
                        </div>
                        <p className="text-[10px] font-medium text-gray-700 dark:text-gray-200 truncate">{dailyTip.tip}</p>
                      </motion.div>
                    )}
                    {leagueRadar && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="shrink-0 px-3 py-2 rounded-xl bg-vantage-cyan/10 border border-vantage-cyan/20 min-w-[160px]"
                      >
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Radar size={10} className="text-vantage-cyan" />
                          <span className="text-[9px] font-bold text-vantage-cyan">RADAR</span>
                        </div>
                        <p className="text-[10px] text-gray-600 dark:text-gray-300">Top: {leagueRadar.leagues?.[0]?.name || 'N/A'} {leagueRadar.leagues?.[0]?.avgEv}% EV</p>
                      </motion.div>
                    )}
                    {accaCopilot && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="shrink-0 px-3 py-2 rounded-xl bg-purple-500/10 border border-purple-500/20 min-w-[140px]"
                      >
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Layers size={10} className="text-purple-500" />
                          <span className="text-[9px] font-bold text-purple-500">ACCA</span>
                        </div>
                        <p className="text-[10px] text-gray-600 dark:text-gray-300">Tap cards â†“</p>
                      </motion.div>
                    )}
                    {aiLoading && (
                      <div className="shrink-0 flex items-center gap-1.5 px-3 py-2">
                        <Loader2 size={12} className="animate-spin text-vantage-cyan" />
                      </div>
                    )}
                  </div>
                )}

                {/* â”€â”€ Basketball Feed â”€â”€ */}
                {activeSport !== 'football' && (
                  activeAltPredictions && activeAltPredictions.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      <AnimatePresence>
                        {activeAltPredictions.map((match, idx) => {
                          const cat = (match as any).category || 'value';
                          const cfg = CAT_CONFIG[cat as keyof typeof CAT_CONFIG] || CAT_CONFIG.value;
                          return (
                            <motion.div
                              key={match.id}
                              initial={{ opacity: 0, y: 16 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.3, delay: idx * 0.05 }}
                            >
                              <div className={`relative overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-md shadow-lg border-l-4 flex flex-col ${cfg.border}`}>
                                <div className="flex justify-between items-center px-4 pt-4 pb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{activeAltLeagueLabel}</span>
                                    <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.badge}`}>
                                      {cfg.icon} {cfg.label}
                                    </span>
                                  </div>
                                  <span className="text-[10px] font-bold font-mono text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full">{activeAltIcon} {activeAltSportLabel}</span>
                                </div>
                                <div className="flex justify-between items-center px-4 py-3">
                                  <span className="text-xs font-bold text-slate-900 dark:text-white truncate w-5/12">{match.homeTeam}</span>
                                  <div className="flex flex-col items-center shrink-0">
                                    <span className="text-[10px] font-mono text-gray-400">VS</span>
                                    {match.odds > 1 && <span className="text-[10px] font-bold font-mono bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-300">{match.odds.toFixed(2)}x</span>}
                                  </div>
                                  <span className="text-xs font-bold text-slate-900 dark:text-white text-right truncate w-5/12">{match.awayTeam}</span>
                                </div>
                                <div className="mx-4 mb-3 p-3 bg-slate-50 dark:bg-black/30 rounded-xl border border-slate-200 dark:border-white/5">
                                  <div className="flex items-center justify-between">
                                    <div className="flex flex-col flex-1 mr-3">
                                      <span className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Prediction</span>
                                      <span className="text-xs font-bold text-orange-400">{language === 'fr' ? (match as any).prediction_fr : match.prediction}</span>
                                    </div>
                                    <div className="flex flex-col items-center shrink-0">
                                      <span className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Confidence</span>
                                      <span className="text-lg font-bold font-mono text-green-500">{match.confidence}%</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="mx-4 mb-4 p-3 rounded-xl bg-gradient-to-r from-orange-500/5 to-transparent border border-orange-500/15">
                                  <div className="flex items-start gap-2">
                                    <BrainCircuit size={13} className="text-orange-400 mt-0.5 shrink-0" />
                                    <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">
                                      {language === 'fr' ? (match as any).analysis_fr : (match as any).analysis_en}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  ) : (
                    <div className="text-center py-8 rounded-2xl border-2 border-dashed border-slate-200 dark:border-white/10">
                      <span className="text-4xl block mb-2">{activeAltIcon}</span>
                      <p className="text-sm font-medium text-gray-500">No {activeAltSportLabel} value bets found today</p>
                      <p className="text-xs text-gray-400 mt-1">The model only flags genuine +EV edges</p>
                    </div>
                  )
                )}

                {/* â”€â”€ Football Feed â”€â”€ */}
                {activeSport === 'football' && (
                  <>
                    {!quantLoading && quantPredictions.length > 0 && (
                      <>
                        <div className="flex gap-1.5 flex-wrap mb-2">
                          {['All', 'Straight Win', 'Over/Under', 'BTTS', 'Double Chance'].map(tab => (
                            <button
                              key={tab}
                              onClick={() => setQuantBetFilter(tab)}
                              className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${quantBetFilter === tab
                                ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm shadow-emerald-500/30'
                                : 'bg-slate-100 dark:bg-white/5 text-gray-500 border-slate-200 dark:border-white/10 hover:border-emerald-500/50'
                                }`}
                            >{tab}</button>
                          ))}
                        </div>

                        {/* League filter - scrollable horizontal chip row */}
                        {availableLeagues.length > 1 && (
                          <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
                            {availableLeagues.map(league => (
                              <button
                                key={league}
                                onClick={() => setQuantLeagueFilter(league)}
                                className={`px-3 py-1 rounded-full text-[10px] font-bold border whitespace-nowrap shrink-0 transition-all ${
                                  quantLeagueFilter === league
                                    ? 'bg-vantage-cyan text-slate-900 border-vantage-cyan shadow-sm shadow-vantage-cyan/30'
                                    : 'bg-slate-100 dark:bg-white/5 text-gray-500 border-slate-200 dark:border-white/10 hover:border-vantage-cyan/50'
                                }`}
                              >
                                {league === 'All' ? '🌍 All Leagues' : league}
                              </button>
                            ))}
                          </div>
                        )}

                        {(quantBetFilter !== 'All' || quantLeagueFilter !== 'All') && (
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] text-gray-500">
                              Showing <span className="font-bold text-vantage-cyan">{filteredQuantPredictions.length}</span> of {quantPredictions.length} picks
                            </p>
                            <button
                              onClick={() => { setQuantBetFilter('All'); setQuantLeagueFilter('All'); }}
                              className="text-[10px] font-bold text-gray-400 hover:text-vantage-cyan transition-colors underline"
                            >
                              Clear filters
                            </button>
                          </div>
                        )}
                      </>
                    )}

                {quantLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl bg-slate-100 dark:bg-white/5 animate-pulse" />)}
                  </div>
                ) : filteredQuantPredictions.length === 0 ? (
                  <div className="text-center py-8 rounded-2xl border-2 border-dashed border-slate-200 dark:border-white/10">
                    <BarChart2 size={28} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                    <p className="text-sm font-medium text-gray-500">
                      {quantPredictions.length === 0 ? 'Vantage AI analysis runs at 19:00 Lagos time' : 'No bets match this filter'}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">Pure statistical models</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    <AnimatePresence>
                      {filteredQuantPredictions.map((match, idx) => (
                        <MatchCardAlpha
                          key={match.fixture_id ?? String(idx)}
                          match={match}
                          idx={idx}
                          isExpanded={expandedCards.has(String(match.fixture_id || idx))}
                          onToggle={() => {
                            const cardId = String(match.fixture_id || idx);
                            setExpandedCards(prev => {
                              const next = new Set(prev);
                              if (next.has(cardId)) next.delete(cardId);
                              else next.add(cardId);
                              return next;
                            });
                          }}
                          onCopy={handleCopy}
                          copiedId={copiedId}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                )}
                </>
              )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        )}

        {/* â”€â”€ TODAY / TOMORROW DATE TOGGLE â”€â”€ */}
        <div className="flex bg-slate-100 dark:bg-white/5 rounded-xl p-1 border border-slate-200 dark:border-white/10">
          <button
            onClick={() => setPicksDay('today')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all ${picksDay === 'today' ? 'bg-white dark:bg-white/15 shadow text-vantage-cyan' : 'text-gray-500'}`}
          >
            <Zap size={12} /> {language === 'fr' ? "Aujourd'hui" : "Today's Picks"}
          </button>
          <button
            onClick={() => setPicksDay('tomorrow')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all ${picksDay === 'tomorrow' ? 'bg-white dark:bg-white/15 shadow text-vantage-purple' : 'text-gray-500'}`}
          >
            <Calendar size={12} /> {language === 'fr' ? 'Demain' : "Tomorrow"}
          </button>
        </div>

        {picksDay === 'tomorrow' ? (
          <div className="space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2 text-slate-700 dark:text-gray-300">
              <Calendar size={16} className="text-vantage-purple" />
              {language === 'fr' ? "Matchs de Demain" : "Tomorrow's Fixtures"}
              <span className="ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full bg-vantage-purple/15 border border-vantage-purple/30 text-vantage-purple">LIVE DATA</span>
            </h3>
            {tomorrowLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-200 dark:bg-white/5 animate-pulse" />)}
              </div>
            ) : tomorrowFixtures.length === 0 ? (
              <div className="text-center py-10 text-gray-500 text-sm border-2 border-dashed border-slate-200 dark:border-white/10 rounded-2xl">
                <Calendar size={28} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                <p className="font-medium">{language === 'fr' ? "Aucun match prévu pour demain" : "No fixtures yet for tomorrow"}</p>
                <p className="text-xs text-gray-400 mt-1">{language === 'fr' ? "Disponible après 23:00 Lagos" : "Available after 23:00 Lagos time"}</p>
              </div>
            ) : (
              tomorrowFixtures.map((fixture, i) => (
                <motion.div
                  key={fixture.id || i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="p-3.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-gray-500 uppercase truncate max-w-[65%]">{fixture.league}</span>
                    <span className="text-[10px] font-mono text-vantage-purple font-bold">{fixture.time}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-7 h-7 shrink-0 rounded-lg bg-white/10 flex items-center justify-center">
                        <TeamLogo src={fixture.homeTeamLogo} teamName={fixture.homeTeam} className="w-5 h-5" />
                      </div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white truncate">{fixture.homeTeam}</span>
                    </div>
                    <span className="text-[10px] font-bold text-gray-400 shrink-0 px-2 py-0.5 rounded bg-slate-200 dark:bg-white/10">vs</span>
                    <div className="flex items-center gap-2 flex-1 min-w-0 flex-row-reverse">
                      <div className="w-7 h-7 shrink-0 rounded-lg bg-white/10 flex items-center justify-center">
                        <TeamLogo src={fixture.awayTeamLogo} teamName={fixture.awayTeam} className="w-5 h-5" />
                      </div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white truncate text-right">{fixture.awayTeam}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-vantage-purple/15 text-vantage-purple font-bold border border-vantage-purple/30">COMING TOMORROW</span>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        ) : (
          <>
            {/* AI predictions replaced by Vantage Engine - show notice only if no picks loaded yet */}
            {quantPredictions.length === 0 && !quantLoading && (
              <div className="text-center py-10 rounded-2xl border-2 border-dashed border-emerald-500/30 bg-emerald-500/5">
                <BarChart2 size={28} className="mx-auto mb-2 text-emerald-500 opacity-60" />
                <p className="text-sm font-bold text-slate-700 dark:text-gray-300">Model picks appear above</p>
                <p className="text-xs text-gray-500 mt-1">
                  pure statistical model
                  <br />Picks are generated daily at <span className="font-semibold text-emerald-600">19:00 Lagos time</span>.
                </p>
              </div>
            )}
          </>
        )}

        {/* Modal mounts dynamically and handles its own entry/exit */}
        <AccumulatorModal
          isOpen={isAccuOpen}
          onClose={() => setIsAccuOpen(false)}
          accumulators={quantAccumulators}
          initialTier={accuTier}
        />
      </div>
    );
  }

  // --- LOCKED VIEW (Conversion Page) ---
  return (
    <div className="space-y-4 pb-24 relative min-h-screen">
      <div className="flex flex-col space-y-1 relative z-10">
        <h1 className="text-2xl font-bold font-orbitron text-slate-900 dark:text-white">{t('vip.title')} <span className="text-vantage-purple">{t('vip.title_accent')}</span></h1>
        <div className="flex items-center gap-2 text-xs text-vantage-purple font-bold bg-vantage-purple/10 w-fit px-2 py-1 rounded-full border border-vantage-purple/20">
          <Crown size={12} />
          {t('vip.exclusive_community') || 'VIP Exclusive Community'}
        </div>
      </div>

      <div className="absolute top-20 right-0 w-64 h-64 bg-vantage-purple/10 rounded-full blur-[80px] pointer-events-none" />

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="animate-spin text-vantage-purple" size={40} />
        </div>
      ) : !user ? (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <GlassCard className="flex flex-col items-center text-center p-8 border-vantage-purple/20 bg-vantage-purple/5">
            <div className="w-16 h-16 bg-slate-200 dark:bg-white/10 rounded-full flex items-center justify-center mb-4 text-gray-500 dark:text-gray-400">
              <User size={32} />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{t('auth.auth_error') || 'Authentication Required'}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              {t('auth.login_subtitle') || 'Please log in or create an account to view VIP plans and predictions.'}
            </p>
            <button
              onClick={() => navigate('/profile')}
              className="px-6 py-3 bg-vantage-purple hover:bg-purple-600 text-white font-bold rounded-xl transition-all shadow-lg shadow-vantage-purple/20 flex items-center space-x-2"
            >
              <span>{t('auth.login_btn')}</span>
              <ArrowRight size={18} />
            </button>
          </GlassCard>
        </div>
      ) : (
        <>
          {/* PREMIUM HERO TEASER */}
          <div className="relative mb-8 text-center pt-4">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-vantage-cyan/10 border border-vantage-cyan/20 text-vantage-cyan text-[10px] font-bold uppercase tracking-widest mb-4">
              <Activity size={12} /> Institutional Grade Analytics
            </div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-2 leading-tight">
              Unlock the <span className="text-vantage-cyan">Alpha Terminal</span>
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto mb-6">
              Stop guessing. Get access to our quantitative models, live CLV tracking, and +EV betting signals.
            </p>

            <div className="relative mx-auto mb-6 max-w-md overflow-hidden rounded-2xl border border-vantage-cyan/20 bg-slate-950 text-left shadow-2xl shadow-vantage-cyan/10">
              <img
                src="/images/vip-matchday-banner.jpg"
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-slate-950/70" />
              <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/75 to-slate-950/25" />
              <div className="relative z-10 p-5">
                <div className="mb-10 inline-flex items-center gap-2 rounded-full border border-vantage-cyan/30 bg-vantage-cyan/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-vantage-cyan">
                  <Radio size={11} />
                  Matchday Terminal
                </div>
                <div className="max-w-[13rem]">
                  <p className="text-xl font-black leading-tight text-white">
                    Full card, model edge, and staking plan in one view.
                  </p>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {['+EV', 'CLV', 'Kelly'].map(label => (
                      <div key={label} className="rounded-lg border border-white/10 bg-white/10 px-2 py-2 text-center backdrop-blur-sm">
                        <span className="text-[10px] font-black text-white">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div id="plans-section" className="space-y-6">
            <div className="flex flex-col gap-4">
            {plans.filter(p => showAllPlans || ['daily', 'weekly', 'monthly', 'quarterly'].includes(p.id)).map((plan) => {
                const pricing = getPricingForCountry(Number(plan.price), userProfile?.country || 'other');
                const isPopular = plan.id === 'monthly';
                return (
                  <motion.button
                    key={plan.id}
                    onClick={() => handlePlanClick(plan.id as any)}
                    whileTap={{ scale: 0.98 }}
                    className={`
                            relative w-full text-left p-6 rounded-2xl border transition-all duration-300 overflow-hidden group
                            ${plan.color}
                        `}
                  >
                    {/* Badge */}
                    {plan.badge && (
                      <div className={`absolute top-0 right-0 text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-bl-xl z-10
                        ${isPopular ? 'bg-vantage-cyan text-slate-900' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'}
                      `}>
                        {plan.badge}
                      </div>
                    )}

                    <div className="flex justify-between items-start relative z-0">
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${isPopular ? 'bg-vantage-cyan/20 text-vantage-cyan' : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-gray-400'}`}>
                            {plan.icon}
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">{plan.label}</h3>
                          </div>
                        </div>
                        {/* Features */}
                        <div className="flex flex-col gap-2 mt-1">
                          {plan.features.map((feat, idx) => (
                            <span key={idx} className="text-xs flex items-center text-slate-600 dark:text-gray-300">
                              <Check size={12} className={`mr-2 ${isPopular ? 'text-vantage-cyan' : 'text-slate-400'}`} /> {feat}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Pricing */}
                      <div className="flex flex-col items-end">
                        <span className="text-lg md:text-xl font-black font-mono text-slate-900 dark:text-white">
                          {pricing.symbol}{pricing.amount}
                        </span>
                        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                          {pricing.code}
                        </span>
                        
                        <div className={`mt-4 px-4 py-2 rounded-xl font-bold text-xs transition-all ${plan.claimColor}`}>
                          Select Plan
                        </div>
                      </div>
                    </div>
                  </motion.button>
                )
              })}
            </div>

            {/* Show all / collapse plans */}
            <button
              onClick={() => setShowAllPlans(v => !v)}
              className="text-xs font-bold text-gray-400 hover:text-vantage-cyan transition-colors flex items-center justify-center gap-1 py-2"
            >
              {showAllPlans
                ? <><ChevronUp size={12} /> {language === 'fr' ? 'Réduire les plans' : 'Show less'}</>
                : <><ChevronDown size={12} /> {language === 'fr' ? 'Voir tous les plans' : 'See all plans'}</>
              }
            </button>

            {/* Premium Trust Signals */}
            <div className="pt-6 border-t border-slate-200 dark:border-white/10 flex flex-col items-center space-y-4">
              <div className="flex items-center gap-1.5 text-xs text-gray-500 font-medium">
                <ShieldCheck size={14} className="text-emerald-500" />
                <>Secure Checkout via <span className="text-slate-900 dark:text-white font-bold">Google Play</span></>
              </div>
              
              {/* Payment Methods */}
              <div className="flex items-center justify-center gap-2">
                {['Google Play', 'Credit Card', 'Carrier Billing'].map(method => (
                  <div key={method} className="px-2.5 py-1 rounded bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[9px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                    {method}
                  </div>
                ))}
              </div>

              {/* Manual Verification Button */}
              <button
                onClick={handleManualCheck}
                disabled={isVerifying}
                className="text-[10px] text-gray-400 hover:text-vantage-cyan flex items-center justify-center space-x-1 py-2 transition-colors uppercase font-bold tracking-widest mt-4"
              >
                <RefreshCw size={10} className={isVerifying ? "animate-spin" : ""} />
                <span>{language === 'fr' ? "Vérifier l'activation manuellement" : "Verify Activation Manually"}</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Responsible Gambling - required for Play Store compliance */}
      <div className="px-4 pb-6">
        <ResponsibleGambling compact />
      </div>

      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        plan={selectedPlanObj}
        onSuccess={() => console.log("Payment flow completed")}
      />
    </div>
  );
};

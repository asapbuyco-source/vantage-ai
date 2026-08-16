import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Check, ShieldCheck, Zap, Target, Rocket, TrendingUp } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { TeamLogo } from './TeamLogo';

interface AccumulatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  accumulators: Record<string, any[]>;
  initialTier?: string;
}

function getTierMeta(lang: string): Record<string, { label: string; icon: any; color: string; desc: string }> {
  const fr = lang === 'fr';
  return {
    safe_stack: { 
      label: fr ? 'Safe Stack' : 'Safe Stack', 
      icon: ShieldCheck, 
      color: 'text-teal-500', 
      desc: fr ? 'Haute probabilité (85%+)' : 'Highest probability (85%+)' 
    },
    baseline: { 
      label: fr ? 'La Base' : 'The Baseline', 
      icon: ShieldCheck, 
      color: 'text-emerald-500', 
      desc: fr ? 'Triplé haute probabilité' : 'Highest probability treble' 
    },
    alpha_edge: { 
      label: fr ? "L'Avantage Alpha" : 'The Alpha Edge', 
      icon: Zap, 
      color: 'text-vantage-cyan', 
      desc: fr ? 'Meilleure valeur attendue' : 'Highest expected value' 
    },
    syndicate: { 
      label: fr ? 'Le Syndicat' : 'The Syndicate', 
      icon: Target, 
      color: 'text-vantage-purple', 
      desc: fr ? 'Combiné 4 pattes équilibré' : '4-leg balanced combo' 
    },
    variance_play: { 
      label: fr ? 'Jeu de Variance' : 'Variance Play', 
      icon: Rocket, 
      color: 'text-orange-500', 
      desc: fr ? 'Pari audacieux haut rendement' : 'High-yield moonshot' 
    },
  };
}

export const AccumulatorModal: React.FC<AccumulatorModalProps> = ({ isOpen, onClose, accumulators, initialTier = 'baseline' }) => {
  const [activeTier, setActiveTier] = useState<string>(initialTier);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { language } = useAppContext();
  const TIER_META = getTierMeta(language);
  
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && initialTier && TIER_META[initialTier]) {
      setActiveTier(initialTier);
    }
  }, [isOpen, initialTier]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [activeTier]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    if (navigator.vibrate) navigator.vibrate(50);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const activeTicketInfo = (accumulators[activeTier] || [])[0];
  const activeLegs = activeTicketInfo?.legs || [];
  const meta = TIER_META[activeTier];
  const Icon = meta?.icon || ShieldCheck;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {
            // @ts-ignore
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-md"
            />
          }

          <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-10 pointer-events-none">
            {
               // @ts-ignore
               <motion.div
                initial={{ scale: 0.9, opacity: 0, y: -20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: -20 }}
                className="w-full max-w-sm pointer-events-auto bg-white/90 dark:bg-vantage-bg/95 border border-white/20 dark:border-white/10 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-xl flex flex-col max-h-[85dvh]"
              >
                {/* Header */}
                <div className="flex justify-between items-center p-5 border-b border-slate-200 dark:border-white/5 shrink-0">
                  <div>
                    <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold font-orbitron text-slate-900 dark:text-white">Accumulator</h2>
                        <span className="px-2 py-0.5 bg-vantage-purple/20 text-vantage-purple text-[10px] font-bold rounded border border-vantage-purple/30 animate-pulse">
                            AI GEN
                        </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {language === 'fr' ? 'Générateur IA Quant' : 'Quant AI Generator'}
                    </p>
                  </div>
                  <button 
                    onClick={onClose}
                    className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                  >
                    <X size={20} className="text-gray-500 dark:text-gray-400" />
                  </button>
                </div>

                {/* AI Tiers Tabs */}
                <div className="px-4 pt-4 shrink-0 overflow-x-auto scrollbar-none">
                  <div className="flex bg-slate-100 dark:bg-black/40 p-1 rounded-xl w-max min-w-full">
                    {Object.entries(TIER_META).map(([key, config]) => {
                      const isActive = activeTier === key;
                      const TabIcon = config.icon;
                      return (
                        <button
                          key={key}
                          onClick={() => setActiveTier(key)}
                          className={`flex-1 flex items-center justify-center py-2 px-3 rounded-lg text-[10px] sm:text-xs font-bold transition-all duration-300 gap-1.5
                            ${isActive 
                              ? 'bg-white dark:bg-white/10 shadow-sm text-slate-900 dark:text-white' 
                              : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                            }`}
                        >
                          <TabIcon size={14} className={isActive ? config.color : ''} />
                          <span className="whitespace-nowrap">{config.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Ticket Description Area */}
                <div className="px-5 pt-3 pb-2 shrink-0">
                   <div className="flex flex-col">
                     <span className={`text-[10px] font-bold uppercase tracking-widest ${meta.color}`}>{meta.desc}</span>
                     {activeTicketInfo && (
                       <div className="flex items-center gap-2 mt-1">
                         <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${activeTicketInfo.combined_ev > 0 ? 'bg-emerald-500/15 text-emerald-500' : 'bg-orange-500/15 text-orange-500'}`}>
                           EV: {activeTicketInfo.combined_ev > 0 ? '+' : ''}{(activeTicketInfo.combined_ev * 100).toFixed(1)}%
                         </span>
                         {activeTicketInfo.kelly_stake > 0 && (
                           <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500">
                             Kelly: {activeTicketInfo.kelly_stake}%
                           </span>
                         )}
                       </div>
                     )}
                   </div>
                </div>

                {/* Legs List */}
                <div ref={listRef} className="px-4 pb-4 space-y-2 overflow-y-auto flex-1 custom-scrollbar scroll-smooth">
                  {activeLegs.length > 0 ? (
                    activeLegs.map((leg: any, idx: number) => (
                      // @ts-ignore
                      <motion.div 
                        key={idx}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="flex flex-col p-3 rounded-xl border bg-slate-50/50 dark:bg-white/5 border-slate-200 dark:border-white/5"
                      >
<div className="flex justify-between items-center mb-2 border-b border-black/5 dark:border-white/5 pb-2">
                            <div className="flex items-center gap-2 truncate">
                              <TeamLogo src={leg.home_team_logo} teamName={leg.home_team} className="w-5 h-5" />
                              <span className="text-xs font-bold text-slate-700 dark:text-gray-300 truncate font-orbitron">
                                {leg.home_team} vs {leg.away_team}
                              </span>
                              <TeamLogo src={leg.away_team_logo} teamName={leg.away_team} className="w-5 h-5" />
                            </div>
                            <span className="text-[8px] text-gray-500 shrink-0 ml-1">{leg.league}</span>
                            <button
                              onClick={() => handleCopy(`${leg.home_team} vs ${leg.away_team} — ${leg.market} @ ${leg.odds}x`, `leg-${idx}`)}
                              className="ml-2 p-1 rounded bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/20 text-gray-500 dark:text-gray-400 shrink-0"
                            >
                              {copiedId === `leg-${idx}` ? <Check size={10} className="text-green-500"/> : <Copy size={10} />}
                           </button>
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                                <TrendingUp size={12} className={meta.color} />
                                <span className={`text-[11px] font-bold ${meta.color} uppercase tracking-wide truncate max-w-[120px]`}>{leg.market}</span>
                            </div>
                            <div className="px-2 py-0.5 bg-white dark:bg-black/30 rounded border border-slate-200 dark:border-white/5 shrink-0">
                                <span className="text-xs font-bold font-orbitron text-slate-900 dark:text-white">{(leg.odds || 0).toFixed(2)}</span>
                            </div>
                        </div>
                      </motion.div>
                    ))
                  ) : (
                    <div className="text-center py-10 text-gray-400 text-xs">
                      {language === 'fr' ? 'Accumulateur non généré (Pas assez de valeur)' : 'Ticket not generated (Not enough value)'}
                    </div>
                  )}
                </div>

                {/* Footer Totals */}
                <div className="p-4 border-t border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-black/20 shrink-0 flex items-center justify-between">
                    <div>
                        <div className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-0.5">
                           {language === 'fr' ? 'Cote Totale' : 'Total Odds'} ({activeTicketInfo?.leg_count || 0} legs)
                        </div>
                        <div className={`text-2xl font-bold font-orbitron ${meta.color}`}>
                           {(activeTicketInfo?.combined_odds || 0).toFixed(2)}x
                        </div>
                    </div>
                    
                    <div className="flex gap-2">
                    <button 
                        onClick={() => {
                            const text = activeLegs.map((l, i) => 
                                `${i+1}. ${l.home_team} vs ${l.away_team} — ${l.market} @ ${l.odds}x`
                            ).join('\n') + `\n\nTotal Odds: ${activeTicketInfo?.combined_odds?.toFixed(2)}x`;
                            handleCopy(text, 'full-ticket');
                        }}
                        className="px-4 py-2.5 rounded-xl font-bold text-sm bg-vantage-cyan text-white hover:bg-vantage-cyan/90"
                    >
                        {copiedId === 'full-ticket' ? <Check size={16} /> : <Copy size={16} />}
                        <span className="ml-1">{language === 'fr' ? 'Copier Tout' : 'Copy All'}</span>
                    </button>
                    
                    <button 
                        onClick={onClose}
                        className="px-6 py-2.5 rounded-xl font-bold text-sm text-slate-700 dark:text-white bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/20 shadow-sm transition-all active:scale-95"
                    >
                        <span>{language === 'fr' ? 'Fermer' : 'Close'}</span>
                    </button>
                    </div>
                </div>
              </motion.div>
            }
          </div>
        </>
      )}
    </AnimatePresence>
  );
};
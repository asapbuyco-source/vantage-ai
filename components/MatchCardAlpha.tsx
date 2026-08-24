import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, ChevronRight } from 'lucide-react';
import { Match } from '../types';
import { TeamLogo } from './TeamLogo';
import { getTopProbPicks, getSmartBadges, plainMarket } from '../utils';
import { DeepAnalysisModal } from './DeepAnalysisModal';
import { useNavigate } from 'react-router-dom';

interface MatchCardAlphaProps {
  match: Match;
  idx: number;
  isExpanded?: boolean;
  onToggle?: () => void;
  onCopy?: (text: string, id: string) => void;
  copiedId?: string | null;
}

export const MatchCardAlpha: React.FC<MatchCardAlphaProps> = ({ match, idx }) => {
  const navigate = useNavigate();
  const [showDeepAnalysis, setShowDeepAnalysis] = useState(false);
  const xgH = match.expected_goals_home ?? 0;
  const xgA = match.expected_goals_away ?? 0;
  const topPicks = getTopProbPicks(match);
  const displayPickName = topPicks.length > 0
    ? topPicks.map(p => plainMarket(p.name)).join(' / ')
    : plainMarket(match.bet_type || match.prediction);
  const displayPickProb = topPicks.length > 0 ? Math.round(topPicks[0].prob * 100) : (match.confidence ?? 0);
  const badges = getSmartBadges(match).slice(0, 2);

  // Pro-grade metrics — VIP payload only
  const evPct = match.ev_pct ?? (match.expected_value != null ? match.expected_value * 100 : null);
  const kelly = match.kelly_stake ?? null;
  const agreement = Math.round(((match as any).model_agreement ?? match.result_confidence ?? 0) * 100);
  const valueRank = (match as any).value_rank;
  const hasProRow = evPct != null || kelly != null || agreement > 0;

  return (
    <motion.div
      key={match.fixture_id ?? String(idx)}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ delay: idx * 0.05, duration: 0.3 }}
    >
      <div
        onClick={() => navigate(`/match/${match.id || match.fixture_id}`)}
        className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-white/5 backdrop-blur-md shadow-lg cursor-pointer hover:border-vantage-cyan/40 transition-all"
      >
        {/* Header: league + kickoff */}
        <div className="flex items-center justify-between px-4 pt-3">
          <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider truncate max-w-[60%]">
            {match.league}
          </span>
          <span className="flex items-center gap-1 text-[10px] font-semibold text-gray-400">
            <Clock size={11} />
            {match.kickoff_local || match.time}
          </span>
        </div>

        {/* Teams: home vs away with xG divider */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <TeamLogo src={match.home_team_logo || match.homeTeamLogo} teamName={match.home_team || match.homeTeam} className="w-8 h-8 rounded-lg" />
            <span className="text-[13px] font-bold text-slate-900 dark:text-white truncate">
              {match.home_team || match.homeTeam}
            </span>
          </div>

          <div className="flex flex-col items-center shrink-0 mx-2">
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">xG</span>
            <span className="text-[11px] font-mono font-semibold text-gray-500 dark:text-gray-300">
              {xgH.toFixed(1)}–{xgA.toFixed(1)}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
            <span className="text-[13px] font-bold text-slate-900 dark:text-white text-right truncate">
              {match.away_team || match.awayTeam}
            </span>
            <TeamLogo src={match.away_team_logo || match.awayTeamLogo} teamName={match.away_team || match.awayTeam} className="w-8 h-8 rounded-lg" />
          </div>
        </div>

        {/* Insight panel: Vantage's top pick — compact */}
        <div className="mx-3 mb-2 rounded-lg bg-vantage-cyan/5 border border-vantage-cyan/15 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-[8px] font-bold text-vantage-cyan uppercase tracking-widest leading-none">
                Vantage Pick
              </p>
              <p className="text-[12px] font-bold text-slate-900 dark:text-white truncate mt-0.5">
                {displayPickName}
              </p>
            </div>
            <div className="text-right shrink-0 flex items-center gap-2">
              {Number(match.odds) > 1 && (
                <span className="text-[9px] font-mono font-semibold text-gray-400">
                  @{Number(match.odds).toFixed(2)}
                </span>
              )}
              <p className="text-base font-black font-mono text-emerald-400 leading-none">
                {displayPickProb}%
              </p>
            </div>
          </div>
          {/* Confidence bar */}
          <div className="h-[3px] bg-white/5 dark:bg-black/30">
            <div
              className="h-full bg-vantage-cyan transition-all duration-700"
              style={{ width: `${Math.min(100, displayPickProb)}%` }}
            />
          </div>
        </div>

        {/* Pro metrics row — VIP exclusive depth */}
        {hasProRow && (
          <div className="px-4 pb-2.5 -mt-1 flex items-center gap-1.5 flex-wrap">
            {evPct != null && (
              <span className={`text-[9px] font-black font-mono px-1.5 py-0.5 rounded-md ${evPct > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-500/10 text-gray-400'}`}>
                EV {evPct > 0 ? '+' : ''}{evPct.toFixed(1)}%
              </span>
            )}
            {kelly != null && kelly > 0 && (
              <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded-md bg-vantage-purple/10 text-vantage-purple">
                Kelly {kelly.toFixed(1)}%
              </span>
            )}
            {agreement > 0 && (
              <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded-md bg-vantage-cyan/10 text-vantage-cyan">
                Agreement {agreement}%
              </span>
            )}
            {valueRank === 'high' && (
              <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400">
                ★ Top Value
              </span>
            )}
          </div>
        )}

        {/* Smart badges + CTA */}
        <div className="flex items-center justify-between px-4 pb-3">
          <div className="flex gap-1.5 min-w-0">
            {badges.length > 0 ? (
              badges.map((b, i) => (
                <span key={i} className={`text-[9px] font-bold ${b.color} px-1.5 py-0.5 rounded-md bg-white/5 dark:bg-white/[0.04] whitespace-nowrap`}>
                  {b.icon} {b.text}
                </span>
              ))
            ) : (
              <span className="text-[9px] text-gray-400">AI Analysis</span>
            )}
          </div>
          <span className="flex items-center gap-0.5 text-[9px] font-bold text-gray-400 shrink-0">
            Full analysis <ChevronRight size={10} />
          </span>
        </div>
      </div>
      <DeepAnalysisModal match={match} isOpen={showDeepAnalysis} onClose={() => setShowDeepAnalysis(false)} />
    </motion.div>
  );
};

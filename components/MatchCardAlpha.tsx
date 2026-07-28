import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Clock } from 'lucide-react';
import { Match } from '../types';
import { TeamLogo } from './TeamLogo';
import { getTopProbPicks, getSmartBadges } from '../utils';
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

const confidenceStars = (pct: number) => {
  if (pct >= 90) return '★★★★★';
  if (pct >= 80) return '★★★★☆';
  if (pct >= 70) return '★★★☆☆';
  if (pct >= 60) return '★★☆☆☆';
  return '★☆☆☆☆';
};

export const MatchCardAlpha: React.FC<MatchCardAlphaProps> = ({ match, idx }) => {
  const navigate = useNavigate();
  const [showDeepAnalysis, setShowDeepAnalysis] = useState(false);
  const xgH = match.expected_goals_home ?? 0;
  const xgA = match.expected_goals_away ?? 0;
  const topPicks = getTopProbPicks(match);
  const displayPickName = topPicks.length > 0 ? topPicks.map(p => p.name).join(' / ') : (match.bet_type || match.prediction);
  const displayPickProb = topPicks.length > 0 ? Math.round(topPicks[0].prob * 100) : (match.confidence ?? 0);
  const badges = getSmartBadges(match).slice(0, 2);

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
        className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-md shadow-lg cursor-pointer hover:border-emerald-500/30 transition-all"
      >
        {/* Header */}
        <div className="px-3 pt-2 pb-1 flex items-center justify-between">
          <span className="text-[9px] font-bold text-gray-400 uppercase truncate max-w-[120px]">{match.league}</span>
          <span className="text-[9px] text-gray-500"><Clock size={10} className="inline mr-0.5" />{match.kickoff_local || match.time}</span>
        </div>

        {/* Teams */}
        <div className="flex items-center justify-between px-3 py-1">
          <div className="flex items-center gap-1.5 w-5/12">
            <TeamLogo src={match.home_team_logo || match.homeTeamLogo} teamName={match.home_team || match.homeTeam} className="w-6 h-6" />
            <span className="text-[11px] font-bold text-slate-900 dark:text-white truncate">{match.home_team || match.homeTeam}</span>
          </div>
          <span className="text-[9px] font-mono text-gray-500">xG {xgH.toFixed(1)}-{xgA.toFixed(1)}</span>
          <div className="flex items-center gap-1.5 w-5/12 justify-end">
            <span className="text-[11px] font-bold text-slate-900 dark:text-white text-right truncate">{match.away_team || match.awayTeam}</span>
            <TeamLogo src={match.away_team_logo || match.awayTeamLogo} teamName={match.away_team || match.awayTeam} className="w-6 h-6" />
          </div>
        </div>

        {/* Top Pick */}
        <div className="mx-3 mb-2 p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/10 to-teal-500/5 border border-emerald-500/20">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{displayPickName}</p>
              <p className="text-[9px] text-emerald-400 mt-0.5">{confidenceStars(displayPickProb)}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-lg font-black font-mono text-emerald-400">{displayPickProb}%</p>
              {Number(match.odds) > 1 && <p className="text-[9px] font-mono text-gray-400">@{Number(match.odds).toFixed(2)}</p>}
            </div>
          </div>
          {badges.length > 0 && (
            <div className="flex gap-1 mt-1.5">
              {badges.map((b, i) => (
                <span key={i} className={`text-[8px] font-bold ${b.color} px-1 py-0.5 rounded bg-white/5`}>{b.icon} {b.text}</span>
              ))}
            </div>
          )}
        </div>

        {/* Tap indicator */}
        <div className="text-center pb-2">
          <span className="text-[8px] text-gray-500">Tap for full analysis →</span>
        </div>
      </div>
      <DeepAnalysisModal match={match} isOpen={showDeepAnalysis} onClose={() => setShowDeepAnalysis(false)} />
    </motion.div>
  );
};

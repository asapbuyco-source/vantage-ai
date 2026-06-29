import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Clock, Copy, Check, BrainCircuit } from 'lucide-react';
import { Match } from '../types';
import { TeamLogo } from './TeamLogo';

interface MatchCardAlphaProps {
  match: Match;
  idx: number;
  isExpanded: boolean;
  onToggle: () => void;
  onCopy: (text: string, id: string) => void;
  copiedId: string | null;
}

const barGradient = (pct: number, isDark: boolean) => {
  if (pct >= 60) return isDark ? 'bg-gradient-to-r from-emerald-400 to-teal-400' : 'bg-gradient-to-r from-emerald-500 to-teal-500';
  if (pct >= 35) return isDark ? 'bg-gradient-to-r from-yellow-400 to-amber-400' : 'bg-gradient-to-r from-yellow-500 to-amber-500';
  return isDark ? 'bg-gradient-to-r from-slate-500 to-slate-400' : 'bg-gradient-to-r from-slate-400 to-slate-300';
};

export const MatchCardAlpha: React.FC<MatchCardAlphaProps> = ({ match, idx, isExpanded, onToggle, onCopy, copiedId }) => {
  const ev = match.expected_value ?? 0;
  const kelly = match.kelly_stake ?? 0;
  const xgH = match.expected_goals_home ?? 0;
  const xgA = match.expected_goals_away ?? 0;
  const homeProb = (match.home_win_prob ?? 0) * 100;
  const drawProb = (match.draw_prob ?? 0) * 100;
  const awayProb = (match.away_win_prob ?? 0) * 100;
  const over25 = (match.over25_prob ?? 0) * 100;
  const btts = (match.btts_prob ?? 0) * 100;
  const dc1x = ((match.double_chance_1x ?? 0) * 100);
  const dcx2 = ((match.double_chance_x2 ?? 0) * 100);
  const over15 = (match.over15_prob ?? 0) * 100;
  const fhOver05 = (match.fh_over05_prob ?? 0) * 100;
  const fhOver15 = (match.fh_over15_prob ?? 0) * 100;
  const fhBtts = (match.fh_btts_prob ?? 0) * 100;
  const expCorners = match.expected_corners ?? 0;
  const over85C = (match.over85_corners_prob ?? 0) * 100;
  const over95C = (match.over95_corners_prob ?? 0) * 100;
  const evColor = ev >= 0.10 ? 'text-emerald-400' : ev >= 0.05 ? 'text-yellow-400' : 'text-orange-400';

  const topScorelines = match.top_scorelines;
  const topScore = topScorelines?.[0];

  return (
    <motion.div
      key={match.fixture_id ?? String(idx)}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ delay: idx * 0.05, duration: 0.3 }}
    >
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-md shadow-lg h-full flex flex-col">
        {/* ── Header: league, badge, time, expand button ── */}
        <div className="px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest truncate max-w-[80px]">{match.league}</span>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 shrink-0">VANTAGE</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[9px] text-gray-400 flex items-center gap-0.5 shrink-0"><Clock size={9} />{match.kickoff_local || match.time}</span>
            {(match as any).value_rank === 'high' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
            <button
              onClick={onToggle}
              className={`flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-bold transition-all ${
                isExpanded
                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                  : 'bg-slate-100 dark:bg-white/10 text-gray-500 hover:bg-emerald-500/20 hover:text-emerald-600'
              }`}
            >
              {isExpanded ? 'Hide' : 'Analysis'}
              <ChevronDown size={10} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        {/* ── Teams row ── */}
        <div className="flex items-center justify-between px-3 pb-2">
          <div className="flex items-center gap-1.5 w-5/12 min-w-0">
            <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center border border-slate-200 dark:border-white/5 shrink-0">
              <TeamLogo src={match.home_team_logo || match.homeTeamLogo} teamName={match.home_team || match.homeTeam} className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-bold text-slate-900 dark:text-white truncate">{match.home_team || match.homeTeam}</span>
          </div>
          <div className="flex flex-col items-center shrink-0">
            <span className="text-[8px] font-mono text-gray-400">VS</span>
            {xgH > 0 && <span className="text-[7px] font-mono text-gray-500">xG {xgH.toFixed(1)}-{xgA.toFixed(1)}</span>}
          </div>
          <div className="flex items-center justify-end gap-1.5 w-5/12 min-w-0">
            <span className="text-[11px] font-bold text-slate-900 dark:text-white text-right truncate">{match.away_team || match.awayTeam}</span>
            <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center border border-slate-200 dark:border-white/5 shrink-0">
              <TeamLogo src={match.away_team_logo || match.awayTeamLogo} teamName={match.away_team || match.awayTeam} className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* ── Top Prediction (always visible, highlighted) ── */}
        <div className="mx-3 mb-2 p-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
          <div className="flex items-center justify-between">
            <div className="flex flex-col min-w-0 mr-2">
              <span className="text-[8px] text-gray-500 uppercase tracking-wide">Top Pick</span>
              <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 truncate" title={match.bet_type || match.prediction}>
                {match.bet_type || match.prediction}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-full bg-black/5 dark:bg-white/10 ${evColor}`}>
                +{(match.ev_pct ?? (ev * 100)).toFixed(1)}%
              </span>
              <span className="text-xs font-bold font-mono text-green-400">{match.confidence ?? Math.round((match.probability ?? 0) * 100)}%</span>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {Number(match.odds) > 1 && (
              <span className="text-[9px] font-mono text-gray-500 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded">{Number(match.odds).toFixed(2)}x</span>
            )}
            {kelly > 0 && (
              <span className="text-[9px] font-mono text-blue-400 bg-blue-500/5 px-1.5 py-0.5 rounded">Kelly {kelly.toFixed(1)}%</span>
            )}
            {match.vault_eligible && (
              <span className="text-[9px] font-bold text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded">Vault</span>
            )}
          </div>
        </div>

        {/* ── AI Verdict ── */}
        {(match as any).analysis_en && (
          <div className="mx-3 mb-2 p-2.5 rounded-xl bg-gradient-to-r from-cyan-500/5 to-blue-500/5 border border-cyan-500/20">
            <div className="flex items-center gap-1.5 mb-1.5">
              <BrainCircuit size={10} className="text-cyan-500" />
              <span className="text-[8px] text-cyan-500 uppercase tracking-wide font-bold">AI Verdict</span>
            </div>
            <p className="text-[9px] text-gray-600 dark:text-gray-300 leading-relaxed">
              {(match as any).analysis_en}
            </p>
          </div>
        )}

        {/* ── Expandable Analysis ── */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mx-3 mb-3 p-3 bg-slate-50 dark:bg-black/30 rounded-xl border border-slate-200 dark:border-white/5 space-y-3">
                
                {/* ── 1X2 Probability Bars ── */}
                <div className="space-y-1.5">
                  <span className="text-[8px] text-gray-500 uppercase tracking-wide">Match Result</span>
                  {[
                    { label: match.home_team || 'Home', pct: homeProb, align: 'left' },
                    { label: 'Draw', pct: drawProb, align: 'center' },
                    { label: match.away_team || 'Away', pct: awayProb, align: 'right' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className={`text-[9px] font-bold text-gray-500 w-14 ${item.align === 'right' ? 'text-right' : item.align === 'center' ? 'text-center' : ''}`}>
                        {item.label.length > 7 ? item.label.slice(0, 7) : item.label}
                      </span>
                      <div className="flex-1 h-2 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
                        <motion.div
                          className={`h-full rounded-full ${barGradient(item.pct, true)}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${item.pct}%` }}
                          transition={{ duration: 0.6, delay: 0.1 * i }}
                        />
                      </div>
                      <span className="text-[9px] font-mono font-bold text-gray-600 dark:text-gray-300 w-8 text-right">{item.pct.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>

                {/* ── More Markets Grid ── */}
                <div>
                  <span className="text-[8px] text-gray-500 uppercase tracking-wide">Markets</span>
                  <div className="grid grid-cols-3 gap-1.5 mt-1">
                    {[
                      { label: 'Over 2.5', pct: over25 },
                      { label: 'BTTS', pct: btts },
                      { label: 'O 1.5', pct: over15 },
                      { label: 'DC 1X', pct: dc1x },
                      { label: 'DC X2', pct: dcx2 },
                      { label: topScore ? `CS ${topScore.score}` : 'Score', pct: topScore ? topScore.prob * 100 : 0 },
                    ].map((mkt, i) => (
                      <div key={i} className="flex flex-col items-center justify-center px-1 py-1.5 bg-white/50 dark:bg-white/5 rounded-lg">
                        <span className="text-[8px] font-medium text-gray-500 dark:text-gray-400">{mkt.label}</span>
                        <span className={`text-[10px] font-bold font-mono ${mkt.pct >= 60 ? 'text-emerald-400' : mkt.pct >= 40 ? 'text-yellow-400' : 'text-slate-500'}`}>
                          {i === 5 && topScore ? `${(topScore.prob * 100).toFixed(1)}%` : `${mkt.pct.toFixed(0)}%`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── First Half Markets ── */}
                <div>
                  <span className="text-[8px] text-gray-500 uppercase tracking-wide">First Half</span>
                  <div className="grid grid-cols-3 gap-1.5 mt-1">
                    {[
                      { label: 'O 0.5 FH', pct: fhOver05 },
                      { label: 'O 1.5 FH', pct: fhOver15 },
                      { label: 'BTTS FH', pct: fhBtts },
                    ].map((mkt, i) => (
                      <div key={i} className="flex flex-col items-center justify-center px-1 py-1.5 bg-white/50 dark:bg-white/5 rounded-lg">
                        <span className="text-[8px] font-medium text-gray-500 dark:text-gray-400">{mkt.label}</span>
                        <span className={`text-[10px] font-bold font-mono ${mkt.pct >= 60 ? 'text-emerald-400' : mkt.pct >= 40 ? 'text-yellow-400' : 'text-slate-500'}`}>
                          {mkt.pct.toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Corners ── */}
                {expCorners > 0 && (
                <div>
                  <span className="text-[8px] text-gray-500 uppercase tracking-wide">Corners ~{expCorners.toFixed(1)}</span>
                  <div className="grid grid-cols-2 gap-1.5 mt-1">
                    {[
                      { label: 'Over 8.5', pct: over85C },
                      { label: 'Over 9.5', pct: over95C },
                    ].map((mkt, i) => (
                      <div key={i} className="flex items-center justify-between px-2 py-1 bg-white/50 dark:bg-white/5 rounded-lg">
                        <span className="text-[8px] font-medium text-gray-500 dark:text-gray-400">{mkt.label}</span>
                        <span className={`text-[10px] font-bold font-mono ${mkt.pct >= 60 ? 'text-emerald-400' : mkt.pct >= 40 ? 'text-yellow-400' : 'text-slate-500'}`}>
                          {mkt.pct.toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                )}

                {/* ── Most Likely Scorelines ── */}
                {topScorelines && topScorelines.length > 0 && (
                  <div>
                    <span className="text-[8px] text-gray-500 uppercase tracking-wide">Most Likely Score</span>
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      {topScorelines.map((s, i) => (
                        <span key={i} className="text-[9px] font-mono font-bold px-2 py-1 rounded-lg bg-white/50 dark:bg-white/5 border border-slate-200 dark:border-white/5">
                          {s.score} <span className="text-gray-400 font-normal">{(s.prob * 100).toFixed(1)}%</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Copy button ── */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopy(`${match.home_team || match.homeTeam} vs ${match.away_team || match.awayTeam} — ${match.bet_type || match.prediction}`, match.id);
                  }}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white/50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[9px] font-bold text-gray-500 hover:text-emerald-500 hover:border-emerald-500/30 transition-colors"
                >
                  {copiedId === match.id ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                  {copiedId === match.id ? 'Copied' : 'Copy Pick'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

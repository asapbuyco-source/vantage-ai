import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Users, User, ArrowUpRight, ShieldAlert } from 'lucide-react';
import { TeamLogo } from './TeamLogo';
import { PlayerAvatar } from './intel/PlayerAvatar';
import { getFixtureLineupsFromDB, LineupPlayer } from '../services/sportsData';
import { findTeamByName, fetchSquadPlayers } from '../services/intelligence/db';
import { TeamIntelligence, PlayerIntelligence } from '../services/intelligence/types';

interface TeamDetailSheetProps {
  open: boolean;
  onClose: () => void;
  teamName: string;
  side: 'home' | 'away';
  teamLogo?: string;
  fixtureId?: number | string;
}

/**
 * Bottom sheet: tap a team crest on MatchDetails to see lineups +
 * intelligence key players. Honest fallbacks when data is missing.
 */
export const TeamDetailSheet: React.FC<TeamDetailSheetProps> = ({
  open, onClose, teamName, side, teamLogo, fixtureId,
}) => {
  const [lineup, setLineup] = useState<LineupPlayer[] | null>(null);
  const [lineupLoading, setLineupLoading] = useState(false);
  const [intelTeam, setIntelTeam] = useState<TeamIntelligence | null>(null);
  const [keyPlayers, setKeyPlayers] = useState<PlayerIntelligence[]>([]);

  useEffect(() => {
    if (!open || !teamName) return;
    let mounted = true;
    setLineup(null);
    setLineupLoading(true);
    setIntelTeam(null);
    setKeyPlayers([]);

    const fid = Number(fixtureId) || 0;
    Promise.all([
      fid ? getFixtureLineupsFromDB(fid) : null,
      findTeamByName(teamName),
    ]).then(([lineupData, intel]) => {
      if (!mounted) return;
      setLineup(lineupData ? (side === 'home' ? lineupData.home : lineupData.away) : null);
      setLineupLoading(false);
      if (intel?.team) {
        setIntelTeam(intel.team);
        fetchSquadPlayers(intel.team.team_id).then(ps => { if (mounted) setKeyPlayers(ps.slice(0, 5)); });
      }
    }).catch(() => { if (mounted) setLineupLoading(false); });

    return () => { mounted = false; };
  }, [open, teamName, side, fixtureId]);

  const starters = lineup?.slice(0, 11) ?? [];
  const subs = lineup?.slice(11) ?? [];
  const accent = side === 'home' ? '#22d3ee' : '#a855f7';

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed bottom-0 left-0 right-0 z-[71] max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-vantage-bg"
          >
            {/* Grab handle */}
            <div className="sticky top-0 z-10 flex justify-center pt-2.5 pb-1 bg-vantage-bg/95 backdrop-blur-md">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            <button onClick={onClose} className="absolute right-4 top-4 p-2 rounded-lg bg-white/5 hover:bg-white/10">
              <X size={16} />
            </button>

            {/* Club header */}
            <div className="flex items-center gap-3 px-5 pt-4 pb-4 border-b border-white/10">
              <TeamLogo src={teamLogo} teamName={teamName} className="w-14 h-14 rounded-xl" />
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-black truncate">{teamName}</h2>
                <p className="text-[11px] text-gray-500">{side === 'home' ? 'Home side' : 'Away side'}</p>
              </div>
              {intelTeam && (
                <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-vantage-cyan/15 text-vantage-cyan border border-vantage-cyan/30 shrink-0">INTEL</span>
              )}
            </div>

            <div className="px-5 py-4 space-y-5">
              {/* Lineup */}
              <section>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2.5 flex items-center gap-1.5">
                  <Users size={12} /> Lineup
                </h3>
                {lineupLoading ? (
                  <div className="space-y-1.5">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="h-8 rounded-lg bg-white/5 animate-pulse" />
                    ))}
                  </div>
                ) : starters.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/15 px-4 py-6 text-center">
                    <ShieldAlert size={20} className="mx-auto text-gray-600 mb-1.5" />
                    <p className="text-xs font-semibold text-gray-400">Lineup unavailable</p>
                    <p className="text-[9px] text-gray-600 mt-0.5">Published lineups will appear here once confirmed.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <p className="text-[9px] uppercase tracking-widest text-gray-500 mb-1.5">Starting XI</p>
                      <div className="space-y-1">
                        {starters.map((p: any, i: number) => (
                          <div key={i} className="flex items-center gap-2.5 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                            <span className="w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center text-[9px] font-black font-mono text-gray-300 shrink-0">
                              {p.number ?? '–'}
                            </span>
                            <span className="text-xs font-semibold text-white truncate flex-1">{p.name}</span>
                            {p.position && <span className="text-[9px] font-bold text-gray-500 shrink-0">{p.position}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                    {subs.length > 0 && (
                      <div>
                        <p className="text-[9px] uppercase tracking-widest text-gray-500 mb-1.5">Substitutes</p>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                          {subs.map((p: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-[10px] text-gray-400">
                              <span className="font-mono text-gray-600 w-4">{p.number ?? '–'}</span>
                              <span className="truncate">{p.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Key players from intelligence DB */}
              {keyPlayers.length > 0 && (
                <section>
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2.5 flex items-center gap-1.5">
                    <User size={12} /> Key Players — Season Intelligence
                  </h3>
                  <div className="space-y-1.5">
                    {keyPlayers.map(p => (
                      <button
                        key={p.player_id}
                        onClick={(e) => { e.stopPropagation(); window.location.hash = ''; window.open(`/intel/player/${p.player_id}`, '_self'); }}
                        className="w-full flex items-center justify-between rounded-lg bg-white/[0.03] hover:border-vantage-cyan/30 border border-white/5 transition-colors px-2.5 py-1.5 text-left"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <PlayerAvatar playerId={p.player_id} name={p.player_name} size={28} />
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-white truncate">{p.player_name}</p>
                            <p className="text-[9px] text-gray-500">{p.position} · {Math.round(p.minutes_played)} mins</p>
                          </div>
                        </div>
                        <span className={`text-[13px] font-black font-mono shrink-0 ml-2 ${(p.scores?.vpii ?? 0) >= 65 ? 'text-emerald-400' : (p.scores?.vpii ?? 0) >= 45 ? 'text-amber-400' : 'text-red-400'}`}>
                          {p.scores?.vpii != null ? Math.round(p.scores.vpii) : '—'}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Full report link */}
              {intelTeam && (
                <a
                  href={`/intel/team/${intelTeam.team_id}`}
                  className="flex items-center justify-between rounded-xl px-4 py-3 border transition-colors"
                  style={{ borderColor: `${accent}33`, background: `${accent}0D` }}
                >
                  <span className="text-xs font-bold" style={{ color: accent }}>Open full intelligence report</span>
                  <ArrowUpRight size={14} style={{ color: accent }} />
                </a>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

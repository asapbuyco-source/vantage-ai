import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrainCircuit, Swords, ChevronDown, ChevronUp, ArrowUpRight } from 'lucide-react';
import { TeamIntelligence, TEAM_DIMENSIONS, TeamDimensionKey } from '../../services/intelligence/types';
import { findTeamByName, fetchSquadPlayers } from '../../services/intelligence/db';
import { getScoreLabel } from '../../services/intelligence/stats';
import { ScoreRing } from './ScoreRing';
import { RadarCompare, RadarLegend } from './RadarCompare';
import { TugOfWar } from './TugOfWar';
import { PlayerAvatar } from './PlayerAvatar';

interface TeamStrengthSectionProps {
  homeTeamName: string;
  awayTeamName: string;
}

const HOME = '#22d3ee';
const AWAY = '#a855f7';

export const TeamStrengthSection: React.FC<TeamStrengthSectionProps> = ({ homeTeamName, awayTeamName }) => {
  const navigate = useNavigate();
  const [home, setHome] = useState<TeamIntelligence | null>(null);
  const [away, setAway] = useState<TeamIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [showFullSquad, setShowFullSquad] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([findTeamByName(homeTeamName), findTeamByName(awayTeamName)])
      .then(([h, a]) => {
        if (!mounted) return;
        setHome(h?.team ?? null);
        setAway(a?.team ?? null);
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [homeTeamName, awayTeamName]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <BrainCircuit size={16} className="text-vantage-cyan" />
          <span className="text-xs font-bold uppercase tracking-widest text-gray-300">Team Strength</span>
        </div>
        <div className="flex justify-center gap-8">
          <div className="w-24 h-24 rounded-full bg-white/5 animate-pulse" />
          <div className="w-24 h-24 rounded-full bg-white/5 animate-pulse" />
        </div>
        <p className="text-center text-[10px] text-gray-500 mt-4">Matching clubs in intelligence database…</p>
      </div>
    );
  }

  // Both teams must have coverage — honesty rule: never fabricate
  if (!home || !away || home.scores?.vti == null || away.scores?.vti == null) {
    return null;
  }

  const homeVti = home.scores.vti;
  const awayVti = away.scores.vti;
  const adv = Math.round(Math.abs(homeVti - awayVti));
  const advLeader = homeVti >= awayVti ? 'home' : 'away';

  const radarData = TEAM_DIMENSIONS.map(({ key, label }) => ({
    dimension: label,
    value: home.scores[key as TeamDimensionKey],
    value2: away.scores[key as TeamDimensionKey],
  }));

  const tugRows = [
    { label: 'Attack', homeValue: home.scores.attacking, awayValue: away.scores.attacking },
    { label: 'Creation', homeValue: home.scores.creation, awayValue: away.scores.creation },
    { label: 'Progression', homeValue: home.scores.progression, awayValue: away.scores.progression },
    { label: 'Defense', homeValue: home.scores.defensive, awayValue: away.scores.defensive },
    { label: 'Possession', homeValue: home.scores.possession_value, awayValue: away.scores.possession_value },
  ];

  const rawStatsRows = [
    { label: 'xG For /90', h: home.raw_stats?.xg_per90, a: away.raw_stats?.xg_per90, betterIs: 'higher' as const },
    { label: 'xG Against /90', h: home.raw_stats?.xga_per90, a: away.raw_stats?.xga_per90, betterIs: 'lower' as const },
    { label: 'Shots /90', h: home.raw_stats?.shots_per90, a: away.raw_stats?.shots_per90, betterIs: 'higher' as const },
    { label: 'xA /90', h: home.raw_stats?.xa_per90, a: away.raw_stats?.xa_per90, betterIs: 'higher' as const },
    { label: 'Key Passes /90', h: home.raw_stats?.key_passes_per90, a: away.raw_stats?.key_passes_per90, betterIs: 'higher' as const },
    { label: 'SCA /90', h: home.raw_stats?.sca_per90, a: away.raw_stats?.sca_per90, betterIs: 'higher' as const },
    { label: 'PPDA (press)', h: home.raw_stats?.ppda, a: away.raw_stats?.ppda, betterIs: 'lower' as const },
    { label: 'Prog. Passes /90', h: home.raw_stats?.prog_passes_per90, a: away.raw_stats?.prog_passes_per90, betterIs: 'higher' as const },
    { label: 'Prog. Carries /90', h: home.raw_stats?.prog_carries_per90, a: away.raw_stats?.prog_carries_per90, betterIs: 'higher' as const },
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-vantage-cyan/20 bg-white/5 backdrop-blur-md shadow-lg">
      <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-vantage-cyan/50 to-transparent pointer-events-none" />

      {/* Section header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <BrainCircuit size={16} className="text-vantage-cyan" />
          <span className="text-xs font-bold uppercase tracking-widest text-gray-200">Team Strength</span>
          <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-vantage-cyan/15 text-vantage-cyan border border-vantage-cyan/30">INTEL</span>
        </div>
        <button onClick={() => setExpanded(v => !v)} className="text-[10px] font-bold text-gray-400 flex items-center gap-1 hover:text-vantage-cyan transition-colors">
          {expanded ? 'Less' : 'Deep dive'}
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {/* Hero: dual rings + advantage */}
      <div className="flex items-center justify-center gap-6 px-4 pb-4">
        <button
          onClick={(e) => { e.stopPropagation(); navigate(`/intel/team/${home.team_id}`); }}
          className="flex flex-col items-center gap-1 w-28 group"
        >
          <ScoreRing score={homeVti} size={92} fontSize={26} accentColor={HOME} />
          <span className="text-[11px] font-bold text-white truncate max-w-full flex items-center gap-0.5">
            {home.team_name}
            <ArrowUpRight size={9} className="opacity-0 group-hover:opacity-100 transition-opacity text-vantage-cyan" />
          </span>
          <span className="text-[9px] text-gray-400">{getScoreLabel(homeVti)}</span>
          <span className="text-[8px] font-bold uppercase tracking-widest text-vantage-cyan/70 group-hover:text-vantage-cyan transition-colors">Full report →</span>
        </button>

        <div className="flex flex-col items-center gap-1 shrink-0 px-2">
          <span
            className="text-sm font-black font-mono px-2.5 py-1 rounded-lg border"
            style={{
              color: advLeader === 'home' ? HOME : AWAY,
              borderColor: advLeader === 'home' ? `${HOME}44` : `${AWAY}44`,
              background: advLeader === 'home' ? `${HOME}11` : `${AWAY}11`,
            }}
          >
            +{adv}
          </span>
          <span className="text-[8px] font-bold uppercase tracking-widest text-gray-500">Advantage</span>
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); navigate(`/intel/team/${away.team_id}`); }}
          className="flex flex-col items-center gap-1 w-28 group"
        >
          <ScoreRing score={awayVti} size={92} fontSize={26} accentColor={AWAY} />
          <span className="text-[11px] font-bold text-white truncate max-w-full flex items-center gap-0.5">
            {away.team_name}
            <ArrowUpRight size={9} className="opacity-0 group-hover:opacity-100 transition-opacity text-vantage-purple" />
          </span>
          <span className="text-[9px] text-gray-400">{getScoreLabel(awayVti)}</span>
          <span className="text-[8px] font-bold uppercase tracking-widest text-vantage-purple/70 group-hover:text-vantage-purple transition-colors">Full report →</span>
        </button>
      </div>

      {/* Deep-dive content */}
      {expanded && (
        <div className="border-t border-white/10 space-y-5 px-4 py-4">
          {/* Radar overlay */}
          <section>
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Shape of the Matchup</h4>
            <div className="flex justify-center">
              <RadarCompare
                data={radarData}
                size={250}
                primaryColor={HOME}
                secondaryColor={AWAY}
                primaryName={home.team_name}
                secondaryName={away.team_name}
              />
            </div>
            <RadarLegend primaryColor={HOME} secondaryColor={AWAY} primaryName={home.team_name} secondaryName={away.team_name} />
          </section>

          {/* Tug-of-war dimensions */}
          <section>
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Dimension Battle</h4>
            <TugOfWar rows={tugRows} homeColor={HOME} awayColor={AWAY} />
          </section>

          {/* Raw stats comparison table */}
          <section>
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Raw Metrics (per 90)</h4>
            <div className="rounded-xl overflow-hidden border border-white/10">
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr className="bg-white/[0.04] text-gray-400">
                    <th className="text-left py-1.5 px-2 font-bold" style={{ color: HOME }}>{home.team_name}</th>
                    <th className="text-center py-1.5 px-2 font-bold uppercase tracking-wider text-[8px]">Metric</th>
                    <th className="text-right py-1.5 px-2 font-bold" style={{ color: AWAY }}>{away.team_name}</th>
                  </tr>
                </thead>
                <tbody>
                  {rawStatsRows.map(row => {
                    const hasH = row.h != null;
                    const hasA = row.a != null;
                    let hBetter: boolean | null = null;
                    if (hasH && hasA && row.h != null && row.a != null && row.h !== row.a) {
                      hBetter = row.betterIs === 'lower' ? row.h < row.a : row.h > row.a;
                    }
                    return (
                      <tr key={row.label} className="border-t border-white/5">
                        <td className={`py-1.5 px-2 text-right ${hBetter === true ? 'font-black text-white' : 'text-gray-300'}`}>
                          {row.h != null ? row.h.toFixed(2) : '—'}{hBetter === true && ' ◀'}
                        </td>
                        <td className="py-1.5 px-2 text-center text-[8px] uppercase tracking-wider text-gray-400">{row.label}</td>
                        <td className={`py-1.5 px-2 ${hBetter === false ? 'font-black text-white' : 'text-gray-300'}`}>
                          {hBetter === false && '▶ '}{row.a != null ? row.a.toFixed(2) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Squad strength preview */}
          <SquadPreview teamId={home.team_id} teamName={home.team_name} accent={HOME} />

          {/* Data provenance */}
          <p className="text-[9px] text-gray-600 leading-relaxed">
            Intelligence scores are z-score normalized against league baselines (50 = average). Season aggregates from Understat/FBref via Vantage Intelligence. Model estimate — not a guarantee.
          </p>
        </div>
      )}
    </div>
  );
};

/** Top squad players by VPII for one team */
const SquadPreview: React.FC<{ teamId: string; teamName: string; accent: string }> = ({ teamId, teamName, accent }) => {
  const navigate = useNavigate();
  const [players, setPlayers] = useState<any[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetchSquadPlayers(teamId).then(p => { if (mounted) setPlayers(p); });
    return () => { mounted = false; };
  }, [teamId]);

  if (!players || players.length === 0) return null;

  const visible = showAll ? players : players.slice(0, 5);

  return (
    <section>
      <div className="flex items-center gap-1.5 mb-2">
        <Swords size={11} style={{ color: accent }} />
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Key Players — {teamName}</h4>
      </div>
      <div className="space-y-1.5">
        {visible.map(p => (
          <button
            key={p.player_id}
            onClick={(e) => { e.stopPropagation(); navigate(`/intel/player/${p.player_id}`); }}
            className="w-full flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/5 hover:border-vantage-cyan/30 transition-colors px-2.5 py-1.5 text-left"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <PlayerAvatar playerId={p.player_id} name={p.player_name} size={28} />
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-white truncate">{p.player_name}</p>
                <p className="text-[9px] text-gray-500">{p.position} · {Math.round(p.minutes_played)} mins</p>
              </div>
            </div>
            <div className="text-right shrink-0 ml-2">
              <span className="text-[13px] font-black font-mono" style={{ color: p.scores?.vpii != null && p.scores.vpii >= 65 ? '#10B981' : p.scores?.vpii != null && p.scores.vpii >= 45 ? '#D97706' : '#DC2626' }}>
                {p.scores?.vpii != null ? Math.round(p.scores.vpii) : '—'}
              </span>
              <p className="text-[7px] uppercase tracking-widest text-gray-500">VPII</p>
            </div>
          </button>
        ))}
      </div>
      {players.length > 5 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="mt-2 text-[10px] font-bold text-vantage-cyan/70 hover:text-vantage-cyan transition-colors"
        >
          {showAll ? 'Show less' : `Show all ${players.length} players`}
        </button>
      )}
    </section>
  );
};

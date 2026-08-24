import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, BrainCircuit, Users, RefreshCw } from 'lucide-react';
import { fetchTeamById, fetchSquadPlayers } from '../services/intelligence/db';
import { TeamIntelligence, PlayerIntelligence, TEAM_DIMENSIONS } from '../services/intelligence/types';
import { getScoreLabel, leaguePercentile } from '../services/intelligence/stats';
import { ScoreRing } from '../components/intel/ScoreRing';
import { RadarCompare, RadarLegend } from '../components/intel/RadarCompare';
import { PercentileBar } from '../components/intel/PercentileBar';
import { PlayerAvatar } from '../components/intel/PlayerAvatar';
import { TeamCrest } from '../components/intel/TeamCrest';
import { TeamLogo } from '../components/TeamLogo';

const ACCENT = '#22d3ee';

export const IntelligenceTeam: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [team, setTeam] = useState<TeamIntelligence | null>(null);
  const [squad, setSquad] = useState<PlayerIntelligence[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    setLoading(true);
    Promise.all([fetchTeamById(id), fetchSquadPlayers(id)])
      .then(([t, s]) => {
        if (!mounted) return;
        setTeam(t?.team ?? null);
        setSquad(s);
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [id]);

  const vti = team?.scores?.vti ?? null;

  const radarData = team
    ? TEAM_DIMENSIONS.map(({ key, label }) => ({ dimension: label, value: (team.scores as any)[key] }))
    : [];

  const rawRows = team ? [
    { label: 'xG For /90', v: team.raw_stats?.xg_per90 },
    { label: 'xG Against /90', v: team.raw_stats?.xga_per90 },
    { label: 'Shots /90', v: team.raw_stats?.shots_per90 },
    { label: 'xA /90', v: team.raw_stats?.xa_per90 },
    { label: 'Key Passes /90', v: team.raw_stats?.key_passes_per90 },
    { label: 'SCA /90', v: team.raw_stats?.sca_per90 },
    { label: 'PPDA (press)', v: team.raw_stats?.ppda },
    { label: 'Prog. Passes /90', v: team.raw_stats?.prog_passes_per90 },
    { label: 'Prog. Carries /90', v: team.raw_stats?.prog_carries_per90 },
    { label: 'Pressures /90', v: team.raw_stats?.pressures_per90 },
    { label: 'Tackles /90', v: team.raw_stats?.tackles_per90 },
    { label: 'Interceptions /90', v: team.raw_stats?.interceptions_per90 },
  ] : [];

  return (
    <div className="min-h-screen bg-vantage-bg pb-20 font-sans text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-vantage-bg/95 backdrop-blur-md border-b border-white/10">
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <BrainCircuit size={16} className="text-vantage-cyan" />
            <h1 className="text-sm font-bold">Team Intelligence</h1>
            <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-vantage-cyan/15 text-vantage-cyan border border-vantage-cyan/30">INTEL</span>
          </div>
          <div className="w-9" />
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <RefreshCw size={28} className="animate-spin text-vantage-cyan" />
          <p className="text-xs text-gray-500">Loading intelligence report…</p>
        </div>
      ) : !team || vti == null ? (
        <div className="flex flex-col items-center justify-center py-24 px-6 text-center gap-3">
          <BrainCircuit size={40} className="text-gray-600" />
          <h2 className="text-base font-bold">No intelligence coverage</h2>
          <p className="text-xs text-gray-500 max-w-xs">
            This club isn't in the Vantage Intelligence database yet. Coverage spans Big-5 leagues + 23 competitions.
          </p>
        </div>
      ) : (
        <div className="p-4 space-y-5 max-w-lg mx-auto">
          {/* Hero */}
          <div className="relative overflow-hidden rounded-2xl border border-vantage-cyan/20 bg-white/5 backdrop-blur-md p-5">
            <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-vantage-cyan/50 to-transparent pointer-events-none" />
            <div className="flex items-center gap-4 mb-4">
              <TeamCrest teamName={team.team_name} teamId={team.team_id} size={56} />
              <div className="min-w-0">
                <h2 className="text-lg font-black leading-tight truncate">{team.team_name}</h2>
                <p className="text-[11px] text-gray-400">{team.league} · {team.season}</p>
                <span className={`inline-block mt-1 text-[9px] font-bold px-2 py-0.5 rounded-full ${vti >= 65 ? 'bg-emerald-500/15 text-emerald-400' : vti >= 45 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'}`}>
                  {getScoreLabel(vti)} · P{leaguePercentile(vti)}
                </span>
              </div>
              <div className="ml-auto shrink-0">
                <ScoreRing score={vti} size={84} fontSize={26} accentColor={ACCENT} />
              </div>
            </div>

            {/* Dimension radar */}
            <div className="flex justify-center">
              <RadarCompare data={radarData} size={240} primaryColor={ACCENT} primaryName={team.team_name} secondaryName={undefined} />
            </div>
            <RadarLegend primaryColor={ACCENT} primaryName={team.team_name} secondaryName={undefined} />
          </div>

          {/* Dimension bars */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Dimension Scores</h3>
            {TEAM_DIMENSIONS.map(({ key, label }) => (
              <PercentileBar
                key={key}
                score={(team.scores as any)[key]}
                label={label}
                color={ACCENT}
              />
            ))}
          </section>

          {/* Raw metrics */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Raw Metrics (per 90)</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {rawRows.map(r => (
                <div key={r.label} className="flex items-center justify-between text-[10px] font-mono border-b border-white/5 pb-1">
                  <span className="text-gray-500">{r.label}</span>
                  <span className="font-bold text-white">{r.v != null ? r.v.toFixed(2) : '—'}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Squad depth */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
              <Users size={12} /> Squad Depth — by Player Intelligence
            </h3>
            {squad.length === 0 ? (
              <p className="text-[11px] text-gray-500">No squad data for this season.</p>
            ) : (
              <div className="space-y-1.5">
                {squad.map((p, i) => (
                  <button
                    key={p.player_id}
                    onClick={() => navigate(`/intel/player/${p.player_id}`)}
                    className="w-full flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-vantage-cyan/30 transition-colors px-3 py-2 text-left"
                  >
                    <PlayerAvatar playerId={p.player_id} name={p.player_name} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold truncate">{p.player_name}</p>
                      <p className="text-[9px] text-gray-500">{p.position} · {Math.round(p.minutes_played)} mins</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-sm font-black font-mono" style={{ color: p.scores?.vpii != null && p.scores.vpii >= 65 ? '#10B981' : p.scores?.vpii != null && p.scores.vpii >= 45 ? '#D97706' : '#DC2626' }}>
                        {p.scores?.vpii != null ? Math.round(p.scores.vpii) : '—'}
                      </span>
                      <p className="text-[7px] uppercase tracking-widest text-gray-500">VPII</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <p className="text-[9px] text-gray-600 leading-relaxed px-1">
            Z-score normalized vs league baselines (50 = league average). Understat/FBref season aggregates via Vantage Intelligence.
          </p>
        </div>
      )}
    </div>
  );
};

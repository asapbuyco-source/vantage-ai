import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, BrainCircuit, RefreshCw, ChevronDown, ChevronUp, Activity, Sparkles, Crosshair, Zap, Shield, GitBranch, Gem } from 'lucide-react';
import { fetchPlayerById } from '../services/intelligence/db';
import { PlayerIntelligence, PlayerScores } from '../services/intelligence/types';
import { getScoreLabel, leaguePercentile, fmt } from '../services/intelligence/stats';
import { ScoreRing } from '../components/intel/ScoreRing';
import { RadarCompare, RadarLegend } from '../components/intel/RadarCompare';
import { PercentileBar } from '../components/intel/PercentileBar';
import { PlayerAvatar } from '../components/intel/PlayerAvatar';

const ACCENT = '#22d3ee';

interface DimDef {
  key: keyof Omit<PlayerScores, 'vpii' | 'physical'>;
  label: string;
  icon: any;
  color: string;
  stats: { key: string; label: string; betterIs?: 'lower' }[];
}

const DIMENSIONS: DimDef[] = [
  {
    key: 'finishing', label: 'Finishing', icon: Crosshair, color: '#22d3ee',
    stats: [
      { key: 'xg_per90', label: 'xG /90' },
      { key: 'goals_per90', label: 'Goals /90' },
      { key: 'goals_minus_xg', label: 'Goals − xG' },
      { key: 'shot_on_target_pct', label: 'SoT %' },
    ],
  },
  {
    key: 'creativity', label: 'Creativity', icon: Sparkles, color: '#a855f7',
    stats: [
      { key: 'xa_per90', label: 'xA /90' },
      { key: 'key_passes_per90', label: 'Key Passes /90' },
      { key: 'sca_per90', label: 'SCA /90' },
    ],
  },
  {
    key: 'progression', label: 'Progression', icon: GitBranch, color: '#34d399',
    stats: [
      { key: 'prog_passes_per90', label: 'Prog. Passes /90' },
      { key: 'prog_carries_per90', label: 'Prog. Carries /90' },
      { key: 'carries_final_third_per90', label: 'Carries into Final 3rd' },
    ],
  },
  {
    key: 'decision_making', label: 'Decision Making', icon: Zap, color: '#f59e0b',
    stats: [
      { key: 'dribble_success_pct', label: 'Dribble Success %' },
      { key: 'turnovers_per90', label: 'Turnovers /90', betterIs: 'lower' },
      { key: 'miscontrols_per90', label: 'Miscontrols /90', betterIs: 'lower' },
    ],
  },
  {
    key: 'defensive', label: 'Defensive', icon: Shield, color: '#60a5fa',
    stats: [
      { key: 'pressures_per90', label: 'Pressures /90' },
      { key: 'pressure_success_pct', label: 'Pressure Success %' },
      { key: 'tackles_per90', label: 'Tackles /90' },
      { key: 'interceptions_per90', label: 'Interceptions /90' },
    ],
  },
  {
    key: 'possession_value', label: 'Possession Value', icon: Gem, color: '#f472b6',
    stats: [
      { key: 'xgchain_per90', label: 'xGChain /90' },
      { key: 'xgbuildup_per90', label: 'xGBuildup /90' },
    ],
  },
];

export const IntelligencePlayer: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [player, setPlayer] = useState<PlayerIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [openDim, setOpenDim] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    setLoading(true);
    fetchPlayerById(id)
      .then(p => { if (mounted) setPlayer(p); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [id]);

  const vpii = player?.scores?.vpii ?? null;

  const radarData = player
    ? DIMENSIONS.map(d => ({ dimension: d.label.slice(0, 10), value: (player.scores as any)[d.key] }))
    : [];

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
            <h1 className="text-sm font-bold">Player Intelligence</h1>
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
      ) : !player || vpii == null ? (
        <div className="flex flex-col items-center justify-center py-24 px-6 text-center gap-3">
          <BrainCircuit size={40} className="text-gray-600" />
          <h2 className="text-base font-bold">No intelligence coverage</h2>
          <p className="text-xs text-gray-500 max-w-xs">
            This player isn't in the Vantage Intelligence database yet.
          </p>
        </div>
      ) : (
        <div className="p-4 space-y-5 max-w-lg mx-auto">
          {/* Hero */}
          <div className="relative overflow-hidden rounded-2xl border border-vantage-cyan/20 bg-white/5 backdrop-blur-md p-5">
            <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-vantage-cyan/50 to-transparent pointer-events-none" />
            <div className="flex items-center gap-4 mb-4">
              <PlayerAvatar playerId={player.player_id} name={player.player_name} size={56} ringColor={ACCENT} />
              <div className="min-w-0">
                <h2 className="text-lg font-black leading-tight truncate">{player.player_name}</h2>
                <p className="text-[11px] text-gray-400 truncate">{player.team} · {player.league}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white/[0.06] text-gray-300">{player.position}</span>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${vpii >= 65 ? 'bg-emerald-500/15 text-emerald-400' : vpii >= 45 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'}`}>
                    {getScoreLabel(vpii)} · P{leaguePercentile(vpii)}
                  </span>
                </div>
              </div>
              <div className="ml-auto shrink-0">
                <ScoreRing score={vpii} size={84} fontSize={26} accentColor={ACCENT} />
              </div>
            </div>
            <p className="text-[9px] text-gray-500">{Math.round(player.minutes_played)} minutes played · Season {player.season}</p>

            {/* Radar */}
            <div className="flex justify-center mt-2">
              <RadarCompare data={radarData} size={240} primaryColor={ACCENT} primaryName={player.player_name} secondaryName={undefined} />
            </div>
            <RadarLegend primaryColor={ACCENT} primaryName={player.player_name} secondaryName={undefined} />
          </div>

          {/* Dimension cards */}
          {DIMENSIONS.map(dim => {
            const score = (player.scores as any)[dim.key] as number | null;
            const isOpen = openDim === dim.key;
            return (
              <section key={dim.key} className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
                <button
                  onClick={() => setOpenDim(isOpen ? null : dim.key)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <dim.icon size={15} style={{ color: dim.color }} />
                    <span className="text-xs font-bold">{dim.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black font-mono" style={{ color: score != null ? dim.color : '#475569' }}>
                      {score != null ? Math.round(score) : 'N/A'}
                    </span>
                    {isOpen ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
                  </div>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 space-y-2 border-t border-white/5">
                    {/* Composite bar */}
                    <PercentileBar score={score} label={`${dim.label} index`} color={dim.color} />
                    {/* Raw stats */}
                    <div className="pt-2 space-y-1">
                      {dim.stats.map(s => {
                        const raw = (player.raw_stats as any)?.[s.key];
                        const inv = s.betterIs === 'lower';
                        return (
                          <div key={s.key} className="flex items-center justify-between text-[10px] font-mono px-1">
                            <span className="text-gray-500">
                              {s.label}{inv && <span className="text-[8px] ml-1 text-gray-600">(lower = better)</span>}
                            </span>
                            <span className="font-bold text-gray-200">{raw != null ? fmt(raw) : '—'}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            );
          })}

          {/* Physical — honesty card */}
          <section className="rounded-2xl border border-dashed border-white/10 bg-transparent p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 opacity-50">
                <Activity size={15} className="text-gray-500" />
                <span className="text-xs font-bold text-gray-500">Physical</span>
              </div>
              <span className="text-[10px] font-bold text-gray-600">Data unavailable</span>
            </div>
            <p className="text-[9px] text-gray-600 mt-1">We don't manufacture scores — no verified physical dataset exists for this metric.</p>
          </section>

          <p className="text-[9px] text-gray-600 leading-relaxed px-1">
            All values per-90, z-score normalized vs league baselines (50 = average). Understat/FBref season aggregates via Vantage Intelligence.
          </p>
        </div>
      )}
    </div>
  );
};

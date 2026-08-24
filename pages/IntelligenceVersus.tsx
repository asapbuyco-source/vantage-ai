import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, BrainCircuit, RefreshCw } from 'lucide-react';
import { fetchTeamById, TeamReport } from '../services/intelligence/db';
import { TeamIntelligence, TEAM_DIMENSIONS } from '../services/intelligence/types';
import { predictMatchup, getScoreLabel } from '../services/intelligence/stats';
import { ScoreRing } from '../components/intel/ScoreRing';
import { RadarCompare, RadarLegend } from '../components/intel/RadarCompare';
import { TugOfWar } from '../components/intel/TugOfWar';
import { TeamLogo } from '../components/TeamLogo';

const HOME = '#22d3ee';
const AWAY = '#a855f7';

export const IntelligenceVersus: React.FC = () => {
  const params = useParams();
  const search = new URLSearchParams(window.location.search);
  const homeId = search.get('h') || (params as any).h;
  const awayId = search.get('a') || (params as any).a;
  const navigate = useNavigate();
  const [home, setHome] = useState<TeamIntelligence | null>(null);
  const [away, setAway] = useState<TeamIntelligence | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([homeId ? fetchTeamById(homeId) : null, awayId ? fetchTeamById(awayId) : null])
      .then(([h, a]: [TeamReport | null, TeamReport | null]) => {
        if (!mounted) return;
        setHome(h?.team ?? null);
        setAway(a?.team ?? null);
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [homeId, awayId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-vantage-bg flex flex-col items-center justify-center gap-4">
        <RefreshCw size={28} className="animate-spin text-vantage-cyan" />
        <p className="text-xs text-gray-500">Building matchup report…</p>
      </div>
    );
  }

  if (!home || !away || home.scores?.vti == null || away.scores?.vti == null) {
    return (
      <div className="min-h-screen bg-vantage-bg flex flex-col items-center justify-center px-6 text-center gap-3">
        <BrainCircuit size={40} className="text-gray-600" />
        <h2 className="text-base font-bold text-white">Insufficient coverage</h2>
        <p className="text-xs text-gray-500 max-w-xs">One or both clubs aren't in the intelligence database yet.</p>
        <button onClick={() => navigate('/research')} className="mt-2 px-5 py-2 rounded-full bg-vantage-cyan/15 text-vantage-cyan text-xs font-bold border border-vantage-cyan/30">Back to Research</button>
      </div>
    );
  }

  const hVti = home.scores.vti;
  const aVti = away.scores.vti;
  const adv = Math.round(Math.abs(hVti - aVti));
  const leader = hVti >= aVti ? 'home' : 'away';
  const prediction = predictMatchup(hVti, aVti);

  const radarData = TEAM_DIMENSIONS.map(({ key, label }) => ({
    dimension: label,
    value: (home.scores as any)[key],
    value2: (away.scores as any)[key],
  }));

  const tugRows = [
    { label: 'Attack', homeValue: home.scores.attacking, awayValue: away.scores.attacking },
    { label: 'Creation', homeValue: home.scores.creation, awayValue: away.scores.creation },
    { label: 'Progression', homeValue: home.scores.progression, awayValue: away.scores.progression },
    { label: 'Defense', homeValue: home.scores.defensive, awayValue: away.scores.defensive },
    { label: 'Possession', homeValue: home.scores.possession_value, awayValue: away.scores.possession_value },
  ];

  return (
    <div className="min-h-screen bg-vantage-bg pb-20 font-sans text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-vantage-bg/95 backdrop-blur-md border-b border-white/10">
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"><ArrowLeft size={20} /></button>
          <div className="flex items-center gap-2">
            <BrainCircuit size={16} className="text-vantage-cyan" />
            <h1 className="text-sm font-bold">Matchup Report</h1>
          </div>
          <div className="w-9" />
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-5">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl border border-vantage-cyan/20 bg-white/5 backdrop-blur-md p-5">
          <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-vantage-cyan/50 to-transparent pointer-events-none" />
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
              <TeamLogo src="" teamName={home.team_name} className="w-14 h-14 rounded-xl" />
              <span className="text-xs font-bold text-center truncate w-full">{home.team_name}</span>
              <ScoreRing score={hVti} size={78} fontSize={22} accentColor={HOME} />
              <span className="text-[9px] text-gray-400">{getScoreLabel(hVti)}</span>
            </div>

            <div className="flex flex-col items-center gap-1 pt-6 shrink-0">
              <span
                className="text-base font-black font-mono px-3 py-1 rounded-xl border"
                style={{
                  color: leader === 'home' ? HOME : AWAY,
                  borderColor: leader === 'home' ? `${HOME}44` : `${AWAY}44`,
                  background: leader === 'home' ? `${HOME}11` : `${AWAY}11`,
                }}
              >+{adv}</span>
              <span className="text-[8px] font-bold uppercase tracking-widest text-gray-500">Advantage</span>
              {prediction && (
                <div className="w-24 mt-3">
                  <p className="text-[7px] font-bold uppercase tracking-widest text-gray-500 text-center mb-1">Intel model</p>
                  <div className="flex h-2 rounded-full overflow-hidden mb-1">
                    <div style={{ width: `${prediction.home}%`, background: HOME }} />
                    <div style={{ width: `${prediction.draw}%`, background: '#94A3B855' }} />
                    <div style={{ width: `${prediction.away}%`, background: AWAY }} />
                  </div>
                  <p className="text-[8px] font-mono text-gray-400 text-center">{prediction.home}/{prediction.draw}/{prediction.away}</p>
                </div>
              )}
            </div>

            <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
              <TeamLogo src="" teamName={away.team_name} className="w-14 h-14 rounded-xl" />
              <span className="text-xs font-bold text-center truncate w-full">{away.team_name}</span>
              <ScoreRing score={aVti} size={78} fontSize={22} accentColor={AWAY} />
              <span className="text-[9px] text-gray-400">{getScoreLabel(aVti)}</span>
            </div>
          </div>
        </div>

        {/* Radar */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Shape of the Matchup</h3>
          <div className="flex justify-center">
            <RadarCompare data={radarData} size={260} primaryColor={HOME} secondaryColor={AWAY} primaryName={home.team_name} secondaryName={away.team_name} />
          </div>
          <RadarLegend primaryColor={HOME} secondaryColor={AWAY} primaryName={home.team_name} secondaryName={away.team_name} />
        </section>

        {/* Tug of war */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Dimension Battle</h3>
          <TugOfWar rows={tugRows} homeColor={HOME} awayColor={AWAY} />
        </section>

        <p className="text-[9px] text-gray-600 leading-relaxed px-1">
          Z-scored season aggregates vs league baselines (50 = average). Neutral-venue estimate — no home advantage applied. Understat/FBref via Vantage Intelligence.
        </p>
      </div>
    </div>
  );
};

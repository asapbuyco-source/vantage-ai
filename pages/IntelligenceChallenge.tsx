import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BrainCircuit, RefreshCw, Swords, Users, Plus, X } from 'lucide-react';
import { fetchTeamById, fetchPlayerById, searchIntelligence } from '../services/intelligence/db';
import { SearchResult } from '../services/intelligence/types';
import { TeamIntelligence, PlayerIntelligence, TEAM_DIMENSIONS } from '../services/intelligence/types';
import { predictMatchup, getScoreLabel, projectGoals } from '../services/intelligence/stats';
import { ScoreRing } from '../components/intel/ScoreRing';
import { RadarCompare, RadarLegend } from '../components/intel/RadarCompare';
import { TugOfWar } from '../components/intel/TugOfWar';
import { TeamCrest } from '../components/intel/TeamCrest';
import { PlayerAvatar } from '../components/intel/PlayerAvatar';
import { DreamPitch } from '../components/intel/DreamPitch';
import { MatchSim } from '../components/intel/MatchSim';

const HOME = '#22d3ee';
const AWAY = '#a855f7';

type ChallengeType = 'teams' | 'players' | 'dream';

const PLAYER_DIMS = ['finishing', 'creativity', 'progression', 'decision_making', 'defensive', 'possession_value'];
const DIM_LABELS: Record<string, string> = {
  finishing: 'Finishing', creativity: 'Creativity', progression: 'Progression',
  decision_making: 'Decisions', defensive: 'Defensive', possession_value: 'Possession',
  attacking: 'Attack', creation: 'Creation', consistency: 'Consistency',
};

export const IntelligenceChallenge: React.FC = () => {
  const navigate = useNavigate();
  const search = new URLSearchParams(window.location.search);
  const type = (search.get('type') || 'teams') as ChallengeType;
  const hId = search.get('h');
  const aId = search.get('a');

  const [home, setHome] = useState<TeamIntelligence | null>(null);
  const [away, setAway] = useState<TeamIntelligence | null>(null);
  const [pH, setPH] = useState<PlayerIntelligence | null>(null);
  const [pA, setPA] = useState<PlayerIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [simDone, setSimDone] = useState(false);

  // Dream XI rosters
  const [dreamH, setDreamH] = useState<PlayerIntelligence[]>([]);
  const [dreamA, setDreamA] = useState<PlayerIntelligence[]>([]);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('dream_challenge');
      if (saved && type === 'dream') {
        const { h, a } = JSON.parse(saved);
        setLoading(true);
        Promise.all([
          Promise.all((h || []).map((id: string) => fetchPlayerById(id))),
          Promise.all((a || []).map((id: string) => fetchPlayerById(id))),
        ]).then(([hh, aa]) => {
          setDreamH(hh.filter(Boolean) as any);
          setDreamA(aa.filter(Boolean) as any);
        }).finally(() => setLoading(false));
      }
    } catch { setLoading(false); }
  }, [type]);

  useEffect(() => {
    if (type === 'dream') return;
    let mounted = true;
    setLoading(true);
    if (type === 'teams') {
      Promise.all([hId ? fetchTeamById(hId) : null, aId ? fetchTeamById(aId) : null])
        .then(([h, a]) => { if (!mounted) return; setHome(h?.team ?? null); setAway(a?.team ?? null); })
        .finally(() => { if (mounted) setLoading(false); });
    } else {
      Promise.all([hId ? fetchPlayerById(hId) : null, aId ? fetchPlayerById(aId) : null])
        .then(([p1, p2]) => { if (!mounted) return; setPH(p1); setPA(p2); })
        .finally(() => { if (mounted) setLoading(false); });
    }
    return () => { mounted = false; };
  }, [type, hId, aId]);

  const avgDims = (players: PlayerIntelligence[]) => {
    const out: Record<string, number | null> = {};
    PLAYER_DIMS.forEach(d => {
      const vals = players.map(p => (p.scores as any)?.[d]).filter((v: any) => v != null) as number[];
      out[d] = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
    });
    return out;
  };

  // ── Loading / coverage guards ──
  if (loading) {
    return (
      <Shell><RefreshCw size={28} className="animate-spin text-vantage-cyan" />
        <p className="text-xs text-gray-500 text-center mt-3">Building matchup…</p></Shell>
    );
  }

  // ── Match simulation first (all challenge types) ──
  if (!simDone) {
    const sh = type === 'players' ? [pH?.player_name ?? ''] : type === 'dream' ? dreamH.map(p => p.player_name) : [];
    const sa = type === 'players' ? [pA?.player_name ?? ''] : type === 'dream' ? dreamA.map(p => p.player_name) : [];
    const hAtk = type === 'teams' && home ? home.scores.attacking : null;
    const aAtk = type === 'teams' && away ? away.scores.attacking : null;
    return (
      <MatchSim
        homeName={type === 'teams' ? home?.team_name ?? 'Home' : type === 'players' ? pH?.player_name ?? 'Home' : `Your XI (${dreamH.length})`}
        awayName={type === 'teams' ? away?.team_name ?? 'Away' : type === 'players' ? pA?.player_name ?? 'Away' : `Vantage AI (${dreamA.length})`}
        homeAttack={hAtk} awayAttack={aAtk}
        scorersHome={sh} scorersAway={sa}
        onDone={() => setSimDone(true)}
      />
    );
  }

  if (type !== 'dream' && ((!home && !pH) || (!away && !pA))) {
    return (
      <Shell>
        <BrainCircuit size={40} className="text-gray-600 mx-auto mb-3" />
        <h2 className="text-base font-bold text-white text-center">Insufficient coverage</h2>
        <p className="text-xs text-gray-500 text-center max-w-xs mt-1">One or both selections aren't in the intelligence database.</p>
      </Shell>
    );
  }

  // ── Compose comparison data per type ──
  let homeName = '', awayName = '', homeIdx: number | null = null, awayIdx: number | null = null;
  let radar: any[] = [];
  let tug: any[] = [];
  let homeAttack: number | null = null, awayAttack: number | null = null;

  if (type === 'teams' && home && away) {
    homeName = home.team_name; awayName = away.team_name;
    homeIdx = home.scores.vti; awayIdx = away.scores.vti;
    homeAttack = home.scores.attacking; awayAttack = away.scores.attacking;
    radar = TEAM_DIMENSIONS.map(({ key, label }) => ({
      dimension: label,
      value: (home.scores as any)[key], value2: (away.scores as any)[key],
    }));
    tug = [
      ['Attacking', 'attacking'], ['Creation', 'creation'], ['Progression', 'progression'],
      ['Defensive', 'defensive'], ['Possession', 'possession_value'], ['Consistency', 'consistency'],
    ].map(([label, k]) => ({ label, homeValue: (home.scores as any)[k], awayValue: (away.scores as any)[k] }));
  } else if ((type === 'players' && pH && pA)) {
    homeName = pH.player_name; awayName = pA.player_name;
    homeIdx = pH.scores.vpii; awayIdx = pA.scores.vpii;
    radar = PLAYER_DIMS.map(d => ({
      dimension: DIM_LABELS[d].slice(0, 10),
      value: (pH.scores as any)[d], value2: (pA.scores as any)[d],
    }));
    tug = PLAYER_DIMS.map(d => ({ label: DIM_LABELS[d], homeValue: (pH.scores as any)[d], awayValue: (pA.scores as any)[d] }));
  } else if (type === 'dream' && dreamH.length > 0 && dreamA.length > 0) {
    const dh = avgDims(dreamH), da = avgDims(dreamA);
    homeName = `Dream XI (${dreamH.length})`; awayName = `Dream XI (${dreamA.length})`;
    homeAttack = dh['attacking']; awayAttack = da['attacking'];
    const idxOf = (dims: Record<string, number | null>) => {
      const vals = Object.values(dims).filter((v): v is number => v != null);
      return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
    };
    homeIdx = idxOf(dh); awayIdx = idxOf(da);
    radar = PLAYER_DIMS.map(d => ({ dimension: DIM_LABELS[d].slice(0, 10), value: dh[d], value2: da[d] }));
    tug = PLAYER_DIMS.map(d => ({ label: DIM_LABELS[d], homeValue: dh[d], awayValue: da[d] }));
  }

  const prediction = homeIdx != null && awayIdx != null ? predictMatchup(homeIdx, awayIdx) : null;
  const adv = homeIdx != null && awayIdx != null ? Math.abs(homeIdx - awayIdx) : 0;
  const leader = (homeIdx ?? 0) >= (awayIdx ?? 0);

  return (
    <Shell>
      <div className="max-w-lg mx-auto space-y-5">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl border border-vantage-cyan/20 bg-white/5 backdrop-blur-md p-5">
          <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-vantage-cyan/50 to-transparent pointer-events-none" />
          <div className="flex items-start justify-between gap-3">
            <Side
              name={homeName}
              idx={homeIdx}
              accent={HOME}
              avatar={type === 'teams'
                ? <TeamCrest teamName={homeName} teamId={home?.team_id} size={54} />
                : <PlayerAvatar playerId={type === 'players' ? pH!.player_id : ''} name={homeName} size={54} ringColor={HOME} />}
            />
            <div className="flex flex-col items-center gap-1 pt-4 shrink-0">
              <span className="text-base font-black font-mono px-3 py-1 rounded-xl border"
                style={{ color: leader ? HOME : AWAY, borderColor: leader ? `${HOME}44` : `${AWAY}44`, background: leader ? `${HOME}11` : `${AWAY}11` }}>
                +{adv}
              </span>
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
              {homeAttack != null && awayAttack != null && projectGoals(homeAttack) != null && (
                <div className="mt-2 w-24">
                  <p className="text-[7px] font-bold uppercase tracking-widest text-gray-500 text-center mb-0.5">Projected score</p>
                  <p className="text-[11px] font-black font-mono text-white text-center">
                    {projectGoals(homeAttack)?.toFixed(1)} – {projectGoals(awayAttack)?.toFixed(1)}
                  </p>
                </div>
              )}
            </div>
            <Side
              name={awayName}
              idx={awayIdx}
              accent={AWAY}
              right
              avatar={type === 'teams'
                ? <TeamCrest teamName={awayName} teamId={away?.team_id} size={54} />
                : <PlayerAvatar playerId={type === 'players' ? pA!.player_id : ''} name={awayName} size={54} ringColor={AWAY} />}
            />
          </div>
        </div>

        {/* Radar */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Shape of the Matchup</h3>
          <div className="flex justify-center">
            <RadarCompare data={radar} size={260} primaryColor={HOME} secondaryColor={AWAY} primaryName={homeName} secondaryName={awayName} />
          </div>
          <RadarLegend primaryColor={HOME} secondaryColor={AWAY} primaryName={homeName} secondaryName={awayName} />
        </section>

        {/* Dimension battle */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Dimension Battle</h3>
          <TugOfWar rows={tug} homeColor={HOME} awayColor={AWAY} />
        </section>

        {/* Dream lineups on the pitch */}
        {type === 'dream' && (
          <section className="space-y-3">
            <DreamPitch roster={dreamH.map(p => ({ id: p.player_id, name: p.player_name, meta: p.position }))} accent={HOME} label="Home XI" />
            <DreamPitch roster={dreamA.map(p => ({ id: p.player_id, name: p.player_name, meta: p.position }))} accent={AWAY} label="Away XI" />
          </section>
        )}

        <p className="text-[9px] text-gray-600 leading-relaxed px-1">
          Z-scored vs league baselines (50 = average).{type !== 'teams' ? ' Composite indices averaged across selected players.' : ''} Intel model estimate — neutral venue.
        </p>
      </div>
    </Shell>
  );
};

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-vantage-bg pb-20 font-sans text-white">
      <div className="sticky top-0 z-20 bg-vantage-bg/95 backdrop-blur-md border-b border-white/10">
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"><ArrowLeft size={20} /></button>
          <div className="flex items-center gap-2">
            <Swords size={16} className="text-vantage-cyan" />
            <h1 className="text-sm font-bold">Challenge</h1>
          </div>
          <div className="w-9" />
        </div>
      </div>
      <div className="p-4 pt-5">{children}</div>
    </div>
  );
};

const Side: React.FC<{ name: string; idx: number | null; accent: string; right?: boolean; avatar: React.ReactNode }> = ({ name, idx, accent, right, avatar }) => (
  <div className={`flex flex-col items-center gap-1.5 flex-1 min-w-0 ${right ? 'items-end' : ''}`}>
    {avatar}
    <span className={`text-xs font-bold text-center truncate w-full`}>{name}</span>
    <ScoreRing score={idx} size={72} fontSize={20} accentColor={accent} />
    <span className="text-[9px] text-gray-400">{getScoreLabel(idx)}</span>
  </div>
);

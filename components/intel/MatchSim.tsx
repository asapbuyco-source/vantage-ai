import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BrainCircuit } from 'lucide-react';

interface SimEvent { minute: number; text: string; side: 'home' | 'away' | 'neutral'; big?: boolean }

interface MatchSimProps {
  homeName: string;
  awayName: string;
  homeAttack: number | null;
  awayAttack: number | null;
  scorersHome: string[];
  scorersAway: string[];
  accentH?: string;
  accentA?: string;
  onDone: () => void;
}

const H = '#22d3ee'; const A = '#a855f7';
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const sampleGoals = (attack: number | null): number => {
  if (attack == null) return Math.floor(Math.random() * 3);
  const proj = Math.min(3.5, Math.max(0.2, 1.35 * Math.pow(Math.max(20, attack) / 50, 1.25)));
  // Poisson-ish sample via small inversion
  let g = 0, p = Math.exp(-proj), s = p, u = Math.random();
  while (u > s && g < 6) { g++; p *= proj / g; s += p; }
  return g;
};

export const MatchSim: React.FC<MatchSimProps> = ({ homeName, awayName, homeAttack, awayAttack, scorersHome, scorersAway, onDone }) => {
  const [minute, setMinute] = useState(0);
  const [shown, setShown] = useState<SimEvent[]>([]);
  const [ft, setFt] = useState(false);
  const timer = useRef<any>(null);

  const hg = sampleGoals(homeAttack);
  const ag = sampleGoals(awayAttack);

  useEffect(() => {
    const events: SimEvent[] = [];
    const mins = new Set<number>();
    const nextMin = () => { let m = 1 + Math.floor(Math.random() * 89); while (mins.has(m)) m = 1 + Math.floor(Math.random() * 89); mins.add(m); return m; };
    for (let i = 0; i < hg; i++) events.push({ minute: nextMin(), side: 'home', big: true, text: `⚽ GOAL! ${scorersHome.length ? pick(scorersHome) : homeName}` });
    for (let i = 0; i < ag; i++) events.push({ minute: nextMin(), side: 'away', big: true, text: `⚽ GOAL! ${scorersAway.length ? pick(scorersAway) : awayName}` });
    const fillers = [
      { t: `Big chance! ${pick([homeName, awayName])} nearly score`, s: 'neutral' as const },
      { t: `Yellow card — ${pick(['tactical foul', 'late tackle'])}`, s: 'neutral' as const },
      { t: `${pick(['Great save!', 'Off the post!', 'VAR check: no goal'])}`, s: 'neutral' as const },
    ];
    for (let i = 0; i < 3; i++) { const f = pick(fillers); events.push({ minute: nextMin(), text: f.t, side: f.s }); }
    events.sort((x, y) => x.minute - y.minute);

    let idx = 0;
    timer.current = setInterval(() => {
      setMinute(m => Math.min(90, m + Math.ceil(Math.random() * 7)));
      setShown(prev => {
        while (idx < events.length && events[idx].minute <= minute + 7) { prev = [...prev, events[idx]]; idx++; }
        return prev;
      });
    }, 550);

    const end = setTimeout(() => {
      clearInterval(timer.current);
      setMinute(90); setShown(events); setFt(true);
    }, events.length * 550 + 2600);

    return () => { clearInterval(timer.current); clearTimeout(end); };
  }, []);

  const hs = shown.filter(e => e.side === 'home' && e.big).length;
  const as_ = shown.filter(e => e.side === 'away' && e.big).length;

  return (
    <div className="fixed inset-0 z-[80] bg-vantage-bg overflow-y-auto">
      <div className="max-w-md mx-auto px-4 py-8">
        {/* Scoreboard */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 mb-4">
          <p className="text-center text-[9px] font-black uppercase tracking-widest text-gray-500 mb-3 flex items-center justify-center gap-1.5">
            <BrainCircuit size={11} className="text-vantage-cyan" /> Vantage Simulation
          </p>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div className="text-center min-w-0">
              <p className="text-xs font-bold truncate" style={{ color: H }}>{homeName}</p>
              <motion.p key={hs} initial={{ scale: 1.6 }} animate={{ scale: 1 }} className="text-4xl font-black font-mono" style={{ color: H }}>{hs}</motion.p>
            </div>
            <div className="text-center">
              <AnimatePresence mode="wait">
                <motion.span key={ft ? 'ft' : minute} initial={{ scale: 1.3 }} animate={{ scale: 1 }}
                  className={`inline-block px-2.5 py-1 rounded-lg font-mono font-black text-sm ${ft ? 'bg-amber-400/15 text-amber-400' : 'bg-white/10 text-white'}`}>
                  {ft ? 'FT' : `${minute}'`}
                </motion.span>
              </AnimatePresence>
            </div>
            <div className="text-center min-w-0">
              <p className="text-xs font-bold truncate" style={{ color: A }}>{awayName}</p>
              <motion.p key={as_} initial={{ scale: 1.6 }} animate={{ scale: 1 }} className="text-4xl font-black font-mono" style={{ color: A }}>{as_}</motion.p>
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="space-y-2 min-h-[180px]">
          <AnimatePresence>
            {shown.map((e, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: e.side === 'home' ? -24 : e.side === 'away' ? 24 : 0 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 ${
                  e.big
                    ? (e.side === 'home' ? 'border-vantage-cyan/30 bg-vantage-cyan/10' : 'border-vantage-purple/30 bg-vantage-purple/10')
                    : 'border-white/5 bg-white/[0.03]'
                }`}
              >
                <span className="text-[9px] font-black font-mono text-gray-400 w-7 shrink-0">{e.minute}'</span>
                <span className={`text-[11px] font-semibold flex-1 ${e.big ? 'text-white' : 'text-gray-400'}`}>{e.text}</span>
              </motion.div>
            ))}
          </AnimatePresence>
          {!ft && shown.length === 0 && (
            <p className="text-center text-[11px] text-gray-500 py-8">Kick-off…</p>
          )}
        </div>

        {/* FT button */}
        {ft && (
          <motion.button
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            onClick={onDone}
            className="w-full mt-4 py-3.5 rounded-xl bg-vantage-gradient text-white text-sm font-black tracking-wide"
          >
            View Full Analysis Report →
          </motion.button>
        )}
      </div>
    </div>
  );
};

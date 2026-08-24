import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { PlayerAvatar } from './PlayerAvatar';

export interface PitchPlayer {
  id: string;
  name: string;
  meta?: string;
}

interface DreamPitchProps {
  roster: PitchPlayer[];
  accent: string;
  label: string;
  onRemove?: (id: string) => void;
  estGoals?: number | null;
}

/** 4-3-3 slot layout as % coordinates (x, y) on a vertical pitch */
const SLOTS: { x: number; y: number; pos: 'GK' | 'DF' | 'MF' | 'FW' }[] = [
  { x: 50, y: 91, pos: 'GK' },
  { x: 14, y: 70, pos: 'DF' }, { x: 38, y: 73, pos: 'DF' }, { x: 62, y: 73, pos: 'DF' }, { x: 86, y: 70, pos: 'DF' },
  { x: 24, y: 49, pos: 'MF' }, { x: 50, y: 52, pos: 'MF' }, { x: 76, y: 49, pos: 'MF' },
  { x: 16, y: 24, pos: 'FW' }, { x: 50, y: 21, pos: 'FW' }, { x: 84, y: 24, pos: 'FW' },
];

const posOf = (p: PitchPlayer | undefined): string => {
  if (!p?.meta) return '';
  const parts = p.meta.split('·');
  return (parts[parts.length - 1] || '').trim().toUpperCase();
};

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Assign players to formation slots — position-aware when the search meta
 * carries a position tag, otherwise fills GK → DF → MF → FW in order.
 */
function assignSlots(roster: PitchPlayer[]): (PitchPlayer | null)[] {
  const used = new Set<number>();
  const result: (PitchPlayer | null)[] = new Array(SLOTS.length).fill(null);

  const tryGroup = (group: number[], player: PitchPlayer, idx: number) => {
    for (const s of group) {
      if (result[s] == null) { result[s] = player; used.add(idx); return true; }
    }
    return false;
  };

  // Pass 1: position-aware placement
  roster.forEach((p, idx) => {
    const pos = posOf(p);
    if (pos.startsWith('G')) tryGroup([0], p, idx);
    else if (pos.startsWith('D') || pos.includes('BACK')) tryGroup([1, 2, 3, 4], p, idx);
    else if (pos.startsWith('M')) tryGroup([5, 6, 7], p, idx);
    else if (pos.startsWith('F') || pos.includes('WING') || pos.startsWith('ST') || pos.startsWith('ATT')) tryGroup([8, 9, 10], p, idx);
  });

  // Pass 2: fill remaining slots in order
  const remainingGroups = [[0], [1, 2, 3, 4], [5, 6, 7], [8, 9, 10]];
  roster.forEach((p, idx) => {
    if (used.has(idx)) return;
    for (const g of remainingGroups) {
      if (tryGroup(g, p, idx)) return;
    }
  });

  return result;
}

/** Deterministic generated crest — gradient shield + initials for dream teams. */
const DreamCrest: React.FC<{ teamName: string; size?: number }> = ({ teamName, size = 36 }) => {
  const hue = hashString(teamName) % 360;
  return (
    <div
      className="flex items-center justify-center font-black shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.32,
        borderRadius: '30% 30% 50% 50%',
        background: `linear-gradient(135deg, hsl(${hue},70%,45%), hsl(${(hue + 45) % 360},65%,28%))`,
        color: '#fff',
        boxShadow: `inset 0 -2px 0 rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.15)`,
      }}
    >
      {teamName.split(' ').map(w => w[0]).slice(0, 3).join('').toUpperCase()}
    </div>
  );
};

/**
 * Vertical football pitch showing the Dream XI lineup.
 * Drag any shirt onto another slot to swap positions.
 */
export const DreamPitch: React.FC<DreamPitchProps> = ({ roster, accent, label, onRemove, estGoals }) => {
  const rosterKey = roster.map(r => r.id).join('|');
  const [slots, setSlots] = useState<(PitchPlayer | null)[]>(() => assignSlots(roster));
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Re-derive baseline placement whenever the roster changes
  useEffect(() => {
    setSlots(assignSlots(roster));
  }, [rosterKey]);

  const moveSlot = (from: number, to: number) => {
    if (from === to) return;
    setSlots(prev => {
      const arr = [...prev];
      const moving = arr[from];
      if (!moving) return prev;
      const target = arr[to];
      arr[to] = moving;
      // Swap: displaced player goes to the source slot (keeps everyone on the pitch)
      arr[from] = target ?? null;
      return arr;
    });
  };

  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden">
      {/* Label bar */}
      <div className="flex items-center justify-between px-3 py-2" style={{ background: `${accent}0D` }}>
        <div className="flex items-center gap-2 min-w-0">
          <DreamCrest teamName={label} size={30} />
          <div className="min-w-0">
            <span className="block text-[10px] font-black uppercase tracking-widest truncate" style={{ color: accent }}>{label}</span>
            {estGoals != null && (
              <span className="text-[9px] font-bold text-gray-300">⚽ Projected goals ≈ {estGoals.toFixed(1)}</span>
            )}
          </div>
        </div>
        <span className="text-[9px] font-mono text-gray-400 shrink-0">{slots.filter(Boolean).length}/11</span>
      </div>

      {/* Pitch */}
      <div className="relative w-full" style={{ background: 'linear-gradient(180deg, #07130c 0%, #0a1a10 100%)' }}>
        <div className="relative pb-[130%]">
          {/* Pitch markings */}
          <svg viewBox="0 0 100 130" className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
            <rect x="1.5" y="1.5" width="97" height="127" rx="2" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="0.5" />
            <line x1="1.5" y1="65" x2="98.5" y2="65" stroke="rgba(255,255,255,0.14)" strokeWidth="0.5" />
            <circle cx="50" cy="65" r="14" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="0.5" />
            <circle cx="50" cy="65" r="0.8" fill="rgba(255,255,255,0.25)" />
            <rect x="24" y="1.5" width="52" height="16" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
            <rect x="38" y="1.5" width="24" height="6.5" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
            <rect x="24" y="112.5" width="52" height="16" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
            <rect x="38" y="122" width="24" height="6.5" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
          </svg>

          {/* Slots */}
          {SLOTS.map((slot, i) => {
            const p = slots[i];
            const isDragOver = dragOver === i && dragFrom !== null && dragFrom !== i;
            return (
              <div
                key={i}
                draggable={!!p}
                onDragStart={() => setDragFrom(i)}
                onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
                onDragLeave={() => setDragOver(prev => (prev === i ? null : prev))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom != null) moveSlot(dragFrom, i);
                  setDragFrom(null); setDragOver(null);
                }}
                className={`absolute flex flex-col items-center ${p ? 'cursor-grab active:cursor-grabbing' : ''}`}
                style={{
                  left: `${slot.x}%`, top: `${slot.y}%`, transform: 'translate(-50%, -50%)', width: '19%',
                  opacity: dragFrom === i ? 0.35 : 1,
                }}
              >
                {p ? (
                  <motion.div
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className="relative flex flex-col items-center"
                  >
                    {onRemove && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemove(p.id); }}
                        className="absolute -top-1 -right-1 z-10 w-4 h-4 rounded-full bg-red-500/90 flex items-center justify-center shadow"
                        title={`Remove ${p.name}`}
                      >
                        <X size={9} className="text-white" />
                      </button>
                    )}
                    <div style={{
                      boxShadow: `0 0 0 1.5px ${isDragOver ? '#fff' : `${accent}66`}`,
                      borderRadius: '9999px',
                      transition: 'box-shadow 0.15s',
                    }}>
                      <PlayerAvatar playerId={p.id} name={p.name} size={34} />
                    </div>
                    <span className="mt-0.5 max-w-full truncate text-[8px] font-bold text-white leading-tight px-0.5"
                      style={{ background: 'rgba(0,0,0,0.55)', borderRadius: 4 }}>
                      {p.name.split(' ').slice(-1)[0]}
                    </span>
                  </motion.div>
                ) : (
                  <div className="flex flex-col items-center">
                    <div
                      className="rounded-full border border-dashed flex items-center justify-center text-[7px] font-bold"
                      style={{
                        width: 30, height: 30,
                        borderColor: isDragOver ? accent : 'rgba(255,255,255,0.25)',
                        color: isDragOver ? accent : 'rgba(255,255,255,0.35)',
                        background: isDragOver ? `${accent}11` : 'transparent',
                      }}
                    >
                      {slot.pos}
                    </div>
                    <span className="mt-0.5 w-8 h-1 rounded-full bg-black/40" />
                  </div>
                )}
              </div>
            );
          })}

          {/* Drag hint */}
          {slots.filter(Boolean).length > 1 && (
            <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2">
              <span className="text-[7px] uppercase tracking-widest text-white/30 whitespace-nowrap">drag shirts to switch positions</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

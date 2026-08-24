import React, { useEffect, useState } from 'react';
import { getScoreColor } from '../../services/intelligence/stats';

interface ScoreRingProps {
  score: number | null;
  size?: number;
  strokeWidth?: number;
  label?: string;
  fontSize?: number;
  accentColor?: string;
}

/**
 * Animated donut gauge for intelligence scores (0-100).
 * Color follows the score band; accentColor overrides ring color.
 */
export const ScoreRing: React.FC<ScoreRingProps> = ({
  score,
  size = 120,
  strokeWidth = 7,
  label = 'VTI',
  fontSize = 28,
  accentColor,
}) => {
  const [offset, setOffset] = useState<number | null>(null);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const trackColor = 'rgba(148,163,184,0.18)';

  useEffect(() => {
    if (score == null) return;
    setOffset(circumference);
    const t = setTimeout(() => {
      setOffset(circumference - (score / 100) * circumference);
    }, 80);
    return () => clearTimeout(t);
  }, [score, circumference]);

  const color = accentColor || getScoreColor(score);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        {score != null && (
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset ?? circumference}
            style={{
              transition: 'stroke-dashoffset 1.1s cubic-bezier(0.25,0.46,0.45,0.94)',
              filter: `drop-shadow(0 0 5px ${color}55)`,
            }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {score == null ? (
          <span className="text-[10px] font-bold text-gray-400 font-mono">N/A</span>
        ) : (
          <>
            <span className="font-mono font-black leading-none" style={{ fontSize, color }}>{Math.round(score)}</span>
            <span className="text-[8px] font-bold uppercase tracking-widest text-gray-400 mt-1">{label}</span>
          </>
        )}
      </div>
    </div>
  );
};

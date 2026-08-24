import React from 'react';
import { leaguePercentile } from '../../services/intelligence/stats';

interface PercentileBarProps {
  score: number | null;
  label: string;
  rawValue?: string;
  color?: string;
}

/**
 * Horizontal intelligence bar: 0-100 z-score with quartile ticks,
 * animated width, and honest league-percentile readout.
 */
export const PercentileBar: React.FC<PercentileBarProps> = ({
  score,
  label,
  rawValue,
  color = '#22d3ee',
}) => {
  const pct = leaguePercentile(score);
  const barColor = color;

  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-semibold text-gray-400 w-24 shrink-0 truncate" title={label}>
        {label}
      </span>
      <div className="flex-1 relative h-2.5 bg-white/[0.06] rounded-full overflow-visible">
        {/* Quartile ticks at 25/50/75 */}
        {[25, 50, 75].map(t => (
          <span
            key={t}
            className="absolute top-1/2 -translate-y-1/2 w-px h-1.5 bg-white/20"
            style={{ left: `${t}%` }}
          />
        ))}
        {/* League-average marker */}
        <span className="absolute top-1/2 -translate-y-1/2 w-px h-3 bg-gray-400/70" style={{ left: '50%' }} />
        {/* Score fill — center-out for below-50, left-anchored above */}
        {score != null && (
          <div
            className="absolute top-0 h-full rounded-full transition-all duration-700"
            style={{
              left: score >= 50 ? '50%' : `${score}%`,
              width: `${Math.abs(score - 50)}%`,
              background: barColor,
              opacity: 0.85,
              minWidth: 3,
            }}
          />
        )}
        {/* Score dot */}
        {score != null && (
          <span
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-vantage-bg"
            style={{ left: `calc(${Math.min(98, Math.max(2, score))}% - 5px)`, background: barColor }}
          />
        )}
      </div>
      <span className="text-[10px] font-mono font-bold text-white w-7 text-right shrink-0">
        {score != null ? Math.round(score) : '—'}
      </span>
      <span className={`text-[8px] font-mono w-12 text-right shrink-0 ${pct != null && pct >= 75 ? 'text-emerald-400' : 'text-gray-500'}`}>
        {pct != null ? `P${pct}` : ''}
      </span>
    </div>
  );
};

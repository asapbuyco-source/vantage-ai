import React from 'react';

interface TugOfWarRow {
  label: string;
  homeValue: number | null;
  awayValue: number | null;
  /** Higher is better (default) or lower is better (e.g. PPDA, xGA) */
  betterIs?: 'higher' | 'lower';
}

interface TugOfWarProps {
  rows: TugOfWarRow[];
  homeColor?: string;
  awayColor?: string;
}

/**
 * Mirrored tug-of-war bars: home grows left from center, away grows right.
 * The winning side is full opacity, losing side dimmed — instant visual winner.
 */
export const TugOfWar: React.FC<TugOfWarProps> = ({
  rows,
  homeColor = '#22d3ee',
  awayColor = '#a855f7',
}) => {
  return (
    <div className="space-y-2.5">
      {rows.map(row => {
        const h = row.homeValue;
        const a = row.awayValue;
        const hasData = h != null && a != null && h > 0 && a > 0;

        let homePct = 0;
        let awayPct = 0;
        if (hasData && h != null && a != null) {
          const total = h + a;
          homePct = (h / total) * 100;
          awayPct = (a / total) * 100;
        }
        const homeWins = hasData && row.betterIs === 'lower' ? (h as number) < (a as number) : (h as number) > (a as number);

        const fmtV = (v: number | null) => (v == null ? '—' : v.toFixed(2));

        return (
          <div key={row.label}>
            <div className="flex items-center justify-between text-[10px] font-mono mb-1">
              <span className={hasData && homeWins ? 'font-black' : 'text-gray-400'} style={{ color: !hasData ? undefined : homeWins ? homeColor : '#94A3B8' }}>
                {fmtV(h)}
              </span>
              <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">{row.label}</span>
              <span className={hasData && !homeWins ? 'font-black' : 'text-gray-400'} style={{ color: !hasData ? undefined : !homeWins ? awayColor : '#94A3B8' }}>
                {fmtV(a)}
              </span>
            </div>
            <div className="flex h-1.5 gap-1">
              {/* Home bar — right-aligned, grows from center */}
              <div className="flex-1 flex justify-end bg-white/5 dark:bg-white/[0.04] rounded-l-full overflow-hidden">
                {homePct > 0 && (
                  <div
                    className="h-full rounded-l-full transition-all duration-700"
                    style={{ width: `${Math.max(6, homePct)}%`, background: homeColor, opacity: hasData && homeWins ? 1 : 0.45 }}
                  />
                )}
              </div>
              {/* Away bar — left-aligned, grows from center */}
              <div className="flex-1 flex bg-white/5 dark:bg-white/[0.04] rounded-r-full overflow-hidden">
                {awayPct > 0 && (
                  <div
                    className="h-full rounded-r-full transition-all duration-700"
                    style={{ width: `${Math.max(6, awayPct)}%`, background: awayColor, opacity: hasData && !homeWins ? 1 : 0.45 }}
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

import React from 'react';

export interface RadarPoint {
  dimension: string;
  value: number | null;
  value2?: number | null;
}

interface RadarCompareProps {
  data: RadarPoint[];
  size?: number;
  primaryColor?: string;
  secondaryColor?: string;
  primaryName?: string;
  secondaryName?: string;
}

/**
 * Lightweight custom-SVG radar for team dimension comparison.
 * Draws: league-average dashed ring at 50, optional second series,
 * axis labels, and value dots. No chart-library dependency.
 */
export const RadarCompare: React.FC<RadarCompareProps> = ({
  data,
  size = 260,
  primaryColor = '#22d3ee',
  secondaryColor = '#a855f7',
  primaryName = 'Home',
  secondaryName = 'Away',
}) => {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 34;
  const n = data.length;

  if (n < 3) return null;

  // Angle for each axis, starting at top
  const angleFor = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pointAt = (i: number, r: number): [number, number] => [
    cx + Math.cos(angleFor(i)) * r,
    cy + Math.sin(angleFor(i)) * r,
  ];
  const polygonFor = (key: 'value' | 'value2'): string => {
    return data
      .map((d, i) => {
        const v = d[key];
        if (v == null) return null;
        const [x, y] = pointAt(i, (Math.min(100, Math.max(0, v)) / 100) * radius);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');
  };

  const hasSecondary = data.some(d => d.value2 != null);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        {/* Grid rings at 25/50/75/100 */}
        {[0.25, 0.5, 0.75, 1].map(frac => (
          <polygon
            key={frac}
            points={data.map((_, i) => pointAt(i, radius * frac).map(v => v.toFixed(1)).join(',')).join(' ')}
            fill="none"
            stroke="rgba(148,163,184,0.14)"
            strokeWidth={1}
          />
        ))}
        {/* Axis spokes */}
        {data.map((_, i) => {
          const [x, y] = pointAt(i, radius);
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(148,163,184,0.12)" strokeWidth={1} />;
        })}
        {/* League-average ring at 50 — the honesty baseline */}
        <polygon
          points={data.map((_, i) => pointAt(i, radius * 0.5).map(v => v.toFixed(1)).join(',')).join(' ')}
          fill="rgba(148,163,184,0.05)"
          stroke="#94A3B8"
          strokeWidth={1.3}
          strokeDasharray="5 5"
        />
        {/* Primary series */}
        <polygon
          points={polygonFor('value')}
          fill={`${primaryColor}26`}
          stroke={primaryColor}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {data.map((d, i) => {
          if (d.value == null) return null;
          const [x, y] = pointAt(i, (d.value / 100) * radius);
          return <circle key={`p${i}`} cx={x} cy={y} r={3} fill={primaryColor} />;
        })}
        {/* Secondary series */}
        {hasSecondary && (
          <>
            <polygon
              points={polygonFor('value2')}
              fill={`${secondaryColor}1F`}
              stroke={secondaryColor}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {data.map((d, i) => {
              if (d.value2 == null) return null;
              const [x, y] = pointAt(i, (d.value2 / 100) * radius);
              return <circle key={`s${i}`} cx={x} cy={y} r={3} fill={secondaryColor} />;
            })}
          </>
        )}
        {/* Axis labels */}
        {data.map((d, i) => {
          const [x, y] = pointAt(i, radius + 18);
          return (
            <text
              key={`l${i}`}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={9}
              fontWeight={700}
              fontFamily="'JetBrains Mono', monospace"
              fill="#94A3B8"
              style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}
            >
              {d.dimension}
            </text>
          );
        })}
      </svg>
    </div>
  );
};

interface LegendProps {
  primaryColor?: string;
  secondaryColor?: string;
  primaryName?: string;
  secondaryName?: string;
}

export const RadarLegend: React.FC<LegendProps> = ({
  primaryColor = '#22d3ee',
  secondaryColor = '#a855f7',
  primaryName = 'Home',
  secondaryName = 'Away',
}) => (
  <div className="flex items-center justify-center gap-4 text-[10px] font-bold">
    <span className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full inline-block" style={{ background: primaryColor }} />
      {primaryName}
    </span>
    {secondaryName && (
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full inline-block" style={{ background: secondaryColor }} />
        {secondaryName}
      </span>
    )}
    <span className="flex items-center gap-1.5 text-gray-400">
      <span className="inline-block w-3 border-t border-dashed border-gray-400" />
      League avg
    </span>
  </div>
);

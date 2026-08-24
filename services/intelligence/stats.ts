// Vantage Intelligence — scoring helpers (ported from vantage-intelligence-app-development)

export function zscore(value: number, avg: number, std: number): number {
  return Math.min(100, Math.max(0, Math.round(50 + ((value - avg) / std) * 15)));
}

export function fmt(v: number | null | undefined, decimals = 2): string {
  if (v == null) return '—';
  return v.toFixed(decimals);
}

export function getScoreColor(score: number | null): string {
  if (score == null) return '#64748B';
  if (score >= 80) return '#059669';
  if (score >= 65) return '#10B981';
  if (score >= 50) return '#D97706';
  if (score >= 35) return '#EA580C';
  return '#DC2626';
}

export function getScoreLabel(score: number | null): string {
  if (score == null) return 'Data unavailable';
  if (score >= 80) return 'Elite';
  if (score >= 65) return 'Strong';
  if (score >= 50) return 'League average';
  if (score >= 35) return 'Below average';
  return 'Weak';
}

// Normal CDF approximation (Abramowitz–Stegun)
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export function leaguePercentile(score: number | null): number | null {
  if (score == null) return null;
  const z = (score - 50) / 15;
  return Math.round(normalCdf(z) * 100);
}

export interface MatchPrediction {
  home: number;
  draw: number;
  away: number;
}

/** Translate an attacking dimension score into a fun goal projection. */
export function projectGoals(attackingScore: number | null): number | null {
  if (attackingScore == null) return null;
  const g = 1.35 * Math.pow(Math.max(20, attackingScore) / 50, 1.25);
  return Math.round(Math.min(4, Math.max(0.3, g)) * 10) / 10;
}

/** Transparent neutral-venue model over the VTI gap. Model estimate, not a guarantee. */
export function predictMatchup(homeIndex: number | null, awayIndex: number | null): MatchPrediction | null {
  if (homeIndex == null || awayIndex == null) return null;
  const diff = homeIndex - awayIndex;
  const score = 1 / (1 + Math.exp(-diff / 60));
  const pDraw = 0.26 * Math.exp(-((diff / 90) ** 2));
  const pHome = Math.max(0.02, score - pDraw / 2);
  const home = Math.round(pHome * 100);
  const draw = Math.round(pDraw * 100);
  const away = 100 - home - draw;
  return { home, draw, away };
}

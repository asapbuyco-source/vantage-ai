/**
 * trackRecord.ts — reads /api/stats/record (win-rate + odds-weighted ROI).
 * Powers the public track-record display and the social-proof strips.
 */
export interface MarketRecord {
  won: number; lost: number; void: number;
  staked: number; returned: number; roi: number; winRate: number;
}
export interface TrackRecord {
  ok: boolean; period_days: number;
  graded: { won: number; lost: number; void: number; total: number };
  winRate: number; staked: number; returned: number; roi: number;
  byMarket: Record<string, MarketRecord>;
}

const backendUrl = () => {
  const url = import.meta.env.VITE_BACKEND_URL as string | undefined;
  return url ? url.replace(/\/$/, '') : '';
};

export async function getTrackRecord(days = 30): Promise<TrackRecord | null> {
  const base = backendUrl();
  if (!base) return null;
  try {
    const r = await fetch(`${base}/api/stats/record?days=${days}`);
    if (!r.ok) return null;
    const j = (await r.json()) as TrackRecord;
    return j && j.ok ? j : null;
  } catch {
    return null;
  }
}

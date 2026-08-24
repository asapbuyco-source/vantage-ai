/**
 * Vantage Intelligence data access — reads the live Supabase Postgres
 * (public anon read via RLS). Tables: player_intelligence, team_intelligence,
 * match_intelligence, league_baselines.
 *
 * Also provides the api-football → intelligence-DB name matching layer so
 * MatchDetails can hydrate Team Strength sections for its fixtures.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  TeamIntelligence,
  PlayerIntelligence,
  SearchResult,
} from './types';

export interface TeamBaseline {
  [metric: string]: { avg: number; std: number } | null;
}

export interface TeamReport {
  team: TeamIntelligence;
  baseline: TeamBaseline | null;
}

// Publishable anon key — safe for client bundles (RLS enforces read-only).
const INTEL_URL = (import.meta as any).env?.VITE_INTEL_SUPABASE_URL as string | undefined;
const INTEL_KEY = (import.meta as any).env?.VITE_INTEL_SUPABASE_ANON_KEY as string | undefined;
const SUPABASE_URL = INTEL_URL || 'https://fwatymrvrtvcixtpbncu.supabase.co';
const SUPABASE_ANON_KEY = INTEL_KEY || 'sb_publishable_JCgVDFMMrlmGBXHyH3xFtw_VSbWwe8K';

let client: SupabaseClient | null = null;

function db(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
  }
  return client;
}

type Row = Record<string, unknown>;

function mapTeam(row: Row): TeamIntelligence {
  return {
    team_id: String(row.id),
    team_name: String(row.team_name),
    league: String(row.league),
    season: String(row.season),
    last_updated: String(row.last_updated ?? ''),
    raw_stats: (row.raw_stats as TeamIntelligence['raw_stats']) ?? ({} as TeamIntelligence['raw_stats']),
    scores: (row.scores as TeamIntelligence['scores']) ?? ({} as TeamIntelligence['scores']),
    squad: (row.squad as TeamIntelligence['squad']) ?? [],
  };
}

// ── Season ────────────────────────────────────────────────────────────────────

let seasonCache: string | null = null;
let seasonPromise: Promise<string | null> | null = null;

export async function getLatestSeason(): Promise<string | null> {
  if (seasonCache) return seasonCache;
  if (!seasonPromise) {
    seasonPromise = (async () => {
      try {
        const { data } = await db()
          .from('team_intelligence')
          .select('season')
          .order('season', { ascending: false })
          .limit(1);
        if (!data || data.length === 0) return null;
        seasonCache = String((data[0] as Row).season);
        return seasonCache;
      } catch {
        return null;
      }
    })();
  }
  return seasonPromise;
}

// ── Name matching: api-football names → intelligence DB names ────────────────

/** Normalize a club name into comparable tokens. */
export function normalizeClubName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/\b(fc|cf|sc|afc|club|ac|as|ss|ssc|us|ud|cd|sk|fk|bk|if|sv|vfb|bsc|tsv|scp|ogc|losc|rcl|st|sp|cpa)\b/g, ' ')
    .replace(/\d{2,4}/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find a team's intelligence report by fuzzy-matching the fixture's team name.
 * Uses trigram-ish ilike on progressively shorter normalized prefixes.
 */
export async function findTeamByName(name: string): Promise<TeamReport | null> {
  if (!name) return null;
  const season = await getLatestSeason();
  if (!season) return null;

  const norm = normalizeClubName(name);
  const candidates = [name.trim(), norm];
  // Try significant words longest-first (e.g. "manchester city" → ["manchester", "city"])
  const words = norm.split(' ').filter(w => w.length >= 4);
  if (words.length > 1) candidates.push(words[0], words[words.length - 1]);

  for (const q of candidates) {
    if (!q || q.length < 3) continue;
    try {
      const { data, error } = await db()
        .from('team_intelligence')
        .select('*')
        .eq('season', season)
        .ilike('team_name', `%${q}%`)
        .limit(1);
      if (!error && data && data.length > 0) {
        const team = mapTeam(data[0] as Row);
        const baseline = await fetchTeamBaseline(team.league, team.season);
        return { team, baseline };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function fetchTeamBaseline(league: string, season: string): Promise<TeamBaseline | null> {
  try {
    const { data, error } = await db()
      .from('league_baselines')
      .select('team')
      .eq('league', league)
      .eq('season', season)
      .maybeSingle();
    if (error || !data) return null;
    return (data.team as TeamBaseline) ?? null;
  } catch {
    return null;
  }
}

// ── Direct fetchers ───────────────────────────────────────────────────────────

export async function fetchTeamById(teamId: string): Promise<TeamReport | null> {
  const season = await getLatestSeason();
  if (!season) return null;
  const { data, error } = await db()
    .from('team_intelligence')
    .select('*')
    .eq('id', teamId)
    .eq('season', season)
    .maybeSingle();
  if (error || !data) return null;
  const team = mapTeam(data as Row);
  const baseline = await fetchTeamBaseline(team.league, team.season);
  return { team, baseline };
}

export async function fetchSquadPlayers(teamId: string): Promise<PlayerIntelligence[]> {
  const season = await getLatestSeason();
  if (!season) return [];
  const { data, error } = await db()
    .from('player_intelligence')
    .select('*')
    .eq('team_id', teamId)
    .eq('season', season)
    .order('scores->vpii', { ascending: false, nullsFirst: false })
    .limit(14);
  if (error || !data) return [];
  return (data as Row[]).map(mapPlayerRow);
}

function mapPlayerRow(r: Row): PlayerIntelligence {
  return {
    player_id: String(r.id),
    player_name: String(r.player_name),
    team: String(r.team),
    league: String(r.league),
    season: String(r.season),
    position: String(r.position ?? ''),
    minutes_played: Number(r.minutes_played ?? 0),
    last_updated: '',
    raw_stats: ((r.raw_stats as any) ?? {}) as PlayerIntelligence['raw_stats'],
    scores: ((r.scores as any) ?? {}) as PlayerIntelligence['scores'],
  };
}

export interface PlayerBaseline {
  [metric: string]: { avg: number; std: number } | null;
}

export async function fetchPlayerById(playerId: string): Promise<PlayerIntelligence | null> {
  const season = await getLatestSeason();
  if (!season) return null;
  const { data, error } = await db()
    .from('player_intelligence')
    .select('*')
    .eq('id', playerId)
    .eq('season', season)
    .maybeSingle();
  if (error || !data) return null;
  return mapPlayerRow(data as Row);
}

export interface CoverageStats {
  players: number;
  teams: number;
  updated: string | null;
}

/** The house team: top-N players by VPII across the whole database. */
export async function fetchTopXI(limit: number = 11): Promise<PlayerIntelligence[]> {
  const season = await getLatestSeason();
  if (!season) return [];
  const { data, error } = await db()
    .from('player_intelligence')
    .select('*')
    .eq('season', season)
    .order('scores->vpii', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as Row[]).map(mapPlayerRow);
}

export async function fetchPlayersByIds(ids: string[]): Promise<PlayerIntelligence[]> {
  const clean = [...new Set(ids.filter(Boolean))];
  if (clean.length === 0) return [];
  const season = await getLatestSeason();
  if (!season) return [];
  const { data, error } = await db()
    .from('player_intelligence')
    .select('*')
    .in('id', clean)
    .eq('season', season);
  if (error || !data) return [];
  return (data as Row[]).map(mapPlayerRow);
}

export async function fetchCoverageStats(): Promise<CoverageStats | null> {
  try {
    const [p, t, u] = await Promise.all([
      db().from('player_intelligence').select('*', { count: 'exact', head: true }),
      db().from('team_intelligence').select('*', { count: 'exact', head: true }),
      db().from('team_intelligence').select('last_updated').order('last_updated', { ascending: false }).limit(1),
    ]);
    return {
      players: p.count ?? 0,
      teams: t.count ?? 0,
      updated: u.data?.[0]?.last_updated ?? null,
    };
  } catch {
    return null;
  }
}

export async function searchIntelligence(query: string, filter?: 'player' | 'team'): Promise<SearchResult[]> {
  const q = query.trim().replace(/\*/g, '');
  if (q.length < 2) return [];
  const season = await getLatestSeason();
  if (!season) return [];

  const results: SearchResult[] = [];
  const run = async (fn: () => Promise<SearchResult[]>) => {
    try { results.push(...await fn()); } catch { /* ignore */ }
  };

  if (!filter || filter === 'player') {
    await run(async () => {
      const { data, error } = await db()
        .from('player_intelligence')
        .select('id,player_name,team,league,position')
        .eq('season', season)
        .or(`player_name.ilike.*${q}*,team.ilike.*${q}*`)
        .limit(6);
      if (error || !data) return [];
      return (data as Row[]).map(r => ({
        id: String(r.id),
        type: 'player' as const,
        name: String(r.player_name),
        meta: `${r.team} · ${r.league} · ${r.position}`,
      }));
    });
  }

  if (!filter || filter === 'team') {
    await run(async () => {
      const { data, error } = await db()
        .from('team_intelligence')
        .select('id,team_name,league')
        .eq('season', season)
        .or(`team_name.ilike.*${q}*,league.ilike.*${q}*`)
        .limit(5);
      if (error || !data) return [];
      return (data as Row[]).map(r => ({
        id: String(r.id),
        type: 'team' as const,
        name: String(r.team_name),
        meta: String(r.league),
      }));
    });
  }

  return results.slice(0, 10);
}

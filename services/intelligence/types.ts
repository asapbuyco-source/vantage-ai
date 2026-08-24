// Vantage Intelligence — data types (ported from vantage-intelligence-app-development)

export interface PlayerRawStats {
  xg_per90: number | null;
  xa_per90: number | null;
  goals_per90?: number | null;
  assists_per90?: number | null;
  shots_per90?: number | null;
  key_passes_per90?: number | null;
  goals_minus_xg?: number | null;
  xgchain_per90?: number | null;
  xgbuildup_per90?: number | null;
  prog_passes_per90: number | null;
  prog_carries_per90: number | null;
  pressures_per90: number | null;
  pressure_success_pct: number | null;
  sca_per90: number | null;
  tackles_per90: number | null;
  interceptions_per90: number | null;
  dribble_success_pct: number | null;
  turnovers_per90: number | null;
  miscontrols_per90: number | null;
  shot_on_target_pct: number | null;
  carries_final_third_per90: number | null;
}

export interface PlayerScores {
  finishing: number | null;
  creativity: number | null;
  progression: number | null;
  decision_making: number | null;
  defensive: number | null;
  possession_value: number | null;
  physical: null;
  vpii: number | null;
}

export interface PlayerIntelligence {
  player_id: string;
  player_name: string;
  team: string;
  league: string;
  season: string;
  position: string;
  minutes_played: number;
  last_updated: string;
  raw_stats: PlayerRawStats;
  scores: PlayerScores;
}

export interface TeamRawStats {
  xg_per90: number | null;
  goals_per90?: number | null;
  shots_per90?: number | null;
  xa_per90: number | null;
  key_passes_per90?: number | null;
  xga_per90: number | null;
  ppda: number | null;
  deep_per90?: number | null;
  xgchain_per90?: number | null;
  xgbuildup_per90?: number | null;
  prog_passes_per90: number | null;
  prog_carries_per90: number | null;
  pressures_per90: number | null;
  sca_per90: number | null;
  tackles_per90: number | null;
  interceptions_per90: number | null;
  xgot_per90: number | null;
}

export interface TeamScores {
  attacking: number | null;
  creation: number | null;
  progression: number | null;
  defensive: number | null;
  possession_value: number | null;
  consistency: number | null;
  vti: number | null;
}

export interface TeamIntelligence {
  team_id: string;
  team_name: string;
  league: string;
  season: string;
  last_updated: string;
  raw_stats: TeamRawStats;
  scores: TeamScores;
  squad?: SquadPlayer[];
}

export interface SquadPlayer {
  player_id: string;
  player_name: string;
  position: string;
  vpii: number;
  minutes_played: number;
}

export interface PositionBattle {
  position: string;
  home_player: { name: string; attacking_score: number; defensive_score: number };
  away_player: { name: string; attacking_score: number; defensive_score: number };
}

export interface MatchIntelligence {
  match_id: string;
  home_team: TeamIntelligence;
  away_team: TeamIntelligence;
  battles: PositionBattle[];
}

export type SearchResultType = 'player' | 'team' | 'match';

export interface SearchResult {
  id: string;
  type: SearchResultType;
  name: string;
  meta: string;
}

export type TeamDimensionKey = keyof Omit<TeamScores, 'vti'>;

export const TEAM_DIMENSIONS: { key: TeamDimensionKey; label: string }[] = [
  { key: 'attacking', label: 'Attacking' },
  { key: 'creation', label: 'Creation' },
  { key: 'progression', label: 'Progression' },
  { key: 'defensive', label: 'Defensive' },
  { key: 'possession_value', label: 'Possession' },
  { key: 'consistency', label: 'Consistency' },
];

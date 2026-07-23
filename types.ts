
export type NavigationTab = 'home' | 'free' | 'vip' | 'guide' | 'profile' | 'admin' | 'vault' | 'arb' | 'concierge' | 'stats' | 'results' | 'live';

export type Language = 'en' | 'fr';

export type Sport = 'football' | 'basketball' | 'cricket';

export interface Match {
  id: string;
  league: string;
  leagueId?: number;
  seasonId?: number;
  fixtureId?: number;
  homeTeam: string;
  homeTeamId?: number;
  awayTeam: string;
  awayTeamId?: number;
  time: string;
  prediction: string;
  prediction_en?: string;
  prediction_fr?: string;
  confidence: number;
  odds: number;
  category: 'safe' | 'value' | 'risky' | 'lean' | 'no_edge';
  analysis?: string;
  analysis_en?: string;
  analysis_fr?: string;
  isLive?: boolean;
  homeTeamLogo?: string;
  awayTeamLogo?: string;
  sport?: Sport;
  status?: 'won' | 'lost' | 'void' | 'pending';
  score?: string;
  graded_at?: string;
  graded_by?: 'live_auto' | 'grading_engine' | 'chatgpt' | 'admin';
  live_state?: string;
  live_minute?: number;
  homeForm?: string;
  awayForm?: string;
  homeWinRate?: number;
  awayWinRate?: number;
  homeAvgScored?: number;
  awayAvgScored?: number;
  homeAvgConceded?: number;
  awayAvgConceded?: number;
  homeCleanSheetRate?: number;
  awayCleanSheetRate?: number;
  h2hHomeWins?: number;
  h2hAwayWins?: number;
  h2hDraws?: number;
  h2hLast5Goals?: string;
  homeInjured?: string[];
  awayInjured?: string[];
  expected_value?: number;
  ev_pct?: number;
  kelly_stake?: number;
  market_prob?: number;
  market_implied_prob?: number;
  inefficiency?: number;
  raw_probability?: number;
  calibrated_probability?: number;
  calibration_factor?: number;
  calibration_tier?: 'stable' | 'watch' | 'fragile' | 'none' | string;
  odds_fetched_at?: string;
  odds_last_bookmaker_update?: string;
  odds_age_minutes?: number | null;
  odds_fresh?: boolean;
  vault_eligible?: boolean;
  max_stake_pct?: number;
  provider_source?: string;
  bet_type?: string;
  expected_goals_home?: number;
  expected_goals_away?: number;
  model?: 'quant' | 'ai';
  model_confidence?: number;
  model_agreement?: number;
  data_quality?: number;
  home_win_prob?: number;
  draw_prob?: number;
  away_win_prob?: number;
  over25_prob?: number;
  under25_prob?: number;
  over15_prob?: number;
  over35_prob?: number;
  btts_prob?: number;
  double_chance_1x?: number;
  double_chance_x2?: number;
  double_chance_12?: number;
  // ── Other Goal Markets ────────────────────────────────────────────────────
  over05_prob?: number;
  under05_prob?: number;
  over45_prob?: number;
  under45_prob?: number;
  under15_prob?: number;
  under35_prob?: number;
  // ── First Half Market Probabilities ───────────────────────────────────────
  fh_over05_prob?: number;
  fh_over15_prob?: number;
  fh_btts_prob?: number;
  fh_home_win_prob?: number;
  fh_draw_prob?: number;
  fh_away_win_prob?: number;
  expected_corners?: number;
  over85_corners_prob?: number;
  over95_corners_prob?: number;
  top_scorelines?: Array<{ score: string; prob: number }>;
  all_value_bets?: Array<{ market: string; prob: number; raw_prob?: number; odds: number; ev: number; calibration_tier?: string }>;
  value_rank?: 'high' | 'medium' | 'low' | 'none';
  league_tier?: number;
  home_form?: string;
  away_form?: string;
  home_win_rate?: number;
  away_win_rate?: number;
  home_avg_scored?: number;
  away_avg_scored?: number;
  home_avg_conceded?: number;
  away_avg_conceded?: number;
  home_clean_sheet_rate?: number;
  away_clean_sheet_rate?: number;
  home_xg_avg?: number;
  away_xg_avg?: number;
  home_possession?: number;
  away_possession?: number;
  home_shots_on_target?: number;
  away_shots_on_target?: number;
  h2h_home_wins?: number;
  h2h_away_wins?: number;
  h2h_draws?: number;
  fixture_id?: number | string;
  kickoff_local?: string;
  probability?: number;
  home_team?: string;
  away_team?: string;
  home_team_logo?: string;
  away_team_logo?: string;
  // ── Contextual Intelligence Fields (Evolution Plan) ───────────────────────
  weather?: string;
  weather_penalty?: number;
  line_signal?: string;
  line_shift?: number;
  fatigue_risk?: string;
  injury_risk?: string;
  home_days_rest?: number;
  away_days_rest?: number;
  home_sidelined_count?: number;
  away_sidelined_count?: number;
  home_fatigue_penalty?: number;
  away_fatigue_penalty?: number;
  home_injury_penalty?: number;
  away_injury_penalty?: number;
  btts_blanking_risk?: boolean;
  upset_alert?: boolean;
  vault_priority_boost?: boolean;
  hedge_suggestion?: { market: string; probability: number; reason: string } | null;
  result_confidence?: number;
  goals_confidence?: number;
  btts_confidence?: number;
}

export interface LiveEvent {
  id: number;
  type: string;
  name: string;
  playerName?: string;
  playerNameOut?: string;
  minute: number;
  extraMinute?: number;
  teamId?: number;
  isHome?: boolean;
  result?: string;
}

export interface LiveMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamLogo?: string;
  awayTeamLogo?: string;
  homeTeamId?: number;
  awayTeamId?: number;
  homeScore: number;
  awayScore: number;
  league: string;
  leagueId?: number;
  stateShort: string;
  stateLong: string;
  minute: number;
  events: LiveEvent[];
  updatedAt?: string;
}

export interface MatchNews {
  id: number;
  fixtureId: number;
  leagueId?: number;
  title: string;
  body?: string;
  type: string;
}

export interface StatValue {
  home: number | null;
  away: number | null;
}
export interface MatchStats {
  possession?: StatValue;
  shots?: StatValue;
  shots_on_target?: StatValue;
  corners?: StatValue;
  fouls?: StatValue;
  yellow_cards?: StatValue;
  offsides?: StatValue;
}
export interface MatchStatsData {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  stats: MatchStats;
}

export interface AccumulatorLeg {
  fixture_id: string;
  home_team: string;
  away_team: string;
  market: string;
  odds: number;
  model_prob: number;
  expected_value: number;
  league: string;
}

export interface AccumulatorTicket {
  tier: string;
  tier_label: string;
  tier_description: string;
  tier_icon: string;
  leg_count: number;
  combined_odds: number;
  combined_prob: number;
  combined_ev: number;
  kelly_stake: number;
  kelly_stake_unit: string;
  risk_level?: string;
  risk_warning?: string;
  legs: AccumulatorLeg[];
}

export interface AccumulatorSet {
  baseline?: AccumulatorTicket[];
  alpha_edge?: AccumulatorTicket[];
  syndicate?: AccumulatorTicket[];
  variance_play?: AccumulatorTicket[];
}

export interface UserStats {
  balance: number;
  totalWon: number;
  winRate: number;
  membership: 'Free' | 'VIP';
}

export interface VaultProgress {
  currentDay: number;
  bankroll: number;
  startingBankroll?: number;
  startDate: string;
  completedDays: number[];
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  isVip: boolean;
  isAdmin?: boolean;
  isBlocked?: boolean;
  country?: string;
  vipExpiry?: string;
  vipPlan?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
  totalPaid?: number;
  createdAt?: string;
  referralCode?: string;
  referredBy?: string;
  referralCount?: number;
  referralEarnings?: number;
  lifetimeEarnings?: number;
  vaultProgress?: VaultProgress;
  portfolioBankroll?: number;
  riskTolerance?: 'low' | 'medium' | 'high';
}

export interface PayoutRequest {
  id: string;
  userId: string;
  userEmail: string;
  amount: number;
  status: 'pending' | 'paid' | 'rejected';
  date: string;
  phoneNumber: string;
  paymentMethod: string;
}

export interface BettingHistoryItem {
  id: string;
  match: string;
  prediction: string;
  status: 'won' | 'lost' | 'pending';
  amount: number;
  date: string;
}

export interface DailyAnalysis {
  date: string;
  matches: Match[];
  rawFixtures?: Match[];
  accumulators?: AccumulatorSet;
  generatedAt?: string;
}

export interface TeamAsset {
  id: string;
  name: string;
  logoUrl: string;
}

export interface WinRateStats {
  daily: number;
  weekly: number;
  monthly: number;
  streak: number;
  todayWon: number;
  todayTotal: number;
}

export interface SavedPick {
  id: string;
  homeTeam: string;
  awayTeam: string;
  prediction: string;
  confidence: number;
  odds: number;
  league: string;
  homeTeamLogo?: string;
  awayTeamLogo?: string;
  sport?: Sport;
  savedAt: string;
}

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

export interface VaultPick {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  market: string;
  odds: number;
  lockedOdds?: number;
  kickoffUtc?: string;
  lockedAt?: string;
  generatedAt?: string;
  strategyVersion?: string;
  evPct?: number;
  probability?: number;
  expectedValue?: number;
  inefficiency?: number;
  category?: string;
  valueRank?: string;
  qualityScore?: number;
  oddsFresh?: boolean;
  oddsAgeMinutes?: number | null;
  calibrationTier?: string;
  calibrationFactor?: number;
  rawProbability?: number | null;
  providerSource?: string;
  source?: 'vault_strategy';
  kellyStakePct: number;
  stakeAmount: number;
  result: 'pending' | 'won' | 'lost' | 'void';
  profit: number | null;
  confirmed: boolean;
}

export interface VaultDay {
  dayNumber: number;
  dateKey: string;
  picks: VaultPick[];
  bankrollStart: number;
  bankrollEnd: number | null;
  status: 'locked' | 'active' | 'completed' | 'missed';
  lockedAt?: string;
  decisionTimeLocal?: string;
  strategyVersion?: string;
  strategyName?: string;
}

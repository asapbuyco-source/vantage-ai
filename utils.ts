import { Match } from './types';

export interface ProbPick {
  name: string;
  prob: number;
}

export const getTopProbPicks = (match: Match): ProbPick[] => {
  const markets = [
    { name: 'Over 0.5 Goals', prob: match.over05_prob ?? 0 },
    { name: 'Over 1.5 Goals', prob: match.over15_prob ?? 0 },
    { name: 'Over 2.5 Goals', prob: match.over25_prob ?? 0 },
    { name: 'Over 3.5 Goals', prob: match.over35_prob ?? 0 },
    { name: 'Over 4.5 Goals', prob: match.over45_prob ?? 0 },
    { name: 'Under 1.5 Goals', prob: match.under15_prob ?? 0 },
    { name: 'Under 2.5 Goals', prob: match.under25_prob ?? 0 },
    { name: 'Under 3.5 Goals', prob: match.under35_prob ?? 0 },
    { name: 'Under 4.5 Goals', prob: match.under45_prob ?? 0 },
    { name: 'BTTS', prob: match.btts_prob ?? 0 },
    { name: 'Home Win', prob: match.home_win_prob ?? 0 },
    { name: 'Draw', prob: match.draw_prob ?? 0 },
    { name: 'Away Win', prob: match.away_win_prob ?? 0 },
    { name: 'DC 1X', prob: match.double_chance_1x ?? 0 },
    { name: 'DC X2', prob: match.double_chance_x2 ?? 0 },
    { name: 'DC 12', prob: match.double_chance_12 ?? 0 },
    { name: '1H Over 0.5', prob: match.fh_over05_prob ?? 0 },
    { name: '1H Over 1.5', prob: match.fh_over15_prob ?? 0 },
    { name: '1H BTTS', prob: match.fh_btts_prob ?? 0 },
  ];

  // Sort by probability descending
  markets.sort((a, b) => b.prob - a.prob);

  if (markets.length === 0 || markets[0].prob === 0) {
    return [];
  }

  const topPick = markets[0];
  const picks = [topPick];

  if (topPick.name === 'Over 1.5 Goals' || topPick.name === 'Over 0.5 Goals') {
    const nextBest = markets.find(m => m.name !== 'Over 1.5 Goals' && m.name !== 'Over 0.5 Goals');
    if (nextBest && nextBest.prob > 0 && !picks.includes(nextBest)) picks.push(nextBest);
  } else if (markets.length > 1 && markets[1].prob > 0) {
    if (topPick.prob - markets[1].prob <= 0.02) picks.push(markets[1]);
  }

  return picks;
};

export const getPrimaryPredictionText = (match: Match, language: string): string => {
  const topPicks = getTopProbPicks(match);
  if (topPicks.length > 0) {
    return topPicks.map(p => `${p.name} ${Math.round(p.prob * 100)}%`).join(' / ');
  }
  if (language === 'fr') return match.prediction_fr || match.prediction || '';
  return match.prediction_en || match.prediction || '';
};

export const getTopPickText = (match: Match): string => {
  const picks = getTopProbPicks(match);
  if (picks.length > 0) return `${picks[0].name} ${Math.round(picks[0].prob * 100)}%`;
  return match.prediction_en || match.prediction || '';
};

export const getPrimaryPredictionProb = (match: Match): number => {
  const topPicks = getTopProbPicks(match);
  if (topPicks.length > 0) {
    return Math.round(topPicks[0].prob * 100);
  }
  return match.confidence || 0;
};

export interface SmartBadge {
  icon: string;
  text: string;
  color: string;
  reason: string;
}

export const getSmartBadges = (match: any): SmartBadge[] => {
  const badges: SmartBadge[] = [];

  // Sharp Money signal
  if (match.line_signal === 'sharp_money_agrees' && Math.abs(match.line_shift || 0) > 0.02) {
    badges.push({
      icon: '📈',
      text: 'Sharp Money',
      color: 'text-emerald-400 bg-emerald-500/10',
      reason: 'Professional money moved this line in our favor',
    });
  }
  if (match.line_signal === 'sharp_money_disagrees' && Math.abs(match.line_shift || 0) > 0.04) {
    badges.push({
      icon: '📉',
      text: 'Sharp Fade',
      color: 'text-rose-400 bg-rose-500/10',
      reason: 'Smart money moved AGAINST this pick — confidence reduced',
    });
  }

  // Fatigue risk — use pre-calculated backend field first
  const fatigueRisk = match.fatigue_risk;
  if (fatigueRisk && fatigueRisk !== 'none') {
    const homeRest = match.home_days_rest ?? 7;
    const awayRest = match.away_days_rest ?? 7;
    const rest = Math.min(homeRest, awayRest);
    const tiredTeam = fatigueRisk === 'home'
      ? (match.home_team || match.homeTeam)
      : fatigueRisk === 'away'
        ? (match.away_team || match.awayTeam)
        : 'Both teams';
    badges.push({
      icon: '😴',
      text: `${tiredTeam}: ${rest}d rest`,
      color: 'text-amber-400 bg-amber-500/10',
      reason: 'Team played recently — fatigue may affect performance',
    });
  } else {
    // Fallback: compute from raw rest days
    const homeRest = match.home_days_rest ?? 7;
    const awayRest = match.away_days_rest ?? 7;
    if (homeRest < 4 || awayRest < 4) {
      const tiredTeam = homeRest < awayRest ? (match.home_team || match.homeTeam) : (match.away_team || match.awayTeam);
      const rest = Math.min(homeRest, awayRest);
      badges.push({
        icon: '😴',
        text: `${tiredTeam}: ${rest}d rest`,
        color: 'text-amber-400 bg-amber-500/10',
        reason: 'Team played recently — fatigue may affect performance',
      });
    }
  }

  // Injury risk
  const injuryRisk = match.injury_risk;
  if (injuryRisk && injuryRisk !== 'none') {
    const homeSidelined = match.home_sidelined_count ?? 0;
    const awaySidelined = match.away_sidelined_count ?? 0;
    const count = injuryRisk === 'home' ? homeSidelined : injuryRisk === 'away' ? awaySidelined : Math.max(homeSidelined, awaySidelined);
    const team = injuryRisk === 'home'
      ? (match.home_team || match.homeTeam)
      : injuryRisk === 'away'
        ? (match.away_team || match.awayTeam)
        : 'Both teams';
    badges.push({
      icon: '🚑',
      text: `${count} out (${team === 'Both teams' ? 'Both' : team})`,
      color: 'text-red-400 bg-red-500/10',
      reason: `${count} key players sidelined — squad strength reduced`,
    });
  }

  // BTTS blanking risk
  if (match.btts_blanking_risk) {
    badges.push({
      icon: '🚫',
      text: 'Low scoring',
      color: 'text-rose-400 bg-rose-500/10',
      reason: match.btts_blanking_reason || 'One team averages under 0.8 goals',
    });
  }

  // Weather risk
  if (match.weather === 'windy') {
    badges.push({
      icon: '🌬️',
      text: 'High Wind',
      color: 'text-blue-400 bg-blue-500/10',
      reason: 'High wind speeds may suppress goals — Under 2.5 more likely',
    });
  } else if (match.weather === 'rainy') {
    badges.push({
      icon: '🌧️',
      text: 'Heavy Rain',
      color: 'text-blue-400 bg-blue-500/10',
      reason: 'Rain conditions may slow play and reduce goals',
    });
  }

  // Upset alert
  if (match.upset_alert) {
    badges.push({
      icon: '⚡',
      text: 'Upset Alert',
      color: 'text-purple-400 bg-purple-500/10',
      reason: 'Model identified a high-value away win upset opportunity',
    });
  }

  return badges;
};


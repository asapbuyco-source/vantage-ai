import { Match } from './types';

export interface ProbPick {
  market: string;
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

  // Variety: also show the second-highest probability market as a higher-risk alternative
  if (topPick.name === 'Over 1.5 Goals' || topPick.name === 'Over 0.5 Goals') {
    const nextBest = markets.find(m => m.name !== 'Over 1.5 Goals' && m.name !== 'Over 0.5 Goals');
    if (nextBest && nextBest.prob > 0 && !picks.includes(nextBest)) {
      picks.push(nextBest);
    }
  } else if (markets.length > 1 && markets[1].prob > 0) {
    if (topPick.prob - markets[1].prob <= 0.02) {
      if (!picks.includes(markets[1])) {
        picks.push(markets[1]);
      }
    }
  }

  return picks;
};

export const getPrimaryPredictionText = (match: Match, language: string): string => {
  const topPicks = getTopProbPicks(match);
  if (topPicks.length > 0) {
    return topPicks.map(p => p.name).join(' / ');
  }
  if (language === 'fr') return match.prediction_fr || match.prediction || '';
  return match.prediction_en || match.prediction || '';
};

export const getPrimaryPredictionProb = (match: Match): number => {
  const topPicks = getTopProbPicks(match);
  if (topPicks.length > 0) {
    return Math.round(topPicks[0].prob * 100);
  }
  return match.confidence || 0;
};

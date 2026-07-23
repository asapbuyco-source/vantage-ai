import React from 'react';
import { motion } from 'framer-motion';
import { X, TrendingUp, Wind, Calendar, Users, BrainCircuit, Target, Shield } from 'lucide-react';
import { Match } from '../types';
import { getSmartBadges, SmartBadge } from '../utils';

interface DeepAnalysisModalProps {
  match: Match | null;
  isOpen: boolean;
  onClose: () => void;
  language?: string;
}

export const DeepAnalysisModal: React.FC<DeepAnalysisModalProps> = ({ match, isOpen, onClose, language = 'en' }) => {
  if (!isOpen || !match) return null;

  const badges = getSmartBadges(match);
  const isFr = language === 'fr';

  const sections = [
    {
      icon: <Target size={14} className="text-emerald-400" />,
      title: isFr ? 'Comparaison xG' : 'xG Comparison',
      visible: (match.expected_goals_home ?? 0) > 0 || (match.expected_goals_away ?? 0) > 0,
      content: (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-white">{match.homeTeam}</span>
            <span className="font-mono text-emerald-400 font-bold">{(match.expected_goals_home ?? 0).toFixed(2)} xG</span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden flex">
            <div
              className="h-full bg-emerald-500 rounded-l-full"
              style={{ width: `${Math.min(((match.expected_goals_home ?? 0) / ((match.expected_goals_home ?? 0) + (match.expected_goals_away ?? 1)) * 100), 90)}%` }}
            />
            <div
              className="h-full bg-blue-500 rounded-r-full"
              style={{ width: `${Math.min(((match.expected_goals_away ?? 0) / ((match.expected_goals_home ?? 0) + (match.expected_goals_away ?? 1)) * 100), 90)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-white">{match.awayTeam}</span>
            <span className="font-mono text-blue-400 font-bold">{(match.expected_goals_away ?? 0).toFixed(2)} xG</span>
          </div>
          <p className="text-[10px] text-gray-400 mt-1">
            {(match.expected_goals_home ?? 0) > (match.expected_goals_away ?? 0)
              ? (isFr ? `${match.homeTeam} a l'avantage offensif` : `${match.homeTeam} has the offensive edge`)
              : (isFr ? `${match.awayTeam} a l'avantage offensif` : `${match.awayTeam} has the offensive edge`)}
          </p>
        </div>
      ),
    },
    {
      icon: <Calendar size={14} className="text-amber-400" />,
      title: isFr ? 'Fatigue & Repos' : 'Fatigue & Schedule',
      visible: (match.home_days_rest ?? 7) < 5 || (match.away_days_rest ?? 7) < 5,
      content: (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span>{match.homeTeam}</span>
            <span className={`font-mono font-bold ${(match.home_days_rest ?? 7) < 4 ? 'text-rose-400' : 'text-gray-400'}`}>
              {(match.home_days_rest ?? 7)}d rest
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span>{match.awayTeam}</span>
            <span className={`font-mono font-bold ${(match.away_days_rest ?? 7) < 4 ? 'text-rose-400' : 'text-gray-400'}`}>
              {(match.away_days_rest ?? 7)}d rest
            </span>
          </div>
          {((match.home_days_rest ?? 7) < 4 || (match.away_days_rest ?? 7) < 4) && (
            <p className="text-[10px] text-rose-400/70">
              {isFr ? 'Une équipe a eu moins de 4 jours de repos — la fatigue peut impacter la performance.' : 'A team had less than 4 days rest — fatigue may impact performance.'}
            </p>
          )}
        </div>
      ),
    },
    {
      icon: <TrendingUp size={14} className="text-vantage-cyan" />,
      title: isFr ? 'Mouvement de Ligne' : 'Line Movement',
      visible: !!match.line_signal,
      content: (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              match.line_signal === 'sharp_money_agrees' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
            }`}>
              {match.line_signal === 'sharp_money_agrees'
                ? (isFr ? '💰 Smart Money en Accord' : '💰 Sharp Money Agrees')
                : (isFr ? '⚠️ Ligne Contre Nous' : '⚠️ Line Against Us')}
            </span>
            {match.line_shift != null && (
              <span className="text-[10px] font-mono text-gray-400">
                {(match.line_shift * 100).toFixed(1)}% shift
              </span>
            )}
          </div>
          <p className="text-[10px] text-gray-400">
            {match.line_signal === 'sharp_money_agrees'
              ? (isFr ? 'L\'argent professionnel a déplacé cette ligne dans notre direction — confiance accrue.' : 'Professional money moved this line in our favor — increased confidence.')
              : (isFr ? 'Le marché s\'est déplacé contre nous — prudence recommandée.' : 'The market moved against us — caution advised.')}
          </p>
        </div>
      ),
    },
    {
      icon: <Wind size={14} className="text-blue-400" />,
      title: isFr ? 'Météo' : 'Weather',
      visible: match.weather === 'windy' || match.weather === 'rainy',
      content: (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              match.weather === 'windy' ? 'bg-blue-500/10 text-blue-400' : 'bg-cyan-500/10 text-cyan-400'
            }`}>
              {match.weather === 'windy' ? '🌪️ Windy' : '🌧️ Rainy'}
            </span>
            {match.weather_penalty != null && match.weather_penalty < 1.0 && (
              <span className="text-[10px] font-mono text-gray-400">
                {(match.weather_penalty * 100).toFixed(0)}% over prob
              </span>
            )}
          </div>
          <p className="text-[10px] text-gray-400">
            {isFr ? 'Les conditions météo défavorables réduisent la probabilité de nombreux buts.' : 'Adverse weather conditions reduce the likelihood of high-scoring outcomes.'}
          </p>
        </div>
      ),
    },
    {
      icon: <Users size={14} className="text-purple-400" />,
      title: isFr ? 'Effectif & Blessures' : 'Squad & Injuries',
      visible: (match.home_sidelined_count ?? 0) > 0 || (match.away_sidelined_count ?? 0) > 0,
      content: (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span>{match.homeTeam}</span>
            <span className="font-mono text-gray-400">{(match.home_sidelined_count ?? 0)} out</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span>{match.awayTeam}</span>
            <span className="font-mono text-gray-400">{(match.away_sidelined_count ?? 0)} out</span>
          </div>
          {((match.home_sidelined_count ?? 0) + (match.away_sidelined_count ?? 0)) >= 4 && (
            <p className="text-[10px] text-amber-400/70">
              {isFr ? 'Plusieurs absences — la force de l\'effectif est impactée.' : 'Multiple absences — squad strength is impacted.'}
            </p>
          )}
        </div>
      ),
    },
    {
      icon: <BrainCircuit size={14} className="text-cyan-400" />,
      title: isFr ? 'Verdict IA' : 'AI Verdict',
      visible: !!(match as any).analysis_en,
      content: (
        <div className="space-y-2">
          <p className="text-xs text-gray-300 leading-relaxed">
            {isFr ? ((match as any).analysis_fr || (match as any).analysis_en) : (match as any).analysis_en}
          </p>
          {badges.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-2 border-t border-white/5">
              {badges.map((b, i) => (
                <span key={i} className={`text-[9px] font-bold ${b.color} px-1.5 py-0.5 rounded flex items-center gap-0.5 bg-white/5`}>
                  {b.icon} {b.text}
                </span>
              ))}
            </div>
          )}
        </div>
      ),
    },
  ];

  const visibleSections = sections.filter(s => s.visible);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative w-full max-w-md max-h-[80vh] overflow-y-auto rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-white/10 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between p-4 bg-slate-950/90 backdrop-blur-md border-b border-white/10 rounded-t-2xl">
          <div>
            <h2 className="text-sm font-bold text-white">
              {isFr ? 'Analyse Approfondie' : 'Deep Analysis'}
            </h2>
            <p className="text-[10px] text-gray-400">
              {match.homeTeam} vs {match.awayTeam}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {visibleSections.length === 0 ? (
            <div className="text-center py-8">
              <Shield size={32} className="text-gray-500 mx-auto mb-3" />
              <p className="text-sm text-gray-400">
                {isFr ? 'Aucun signal contextuel détecté pour ce match.' : 'No contextual signals detected for this match.'}
              </p>
              <p className="text-[10px] text-gray-500 mt-1">
                {isFr ? 'Le modèle est confiant dans des conditions standard.' : 'The model is confident under standard conditions.'}
              </p>
            </div>
          ) : (
            visibleSections.map((section, i) => (
              <div key={i} className="p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center gap-2 mb-3">
                  {section.icon}
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{section.title}</span>
                </div>
                {section.content}
              </div>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

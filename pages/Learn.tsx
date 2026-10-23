import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Lightbulb, GraduationCap, ChevronDown, ChevronRight, ExternalLink, TrendingUp, Target, BarChart3, Activity, PlayCircle } from 'lucide-react';
import { BettingGuide } from './BettingGuide';
import { PlayStoreCTA } from '../components/PlayStoreCTA';
import { useAppContext } from '../context/AppContext';

const trainingModules = [
  {
    id: 'ev',
    icon: <TrendingUp size={16} className="text-emerald-400" />,
    title_en: 'What is +EV Betting?',
    title_fr: "Qu'est-ce que le pari +VE ?",
    content_en: 'A bet is +EV when the odds offered are better than the true probability. Example: A coin flip is 50% — fair odds are 2.00. If a bookie offers 2.10, you have +EV. Over thousands of bets, +EV compounds your edge. Vantage AI finds these gaps automatically.',
    content_fr: "Un pari est +VE quand les cotes offertes sont meilleures que la vraie probabilité. Exemple : Un pile ou face est à 50% — les cotes équitables sont 2.00. Si un bookmaker offre 2.10, vous avez +VE. Sur des milliers de paris, +VE s'accumule.",
  },
  {
    id: 'kelly',
    icon: <Target size={16} className="text-vantage-cyan" />,
    title_en: 'Kelly Criterion — Stake Sizing',
    title_fr: 'Kelly Criterion — Taille des enjeux',
    content_en: 'Kelly determines how much of your bankroll to risk based on your edge and the odds. The formula: Edge ÷ (Odds - 1). We multiply by your risk profile (0.25x, 0.5x, or 1.0x) to keep bets sustainable. Never bet more than Kelly suggests.',
    content_fr: 'Kelly détermine combien de votre bankroll risquer selon votre avantage et les cotes. La formule : Avantage ÷ (Cotes - 1). Nous multiplions par votre profil de risque (0.25x, 0.5x, ou 1.0x) pour garder les paris durables.',
  },
  {
    id: 'model',
    icon: <BarChart3 size={16} className="text-vantage-purple" />,
    title_en: 'How Vantage AI Works',
    title_fr: 'Comment fonctionne Vantage AI',
    content_en: 'Step 1: We pull live data from football & basketball leagues. Step 2: Our statistical models calculate expected goals (xG) and win probabilities. Step 3: We compare those probabilities against bookie odds — wherever there is a gap, we flag it as +EV. Step 4: Signals are ranked by confidence and shown to you. No guesswork.',
    content_fr: "Étape 1 : Nous collectons les données en direct. Étape 2 : Nos modèles statistiques calculent les buts attendus (xG) et les probabilités de victoire. Étape 3 : Nous comparons ces probabilités aux cotes des bookmakers — là où il y a un écart, nous le signalons comme +VE. Étape 4 : Les signaux sont classés par confiance.",
  },
  {
    id: 'variance',
    icon: <Activity size={16} className="text-amber-400" />,
    title_en: 'Long-Term Variance',
    title_fr: 'La Variance à Long Terme',
    content_en: 'A 60% win-rate model will lose 8-10 bets in a row — regularly. That is not bad luck, that is math. Short term looks random; long term looks like the model. The key: bet consistently, never chase losses, trust the process.',
    content_fr: "Un modèle à 60% de victoires perdra 8-10 paris de suite — régulièrement. Ce n'est pas la malchance, c'est les maths. La clé : pariez régulièrement, ne courez jamais après les pertes.",
  },
];

export const Learn: React.FC = () => {
  const { t, language } = useAppContext();
  const [activeSection, setActiveSection] = useState<'guide' | 'concepts' | 'faq'>('guide');
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [openConcept, setOpenConcept] = useState<string | null>(null);

  const faqItems = [
    {
      q: language === 'fr' ? "Qu'est-ce que l'EV (Expected Value) ?" : 'What is EV (Expected Value)?',
      a: language === 'fr'
        ? "L'EV mesure votre avantage mathématique. Un EV de +10% signifie que pour chaque 100 FCFA misés, vous gagnez en moyenne 10 FCFA de profit sur le long terme."
        : 'EV measures your mathematical edge. An EV of +10% means for every 100 units staked, you expect 10 units profit long-term.',
    },
    {
      q: language === 'fr' ? "Comment fonctionne le Kelly Criterion ?" : 'How does Kelly Criterion work?',
      a: language === 'fr'
        ? "Le Kelly Criterion calcule la taille optimale de mise en fonction de votre avantage. Nous utilisons un Kelly fractionnaire (12.5%) pour réduire la volatilité."
        : 'The Kelly Criterion calculates optimal bet size from your edge. We use fractional Kelly (12.5%) to reduce volatility.',
    },
    {
      q: language === 'fr' ? "Qu'est-ce que le CLV (Closing Line Value) ?" : 'What is CLV (Closing Line Value)?',
      a: language === 'fr'
        ? "Le CLV mesure si nos cotes étaient meilleures que la ligne de clôture. Un CLV positif signifie que le marché a évolué dans notre direction, confirmant notre avantage."
        : 'CLV measures if our odds beat the closing line. Positive CLV means the market moved our way — confirming our edge.',
    },
    {
      q: language === 'fr' ? 'Quels marchés sont les plus fiables ?' : 'Which markets are most reliable?',
      a: language === 'fr'
        ? "Les marchés de buts (Over 1.5, Over 2.5) ont le meilleur taux de réussite à 72%. Les marchés de résultat (Home/Away Win) sont supprimés du pool de paris en raison de performances insuffisantes."
        : 'Goals markets (Over 1.5, Over 2.5) have the best hit rate at 72%. Match winner markets are suppressed from our bet pool due to poor performance.',
    },
  ];

  return (
    <div className="space-y-4 pb-24">
      <motion.div className="flex flex-col space-y-1 mb-4" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-black font-orbitron text-slate-900 dark:text-white uppercase tracking-tight">
          {language === 'fr' ? 'Centre' : 'Learning'} <span className="text-vantage-cyan">{language === 'fr' ? "d'Apprentissage" : 'Center'}</span>
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">
          {language === 'fr' ? 'Maîtrisez les paris sportifs quantitatifs' : 'Master quantitative sports betting'}
        </p>
      </motion.div>

      <div className="flex bg-slate-100 dark:bg-white/5 rounded-xl p-1 overflow-x-auto">
        {[
          { id: 'guide' as const, icon: BookOpen, label: language === 'fr' ? 'Guide' : 'Guide' },
          { id: 'concepts' as const, icon: GraduationCap, label: language === 'fr' ? 'Concepts' : 'Concepts' },
          { id: 'faq' as const, icon: Lightbulb, label: 'FAQ' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveSection(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-[10px] sm:text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
              activeSection === tab.id ? 'bg-white dark:bg-slate-800 shadow text-vantage-cyan' : 'text-gray-500 hover:text-gray-300'
            }`}>
            <tab.icon size={13} /> {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeSection === 'guide' && (
          <motion.div key="guide" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
            <BettingGuide />
          </motion.div>
        )}
        {activeSection === 'concepts' && (
          <motion.div key="concepts" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
            <div className="space-y-2">
              {trainingModules.map(m => (
                <div key={m.id}>
                  <button onClick={() => setOpenConcept(openConcept === m.id ? null : m.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-slate-100 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">
                    {m.icon}
                    <span className="text-xs font-bold text-slate-700 dark:text-gray-200 flex-1 text-left">
                      {language === 'fr' ? m.title_fr : m.title_en}
                    </span>
                    <ChevronRight size={14} className={`text-gray-400 transition-transform ${openConcept === m.id ? 'rotate-90' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {openConcept === m.id && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
                        <div className="mt-1 p-3 bg-white/40 dark:bg-white/3 rounded-xl border border-slate-200 dark:border-white/5">
                          <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
                            {language === 'fr' ? m.content_fr : m.content_en}
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
              <a href="https://www.youtube.com/results?search_query=sports+betting+expected+value" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-3 bg-blue-500/5 rounded-xl border border-blue-500/15 hover:bg-blue-500/10 transition-colors">
                <PlayCircle size={16} className="text-blue-400" />
                <span className="text-xs font-bold text-slate-700 dark:text-gray-200 flex-1 text-left">
                  {language === 'fr' ? 'Vidéos Éducatives' : 'Educational Videos'}
                </span>
                <ExternalLink size={14} className="text-blue-400" />
              </a>
            </div>
          </motion.div>
        )}
        {activeSection === 'faq' && (
          <motion.div key="faq" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
            <div className="space-y-2">
              {faqItems.map((item, i) => (
                <div key={i} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-md overflow-hidden">
                  <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full px-4 py-3 flex items-center justify-between text-left">
                    <span className="text-sm font-bold text-slate-900 dark:text-white pr-4">{item.q}</span>
                    <ChevronDown size={16} className={`text-gray-400 shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {openFaq === i && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <p className="px-4 pb-3 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{item.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <PlayStoreCTA variant="card" className="mt-4" />
    </div>
  );
};

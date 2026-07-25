import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Zap, BookOpen, User } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

export const BottomNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useAppContext();

  const getActiveTab = () => {
    const path = location.pathname;
    if (path === '/' || path === '/free') return 'home';
    if (path.startsWith('/vip') || path.startsWith('/arb')) return 'alpha';
    if (path.startsWith('/learn') || path.startsWith('/guide') || path.startsWith('/concierge')) return 'learn';
    if (path.startsWith('/profile') || path.startsWith('/admin') || path.startsWith('/stats') || path.startsWith('/results')) return 'profile';
    return 'home';
  };

  const activeTab = getActiveTab();

  const navItems = [
    { id: 'home', path: '/', icon: Home, label: t('nav.home') || 'Home' },
    { id: 'alpha', path: '/vip', icon: Zap, label: 'Alpha' },
    { id: 'learn', path: '/learn', icon: BookOpen, label: language === 'fr' ? 'Apprendre' : 'Learn' },
    { id: 'profile', path: '/profile', icon: User, label: t('nav.profile') || 'Profile' },
  ] as const;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:top-0 md:right-auto md:w-64 md:flex md:flex-col md:border-r border-gray-200 dark:border-white/10 md:bg-white/95 md:dark:bg-vantage-bg/95">
      <div className="absolute inset-0 bg-white/90 dark:bg-black/80 backdrop-blur-xl border-t border-gray-200 dark:border-white/10 transition-colors duration-300 md:hidden" />

      <div className="hidden md:flex items-center px-6 py-8">
        <h1 className="text-2xl font-black font-orbitron tracking-tight text-slate-900 dark:text-white">
          VANTAGE<span className="text-vantage-cyan">AI</span>
        </h1>
      </div>

      <div className="relative flex justify-around items-center h-[72px] px-2 md:flex-col md:h-auto md:justify-start md:items-stretch md:space-y-2 md:px-4 md:pt-4 md:flex-1" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}>
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              onClick={() => navigate(item.path)}
              className={`relative flex flex-col md:flex-row items-center justify-center md:justify-start w-full h-full md:h-14 space-y-0.5 md:space-y-0 md:space-x-4 transition-all duration-200 md:rounded-xl md:px-4 ${isActive && 'md:bg-vantage-cyan/10'
                }`}
            >
              {isActive && (
                <motion.div
                  className="absolute bottom-0 left-2 right-2 h-0.5 bg-vantage-cyan rounded-full md:block will-change-transform"
                  layoutId="activeTab"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              {isActive && (
                <motion.div
                  layoutId="nav-pill"
                  className="absolute inset-x-1 top-1.5 bottom-1.5 bg-vantage-cyan/12 rounded-2xl md:hidden will-change-transform"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <div className={`relative z-10 flex items-center justify-center transition-all duration-200 ${isActive ? 'text-vantage-cyan -translate-y-0.5 md:translate-y-0 md:scale-110' : 'text-gray-400 dark:text-gray-500 md:hover:text-vantage-cyan/70'}`}>
                <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} className="md:w-5 md:h-5" />
              </div>
              <span className={`relative z-10 text-[9px] md:text-sm font-semibold tracking-wide transition-colors ${isActive ? 'text-vantage-cyan md:font-bold' : 'text-gray-400 dark:text-gray-500 md:font-medium'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="hidden md:block p-6 mt-auto">
        <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest text-center">
          Vantage AI Web
        </div>
      </div>
    </nav>
  );
};

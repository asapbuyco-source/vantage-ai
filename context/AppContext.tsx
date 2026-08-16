
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { translations, Language } from '../i18n';
import { Toast, ToastType, SavedPick } from '../types';

type Theme = 'light' | 'dark';

interface AppContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  theme: Theme;
  toggleTheme: () => void;
  t: (path: string) => string;
  // Toast System
  toasts: Toast[];
  showToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
  // Bet Slip
  savedPicks: SavedPick[];
  toggleSavedPick: (pick: SavedPick) => void;
  clearSavedPicks: () => void;
  isPickSaved: (id: string) => boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // ─── Language ─────────────────────────────────────────────────────────────
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('vantage_language');
    if (saved === 'en' || saved === 'fr') return saved as Language;
    const browserLang = (navigator.language || navigator.languages?.[0] || '').toLowerCase();
    if (browserLang.startsWith('fr')) return 'fr';
    if (browserLang.startsWith('en')) return 'en';
    return 'fr';  // Default to French (primary market: Cameroon/Francophone Africa)
  });

  // ─── Theme (persisted) ────────────────────────────────────────────────────
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('vantage_theme');
    if (saved === 'light' || saved === 'dark') return saved as Theme;
    return 'dark'; // Default
  });

  // ─── Toasts ───────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ─── Bet Slip (persisted) ─────────────────────────────────────────────────
  const [savedPicks, setSavedPicks] = useState<SavedPick[]>(() => {
    try {
      const stored = localStorage.getItem('vantage_saved_picks');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const toggleSavedPick = useCallback((pick: SavedPick) => {
    setSavedPicks(prev => {
      const exists = prev.some(p => p.id === pick.id);
      const next = exists ? prev.filter(p => p.id !== pick.id) : [...prev, pick];
      localStorage.setItem('vantage_saved_picks', JSON.stringify(next));
      if (!exists) {
        import('../services/analytics').then(({ trackEvent }) => {
          trackEvent('pick_saved', { match: `${pick.homeTeam} v ${pick.awayTeam}`, league: pick.league || '' });
        }).catch(() => {});
      }
      return next;
    });
  }, []);

  const clearSavedPicks = useCallback(() => {
    setSavedPicks([]);
    localStorage.removeItem('vantage_saved_picks');
  }, []);

  const isPickSaved = useCallback((id: string) => savedPicks.some(p => p.id === id), [savedPicks]);

  // ─── Setters ──────────────────────────────────────────────────────────────
  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('vantage_language', lang);
  };

  const toggleTheme = () => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('vantage_theme', next);
      return next;
    });
  };

  // ─── Side Effects ─────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // Browser language change listener
  useEffect(() => {
    const handleLanguageChange = () => {
      const saved = localStorage.getItem('vantage_language');
      if (!saved) {
        const browserLang = navigator.language || navigator.languages?.[0];
        setLanguageState(browserLang?.toLowerCase().startsWith('en') ? 'en' : 'fr');
      }
    };
    window.addEventListener('languagechange', handleLanguageChange);
    return () => window.removeEventListener('languagechange', handleLanguageChange);
  }, []);

  // ─── Translation Helper ───────────────────────────────────────────────────
  const t = (path: string): string => {
    const keys = path.split('.');
    let current: any = translations[language];
    for (const key of keys) {
      if (current?.[key] === undefined) return path;
      current = current[key];
    }
    return typeof current === 'string' ? current : path;
  };

  return (
    <AppContext.Provider value={{
      language, setLanguage,
      theme, toggleTheme,
      t,
      toasts, showToast, removeToast,
      savedPicks, toggleSavedPick, clearSavedPicks, isPickSaved
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};

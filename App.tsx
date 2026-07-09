import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation, Link } from 'react-router-dom';
import { verifySelarOrder } from './services/selar';
import { AnimatePresence } from 'framer-motion';
import { Loader2, X, Crown, RefreshCw } from 'lucide-react';
import { NavigationTab } from './types';
import { BottomNav } from './components/BottomNav';
import { ToastContainer } from './components/Toast';
import { BetSlip } from './components/BetSlip';
import { Onboarding } from './components/Onboarding';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Home } from './pages/Home';
import { TicketWizard } from './components/TicketWizard';
import { Profile } from './pages/Profile';
import { LandingPage } from './pages/LandingPage';
import { PublicStats } from './pages/PublicStats';
import { Results } from './pages/Results';
import { LiveScores } from './pages/LiveScores';
import { BlogIndex } from './pages/BlogIndex';
import { BlogPost } from './pages/BlogPost';
import { MatchDetails } from './pages/MatchDetails';
import { Privacy } from './pages/Privacy';
import { AppProvider, useAppContext } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { enableFirestorePersistence } from './firebaseConfig';
import { TrialOfferPopup } from './components/TrialOfferPopup';
import { WEEKLY_REGULAR_PRICE, WEEKLY_TRIAL_PRICE } from './src/constants/pricing';
import { PaymentModal } from './components/PaymentModal';
import { MotionDiv } from './components/MotionDiv';

const VIP = lazy(() => import('./pages/VIP').then(m => ({ default: m.VIP })));
const Admin = lazy(() => import('./pages/Admin').then(m => ({ default: m.Admin })));
const Learn = lazy(() => import('./pages/Learn').then(m => ({ default: m.Learn })));


function AppContent() {
  const location = useLocation();
  const navigate = useNavigate();

  const [authView, setAuthView] = useState<'landing' | 'login' | 'signup' | 'stats'>(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    if (mode === 'signup') return 'signup';
    if (mode === 'login') return 'login';
    if (mode === 'stats') return 'stats';
    return 'landing';
  });

  // Onboarding: show once, only after login
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Enable Firestore offline persistence on mount
  useEffect(() => { enableFirestorePersistence(); }, []);

  // Listen for SW_UPDATED message from the new service worker
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SW_UPDATED') {
        setShowUpdateBanner(true);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);
  // VIP renewal reminder
  const [showRenewalBanner, setShowRenewalBanner] = useState(false);
  const [showTrialUpsell, setShowTrialUpsell] = useState(false);
  const [renewalDaysLeft, setRenewalDaysLeft] = useState(0);
  // Trial offer payment modal
  const [showTrialPayment, setShowTrialPayment] = useState(false);
  // New version available banner
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);

  const { theme, language, showToast } = useAppContext();
  const { user, userProfile, verifyTransaction, loading: authLoading, isAdmin } = useAuth();

  // Show onboarding for first-time users
  useEffect(() => {
    if (user && !localStorage.getItem('vantage_onboarded')) {
      setShowOnboarding(true);
    }
  }, [user]);

  // VIP Renewal Reminder — fires when VIP expires within 3 days
  useEffect(() => {
    if (!userProfile?.isVip || !userProfile.vipExpiry) {
      setShowRenewalBanner(false);
      return;
    }
    const expiry = new Date(userProfile.vipExpiry);
    const now = new Date();
    const msLeft = expiry.getTime() - now.getTime();
    const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
    const dismissed = localStorage.getItem('vantage_renewal_dismissed');
    if (daysLeft <= 3 && daysLeft >= 0 && dismissed !== userProfile.vipExpiry) {
      setRenewalDaysLeft(daysLeft);
      setShowRenewalBanner(true);
    } else {
      setShowRenewalBanner(false);
    }

    const trialDismissed = localStorage.getItem('vantage_trial_upsell_dismissed');
    if (userProfile?.vipPlan === 'weekly' && daysLeft <= 2 && daysLeft >= 0 && trialDismissed !== userProfile.vipExpiry) {
      setShowTrialUpsell(true);
    } else {
      setShowTrialUpsell(false);
    }
  }, [userProfile]);

  const handleOnboardingComplete = () => {
    localStorage.setItem('vantage_onboarded', 'true');
    setShowOnboarding(false);
  };

  // Capture Referral Code from URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const ref = urlParams.get('ref') || urlParams.get('referrer');
    if (ref) {
      localStorage.setItem('vantage_referral_code', ref.toUpperCase());
      if (!urlParams.get('transId') && !urlParams.get('mode')) {
        const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.history.replaceState({ path: newUrl }, '', newUrl);
      }
    }
  }, []);

  // ── Unified Payment Verification (Selar first, then Fapshi) ──────────────────
  // Runs ONCE per page load, only after auth is ready. Using a ref guard to
  // prevent re-execution when verifyTransaction function reference changes on renders.
  const paymentChecked = React.useRef(false);

  useEffect(() => {
    // Guard: only run once per page load, and only when auth is fully resolved
    if (authLoading || !user || paymentChecked.current) return;
    // Don't set the flag yet — wait until we actually find something to verify
    // (so a page load with no pending payment doesn't block future checks)

    const checkPayments = async () => {
      const urlParams = new URLSearchParams(window.location.search);

      // 1️⃣  Selar (card / global payment) — check first
      let selarRef = urlParams.get('selar_ref');
      if (!selarRef) {
        const pending = localStorage.getItem('pendingSelarRef');
        if (pending) selarRef = pending;
      }

      if (selarRef) {
        paymentChecked.current = true;
        window.history.replaceState({}, document.title, window.location.pathname);
        localStorage.removeItem('pendingSelarRef');

        const result = await verifySelarOrder(selarRef);
        if (result.success) {
          await verifyTransaction(`SELAR_${selarRef}`);
          showToast(
            language === 'fr' ? '✅ Paiement Selar confirmé ! Bienvenue VIP 🎉' : '✅ Selar payment confirmed! Welcome VIP 🎉',
            'success'
          );
          navigate('/vip');
        } else if (urlParams.get('selar_ref')) {
          localStorage.removeItem('pendingSelarRef');
          localStorage.removeItem('pendingVipPlan');
          showToast(
            language === 'fr' ? 'Vérification Selar échouée. Contactez le support.' : 'Selar verification failed. Please contact support.',
            'error'
          );
        }
        return;
      }

      // 2️⃣  Fapshi (Cameroon MoMo) — only if Selar was not triggered
      let transId = urlParams.get('transId');
      if (!transId) {
        // Fallback: Check localStorage because Fapshi doesn't append transId to the redirect URL natively
        const pendingFapshi = localStorage.getItem('pendingFapshiTransId');
        if (pendingFapshi) transId = pendingFapshi;
      }

      if (transId) {
        paymentChecked.current = true;
        // Consume transId AFTER we confirmed user is ready, to prevent premature deletion
        localStorage.removeItem('pendingFapshiTransId');
        window.history.replaceState({}, document.title, window.location.pathname);
        const success = await verifyTransaction(transId);
        if (success) {
          showToast(
            language === 'fr' ? 'Paiement réussi ! Bienvenue VIP. 🎉' : 'Payment successful! Welcome VIP. 🎉',
            'success'
          );
          navigate('/vip');
        } else {
          showToast(
            language === 'fr' ? 'Paiement en attente ou échoué.' : 'Payment pending or failed.',
            'warning'
          );
        }
      }
    };
    checkPayments();
  }, [authLoading, user, verifyTransaction, showToast, language, navigate]);

  // Auth loading spinner
  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-vantage-bg">
        <Loader2 className="animate-spin text-vantage-cyan mb-4" size={40} />
        <p className="text-gray-500 text-sm font-medium animate-pulse">Establishing Secure Connection...</p>
      </div>
    );
  }

  // Unauthenticated flow — but /blog routes are always publicly accessible
  if (!user) {
    return (
      <Routes>
        <Route path="/blog" element={<BlogIndex />} />
        <Route path="/blog/:date" element={<BlogPost />} />
        <Route path="/privacy-policy" element={<Privacy />} />
        <Route path="*" element={
          <div className="min-h-screen overflow-x-hidden selection:bg-vantage-cyan/30 font-sans">
            <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
              <div className={`
                absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-64 
                blur-[100px] rounded-full mix-blend-screen transition-colors duration-500
                ${theme === 'dark' ? 'bg-vantage-cyan/5' : 'bg-blue-200/40'}
                `} />
            </div>
            <main className="relative z-10 container mx-auto max-w-md md:max-w-6xl px-4 pt-6 min-h-screen">
              <AnimatePresence mode="wait">
                {authView === 'landing' ? (
                  <MotionDiv key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                    <LandingPage
                      onGetStarted={() => setAuthView('signup')}
                      onLogin={() => setAuthView('login')}
                      onShowStats={() => setAuthView('stats')}
                    />
                  </MotionDiv>
                ) : authView === 'stats' ? (
                  <MotionDiv key="stats" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.3 }}>
                    <div className="flex flex-col min-h-screen">
                      <div className="flex items-center gap-2 py-4 mb-2">
                        <button onClick={() => setAuthView('landing')} className="p-2 bg-white/5 rounded-lg text-gray-500 hover:text-vantage-cyan transition-colors">
                          <X size={20} />
                        </button>
                        <span className="text-sm font-bold uppercase tracking-widest text-gray-400">Back</span>
                      </div>
                      <PublicStats />
                      <div className="mt-auto py-8">
                        <button
                          onClick={() => setAuthView('signup')}
                          className="w-full py-4 bg-white text-slate-900 font-bold rounded-xl shadow-lg"
                        >
                          Get Started Free
                        </button>
                      </div>
                    </div>
                  </MotionDiv>
                ) : (
                  <MotionDiv key="auth" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.3 }}>
                    <div className="max-w-md mx-auto">
                      <Profile initialMode={authView === 'login' ? 'login' : 'signup'} onBack={() => setAuthView('landing')} />
                    </div>
                  </MotionDiv>
                )}
              </AnimatePresence>
            </main>
          </div>
        } />
      </Routes>
    );
  }

  // Authenticated app
  return (
    <Routes>
      {/* ───── Public Blog Routes (NO auth required — for SEO/Google) ───── */}
      <Route path="/blog" element={<BlogIndex />} />
      <Route path="/blog/:date" element={<BlogPost />} />

      {/* ───── Match Details Page (full-screen, no bottom nav) ───── */}
      <Route path="/match/:id" element={<MatchDetails />} />
      <Route path="/privacy-policy" element={<Privacy />} />

      {/* ───── All other routes = main authenticated app ───── */}
      <Route path="*" element={
        <div className="min-h-screen overflow-x-hidden selection:bg-vantage-cyan/30 font-sans transition-colors duration-300 md:flex">

          {/* Ambient Background */}
          <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
            <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-64 blur-[120px] rounded-full mix-blend-screen transition-colors duration-500 ${theme === 'dark' ? 'bg-vantage-cyan/5' : 'bg-blue-200/40'}`} />
            <div className={`absolute bottom-0 right-0 w-96 h-96 blur-[120px] rounded-full mix-blend-screen transition-colors duration-500 ${theme === 'dark' ? 'bg-vantage-purple/5' : 'bg-purple-200/40'}`} />
          </div>

          {/* ── New Version Update Banner ───────────────────────────── */}
          <AnimatePresence>
            {showUpdateBanner && (
              <MotionDiv
                initial={{ y: -60, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -60, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-between px-4 py-3 bg-gradient-to-r from-emerald-600 to-teal-500 text-white text-sm font-bold shadow-lg"
              >
                <div className="flex items-center gap-2">
                  <RefreshCw size={15} className="shrink-0 animate-spin" />
                  <span>New version available — tap to update</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => window.location.reload()}
                    className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full transition-colors font-black"
                  >
                    Refresh Now
                  </button>
                  <button
                    onClick={() => setShowUpdateBanner(false)}
                    className="text-white/70 hover:text-white"
                  >
                    <X size={16} />
                  </button>
                </div>
              </MotionDiv>
            )}
          </AnimatePresence>

          {/* VIP Renewal Reminder Banner */}
          <AnimatePresence>
            {showRenewalBanner && (
              <MotionDiv
                initial={{ y: -60, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -60, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 bg-gradient-to-r from-vantage-purple to-vantage-cyan text-white text-sm font-bold shadow-lg"
              >
                <div className="flex items-center gap-2">
                  <Crown size={16} className="shrink-0" />
                  <span>
                    {renewalDaysLeft === 0
                      ? (language === 'fr' ? 'Votre VIP expire aujourd\'hui !' : 'Your VIP expires today!')
                      : (language === 'fr' ? `VIP expire dans ${renewalDaysLeft}j — Renouveler` : `VIP expires in ${renewalDaysLeft}d — Renew now`)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate('/vip')}
                    className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full transition-colors"
                  >
                    {language === 'fr' ? 'Renouveler' : 'Renew'}
                  </button>
                  <button
                    onClick={() => {
                      localStorage.setItem('vantage_renewal_dismissed', userProfile?.vipExpiry || '');
                      setShowRenewalBanner(false);
                    }}
                    className="text-white/70 hover:text-white"
                  >
                    <X size={16} />
                  </button>
                </div>
              </MotionDiv>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showTrialUpsell && !showRenewalBanner && (
              <MotionDiv
                initial={{ opacity: 0, y: -40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -40 }}
                className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-vantage-purple via-indigo-600 to-vantage-cyan text-white shadow-xl"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Crown size={14} className="text-yellow-300 fill-yellow-300 shrink-0" />
                  <span className="text-[11px] font-bold truncate">
                    {language === 'fr'
                      ? `Essai se termine dans ${renewalDaysLeft}j — Passer à l'annuel, économisez 60%`
                      : `Trial ends in ${renewalDaysLeft}d — Switch to Annual, save 60%`}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => { setShowTrialUpsell(false); navigate('/vip'); }}
                    className="text-[10px] font-black bg-white text-vantage-purple px-2.5 py-1 rounded-lg whitespace-nowrap"
                  >
                    {language === 'fr' ? 'Voir →' : 'Upgrade →'}
                  </button>
                  <button
                    onClick={() => {
                      localStorage.setItem('vantage_trial_upsell_dismissed', userProfile?.vipExpiry || '');
                      setShowTrialUpsell(false);
                    }}
                    className="p-1 hover:bg-white/20 rounded transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              </MotionDiv>
            )}
          </AnimatePresence>

          <main className="relative z-10 w-full mx-auto max-w-md md:max-w-7xl md:ml-64 px-4 pt-6 min-h-screen pb-24 md:pb-6" style={{ paddingTop: (showRenewalBanner || showTrialUpsell) ? '4rem' : undefined }}>
            <AnimatePresence mode="wait">
              <Suspense fallback={<div className="min-h-screen flex flex-col items-center justify-center"><Loader2 className="animate-spin text-vantage-cyan mb-4" size={40} /><p className="text-gray-500 text-sm font-medium animate-pulse">Loading...</p></div>}>
                <ErrorBoundary>
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/free" element={<Home />} />
                    <Route path="/vip" element={<VIP />} />
                    <Route path="/arb" element={<VIP />} />
                    <Route path="/learn" element={<Learn />} />
                    <Route path="/guide" element={<Learn />} />
                    <Route path="/concierge" element={<TicketWizard />} />
                    <Route path="/profile" element={<Profile />} />
                    <Route path="/admin" element={<Admin />} />
                    <Route path="/stats" element={<PublicStats />} />
                    <Route path="/results" element={<Results />} />
                    <Route path="/live" element={<LiveScores />} />
                  </Routes>
                </ErrorBoundary>
              </Suspense>
            </AnimatePresence>
          </main>

          <BottomNav />

          {/* Popup priority system: only one at a time */}
          <AnimatePresence>
          {showOnboarding ? (
            <Onboarding onComplete={handleOnboardingComplete} />
          ) : null}
          </AnimatePresence>
          <BetSlip />
          {/* Trial Offer Popup — only on home/free tabs, only for non-VIP */}
          {!showOnboarding && (location.pathname === '/' || location.pathname === '/free') && (
            <TrialOfferPopup
              isVip={!!(userProfile?.isVip || isAdmin)}
              onClaim={() => setShowTrialPayment(true)}
            />
          )}
          {showTrialPayment && (
            <PaymentModal
              isOpen={showTrialPayment}
              onClose={() => setShowTrialPayment(false)}
              plan={{
                id: 'weekly',
                label: language === 'fr' ? 'Pass Alpha 7 Jours' : '7-Day Alpha Pass',
                price: String(WEEKLY_TRIAL_PRICE),
                features: [
                  language === 'fr' ? 'Signaux +EV Premium' : 'Premium +EV Signals',
                  language === 'fr' ? 'Gestion Kelly' : 'Kelly Staking',
                  language === 'fr' ? 'Suivi de la Valeur de Clôture (CLV)' : 'Closing Line Value (CLV) Tracker',
                  language === 'fr' ? 'Filtres Advanced Screener' : 'Advanced Screener Filters',
                ],
              }}
              onSuccess={() => { setShowTrialPayment(false); navigate('/vip'); }}
            />
          )}
          <ToastContainer />
        </div>
      } />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <AuthProvider>
          <DataProvider>
            <AppContent />
          </DataProvider>
        </AuthProvider>
      </AppProvider>
    </BrowserRouter>
  );
}

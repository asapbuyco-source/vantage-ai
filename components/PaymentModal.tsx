import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CreditCard, Smartphone, CheckCircle2, ShieldCheck, ArrowRight, Loader2, Globe, AlertTriangle, Mail, MessageCircle } from 'lucide-react';
import { GlassCard } from './GlassCard';
import { initiateFapshiPayment } from '../services/fapshi';
import { initiateSelarPayment } from '../services/selar';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { getPricingForCountry } from '../services/pricing';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: {
    id: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
    label: string;
    price: string;
    features: string[];
  };
  onSuccess?: () => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({ isOpen, onClose, plan, onSuccess }) => {
  const { t, language, showToast } = useAppContext();
  const { user, userProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [gateway, setGateway] = useState<'fapshi' | 'selar'>('fapshi');
  const [paymentFailed, setPaymentFailed] = useState(false);

  const userEmail = user?.email || '';

  React.useEffect(() => {
    if (isOpen && userProfile) {
      if (userProfile.country && !['cm', 'ci', 'sn', 'other'].includes(userProfile.country)) {
        setGateway('selar');
      } else {
        setGateway('fapshi');
      }
    }
  }, [isOpen, userProfile]);

  useEffect(() => {
    if (!isOpen) {
      setPaymentFailed(false);
      return;
    }
    setPaymentFailed(false);
  }, [isOpen, plan]);

  const pricing = getPricingForCountry(Number(plan.price), userProfile?.country || 'cm', plan.id);

  const handlePayment = async () => {
    if (!user) {
      showToast(language === 'fr' ? "Veuillez vous connecter d'abord" : "Please login first", "info");
      return;
    }

    setLoading(true);
    setPaymentFailed(false);
    localStorage.setItem('pendingVipPlan', plan.id);

    try {
        if (typeof window !== 'undefined' && (window as any).fbq) {
            (window as any).fbq('track', 'InitiateCheckout', { currency: 'XAF', value: parseInt(plan.price) });
        }
    } catch(err) { console.error('Pixel error', err); }

    try {
      if (gateway === 'fapshi') {
        const { link, transId } = await initiateFapshiPayment(plan.id, user.email || undefined);
        // CRITICAL: Fapshi does NOT append transId to the redirectUrl automatically.
        // We must store it in localStorage so App.tsx can retrieve it on return.
        if (transId) {
          localStorage.setItem('pendingFapshiTransId', transId);
        }
        window.location.href = link;
      } else {
        // For Selar, verify the user has an email before proceeding
        if (!user.email) {
          showToast(
            language === 'fr'
              ? "Votre compte n'a pas d'email associé. Contactez le support."
              : "Your account has no email address. Please contact support.",
            "error"
          );
          setLoading(false);
          return;
        }
        const { checkout_url } = await initiateSelarPayment(
          plan.id,
          user.email,
          user.uid
        );
        window.location.href = checkout_url;
      }
    } catch (e: any) {
      showToast(e.message || "Payment initiation failed", "error");
      setPaymentFailed(true);
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-md"
          >
            <GlassCard className="border-vantage-purple/20 overflow-hidden">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold font-orbitron text-slate-900 dark:text-white">
                  {language === 'fr' ? 'Paiement Sécurisé' : 'Secure Payment'}
                </h2>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-full transition-colors"
                >
                  <X size={20} className="text-gray-500" />
                </button>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 mb-6">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-gray-500">{plan.label}</span>
                  <span className="text-lg font-bold text-vantage-purple">{pricing.symbol}{pricing.amount.toLocaleString()} {pricing.code}</span>
                </div>
                <div className="space-y-1">
                  {plan.features.slice(0, 2).map((feat, i) => (
                    <div key={i} className="flex items-center text-[10px] text-gray-400">
                      <CheckCircle2 size={10} className="text-vantage-cyan mr-1.5" />
                      {feat}
                    </div>
                  ))}
                </div>
              </div>

              {/* Gateway Selection */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <button
                  onClick={() => setGateway('fapshi')}
                  className={`p-3 rounded-xl border flex flex-col items-center gap-2 transition-all ${gateway === 'fapshi' ? 'border-vantage-purple bg-vantage-purple/10 text-vantage-purple' : 'border-slate-200 dark:border-white/10 text-gray-500 dark:text-gray-400'}`}
                >
                  <Smartphone size={20} />
                  <span className="text-xs font-bold">Cameroon (MoMo)</span>
                </button>
                <button
                  onClick={() => setGateway('selar')}
                  className={`p-3 rounded-xl border flex flex-col items-center gap-2 transition-all ${gateway === 'selar' ? 'border-vantage-cyan bg-vantage-cyan/10 text-vantage-cyan' : 'border-slate-200 dark:border-white/10 text-gray-500 dark:text-gray-400'}`}
                >
                  <Globe size={20} />
                  <span className="text-xs font-bold">Global (Selar)</span>
                </button>
              </div>

              {/* ── Selar Email Warning ─────────────────────────────────────────────
                  Critical: if the user pays in Selar with a different email than
                  their Vantage account, the server cannot match the payment to
                  their account and VIP will not be granted automatically.
              */}
              {gateway === 'selar' && userEmail && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-amber-400 mb-1">
                        {language === 'fr' ? '⚠️ Email important' : '⚠️ Important — Email Match Required'}
                      </p>
                      <p className="text-[11px] text-amber-300/90 leading-relaxed">
                        {language === 'fr'
                          ? <>Utilisez <strong className="text-amber-200">{userEmail}</strong> lors du paiement Selar. Un email différent empêchera l'activation automatique.</>
                          : <>Use <strong className="text-amber-200">{userEmail}</strong> when paying on Selar. Using a different email will prevent automatic VIP activation. Also after payment wait for atleast 2 min for the system to confirm your payment and activate your VIP</>
                        }
                      </p>
                      <div className="flex items-center gap-1.5 mt-2 px-2 py-1 bg-amber-500/15 rounded-lg w-fit">
                        <Mail size={10} className="text-amber-300" />
                        <span className="text-[10px] font-mono font-bold text-amber-200">{userEmail}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {gateway === 'selar' && !userEmail && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-5 p-3 rounded-xl bg-red-500/10 border border-red-500/30"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-red-300 leading-relaxed">
                      {language === 'fr'
                        ? 'Votre compte n\'a pas d\'email associé. Veuillez utiliser Mobile Money à la place.'
                        : 'Your account has no email address. Please use Mobile Money instead.'
                      }
                    </p>
                  </div>
                </motion.div>
              )}

              <button
                onClick={handlePayment}
                disabled={loading || (gateway === 'selar' && !userEmail)}
                className="w-full py-4 bg-vantage-purple hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-2xl transition-all shadow-lg shadow-vantage-purple/30 flex items-center justify-center space-x-2"
              >
                {loading ? (
                  <Loader2 className="animate-spin" size={20} />
                ) : (
                  <>
                    <span>{language === 'fr' ? 'Payer Maintenant' : 'Pay Now'}</span>
                    <ArrowRight size={20} />
                  </>
                )}
              </button>

              {paymentFailed && (
                <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-center">
                  <p className="text-sm font-bold text-red-500 mb-2">
                    {language === 'fr' ? 'Paiement non confirmé.' : 'Payment not confirmed.'}
                  </p>
                  <p className="text-[10px] text-gray-500 mb-4">
                    {language === 'fr' ? "Votre argent n'a PAS été débité." : "Your money was NOT charged."}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPaymentFailed(false)}
                      className="flex-1 py-2 bg-vantage-cyan text-slate-900 font-bold rounded-lg text-xs"
                    >
                      {language === 'fr' ? 'Réessayer' : 'Try Again'}
                    </button>
                    <a
                      href={`https://wa.me/237688203629?text=${encodeURIComponent(`Hi, I need help with my payment for Vantage AI. Amount: ${plan?.price || 'unknown'} FCFA`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-2 bg-green-500 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-1"
                    >
                      <MessageCircle size={12} /> Support
                    </a>
                  </div>
                </div>
              )}

              <div className="mt-4 flex items-center justify-center space-x-2 text-[10px] text-gray-500">
                <ShieldCheck size={12} className="text-green-500" />
                <span>Secure SSL Encryption • Vantage AI v4.0</span>
              </div>
            </GlassCard>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

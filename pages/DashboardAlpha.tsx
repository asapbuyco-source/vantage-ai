import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, Target, Shield, BarChart3, Activity, Zap } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';

export const DashboardAlpha: React.FC = () => {
  const { predictions, winRateStats } = useData();
  const { userProfile } = useAuth();
  const navigate = useNavigate();
  const [bankerSummary, setBankerSummary] = useState<any>(null);
  const [roiHistory, setRoiHistory] = useState<any>(null);

  const isVip = userProfile?.isVip === true;
  const safePicks = predictions.filter((p: any) => p.category === 'safe');
  const activeAlerts = predictions.filter((p: any) => p.line_signal === 'sharp_money_agrees');

  useEffect(() => {
    getDoc(doc(db, 'banker_summary', 'current')).then(snap => {
      if (snap.exists()) setBankerSummary(snap.data());
    }).catch(() => {});
    getDoc(doc(db, 'quant_performance', 'all')).then(snap => {
      if (snap.exists()) setRoiHistory(snap.data());
    }).catch(() => {});
  }, []);

  const roiPct = roiHistory?.monthly?.roi != null ? (roiHistory.monthly.roi * 100).toFixed(1) : '—';
  const bankerWinRate = bankerSummary?.win_rate_pct ?? '—';
  const bankerStreak = bankerSummary?.current_streak ?? 0;
  const bankerStreakType = bankerSummary?.streak_type ?? '';

  return (
    <div className="space-y-5 pb-32 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-orbitron text-white">
            VANTAGE<span className="text-vantage-cyan">AI</span>
          </h1>
          <p className="text-[10px] text-gray-400 tracking-widest">Command Center</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <motion.div
          whileHover={{ scale: 1.02 }}
          onClick={() => navigate('/vip')}
          className="p-4 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-teal-500/5 border border-emerald-500/20 cursor-pointer"
        >
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} className="text-emerald-400" />
            <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold">System ROI</span>
          </div>
          <p className="text-2xl font-black font-mono text-emerald-400">{roiPct}%</p>
          <p className="text-[9px] text-gray-400 mt-1">Last 30 days</p>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02 }}
          className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/10 to-yellow-500/5 border border-amber-500/20 cursor-pointer"
        >
          <div className="flex items-center gap-2 mb-2">
            <Target size={16} className="text-amber-400" />
            <span className="text-[10px] uppercase tracking-wider text-amber-400 font-bold">Banker</span>
          </div>
          <p className="text-2xl font-black font-mono text-amber-400">{bankerWinRate}%</p>
          {bankerStreak >= 3 && bankerStreakType === 'win' && (
            <p className="text-[9px] text-amber-400/70 mt-1">🔥 {bankerStreak} win streak</p>
          )}
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02 }}
          className="p-4 rounded-2xl bg-gradient-to-br from-vantage-cyan/10 to-blue-500/5 border border-vantage-cyan/20"
        >
          <div className="flex items-center gap-2 mb-2">
            <Shield size={16} className="text-vantage-cyan" />
            <span className="text-[10px] uppercase tracking-wider text-vantage-cyan font-bold">Safe Picks</span>
          </div>
          <p className="text-2xl font-black font-mono text-vantage-cyan">{safePicks.length}</p>
          <p className="text-[9px] text-gray-400 mt-1">Active today</p>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02 }}
          className="p-4 rounded-2xl bg-gradient-to-br from-purple-500/10 to-pink-500/5 border border-purple-500/20"
        >
          <div className="flex items-center gap-2 mb-2">
            <Activity size={16} className="text-purple-400" />
            <span className="text-[10px] uppercase tracking-wider text-purple-400 font-bold">Signals</span>
          </div>
          <p className="text-2xl font-black font-mono text-purple-400">{activeAlerts.length}</p>
          <p className="text-[9px] text-gray-400 mt-1">Sharp money alerts</p>
        </motion.div>
      </div>

      {/* Active Alerts */}
      {activeAlerts.length > 0 && (
        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} className="text-amber-400" />
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">
              Active Upset Alerts
            </span>
          </div>
          <div className="space-y-2">
            {activeAlerts.slice(0, 5).map((m: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white">{m.homeTeam} vs {m.awayTeam}</span>
                </div>
                <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                  📈 Sharp Money {(Math.abs(m.line_shift || 0) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIP Gate */}
      {!isVip && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 rounded-2xl bg-gradient-to-r from-vantage-purple/10 to-vantage-cyan/10 border border-vantage-purple/30 text-center"
        >
          <Zap size={32} className="text-vantage-purple mx-auto mb-3" />
          <h3 className="text-base font-bold text-white mb-2">Full Dashboard Access</h3>
          <p className="text-sm text-gray-400 mb-4 max-w-[280px] mx-auto">
            Upgrade to VIP to unlock personalized analytics, historical ROI tracking, and advanced charting.
          </p>
          <button
            onClick={() => navigate('/vip')}
            className="px-6 py-2.5 rounded-xl bg-vantage-purple text-white text-sm font-bold hover:bg-vantage-purple/90 transition-colors"
          >
            Upgrade Now
          </button>
        </motion.div>
      )}
    </div>
  );
};

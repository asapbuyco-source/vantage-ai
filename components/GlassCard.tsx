import React from 'react';
import { motion } from 'framer-motion';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  highlight?: boolean;
  delay?: number;
  onClick?: () => void;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className = '',
  highlight = false,
  delay = 0,
  onClick
}) => {
  return (
    // @ts-ignore
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: delay * 0.08, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileHover={onClick ? { scale: 1.01, transition: { duration: 0.15 } } : undefined}
      whileTap={onClick ? { scale: 0.98 } : undefined}
      onClick={onClick}
      className={`
        relative overflow-hidden rounded-2xl border backdrop-blur-md
        ${onClick ? 'cursor-pointer glass-hover' : ''}
        ${highlight
          ? 'border-vantage-cyan/30 bg-vantage-cyan/10 dark:bg-vantage-cyan/5 shadow-cyan-glow'
          : 'border-slate-200 bg-white/90 dark:border-white/10 dark:bg-white/5 shadow-glass'}
        p-5
        ${className}
      `}
    >
      {/* Top edge highlight line */}
      <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-vantage-cyan/40 to-transparent pointer-events-none" />

      {/* Corner glow orbs */}
      <div className="absolute -top-8 -right-8 w-16 h-16 bg-white/30 dark:bg-white/5 rounded-full blur-2xl pointer-events-none opacity-60 dark:opacity-100" />
      <div className="absolute -bottom-8 -left-8 w-16 h-16 bg-vantage-cyan/10 dark:bg-vantage-cyan/5 rounded-full blur-2xl pointer-events-none" />

      {/* Animated shimmer — driven by CSS animation via Tailwind arbitrary keyframe */}
      <motion.div
        className="absolute inset-0 z-0 pointer-events-none"
        initial={{ x: '-110%' }}
        animate={{ x: '110%' }}
        transition={{ duration: 3.5, repeat: Infinity, repeatDelay: 6, ease: 'easeInOut' }}
        style={{
          background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.07) 50%, transparent 60%)',
        }}
      />

      <div className="relative z-10">
        {children}
      </div>
    </motion.div>
  );
};
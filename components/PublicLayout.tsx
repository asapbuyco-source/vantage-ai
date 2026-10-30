import React from 'react';
import { SiteNav } from './SiteNav';
import { SiteFooter } from './SiteFooter';

export const PublicLayout: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`min-h-screen bg-vantage-bg text-white ${className}`}>
        <SiteNav />
        <main className="max-w-3xl mx-auto px-4 py-8">{children}</main>
        <SiteFooter />
    </div>
);

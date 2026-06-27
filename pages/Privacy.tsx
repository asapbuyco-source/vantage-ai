import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LegalDoc } from '../components/LegalDoc';

export const Privacy: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-vantage-lightBg dark:bg-vantage-bg pt-6 pb-20 px-4 md:px-8">
      <div className="max-w-3xl mx-auto mt-4">
        <LegalDoc type="privacy" onBack={() => navigate('/')} />
      </div>
    </div>
  );
};

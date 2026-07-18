import React from 'react';

export const ResponsibleGambling: React.FC<{ compact?: boolean }> = ({ compact }) => {
  return (
    <div className="text-center py-6 px-4">
      <p className="text-[11px] text-gray-500 dark:text-gray-500">
        Bet responsibly. Predictions are for informational purposes only. Only wager what you can afford to lose.
      </p>
      {!compact && (
        <p className="text-[10px] text-gray-400 mt-2">
          If you or someone you know has a gambling problem, please seek help.
          Gambling involves financial risk and may be addictive.
        </p>
      )}
    </div>
  );
};

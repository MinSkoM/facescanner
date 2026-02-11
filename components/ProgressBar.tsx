
import React from 'react';

interface ProgressBarProps {
  score: number;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ score }) => {
  const percentage = score * 100;
  const isReal = score > 0.5;
  const barColor = isReal ? 'bg-green-500' : 'bg-red-500';

  return (
    <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
      <div
        className={`${barColor} h-4 rounded-full transition-all duration-500 ease-out`}
        style={{ width: `${percentage}%` }}
      ></div>
    </div>
  );
};

export default ProgressBar;


import React from 'react';
import { PredictionResult } from '../types';
import ProgressBar from './ProgressBar';

interface ResultDisplayProps {
  result: PredictionResult;
}

const ResultDisplay: React.FC<ResultDisplayProps> = ({ result }) => {
  const { score, is_real } = result;
  const resultText = is_real ? 'REAL PERSON' : 'SPOOF DETECTED';
  const resultEmoji = is_real ? '✅' : '⛔';
  const bgColor = is_real ? 'bg-green-100' : 'bg-red-100';
  const textColor = is_real ? 'text-green-800' : 'text-red-800';

  return (
    <div className="mt-6 p-6 border rounded-lg animate-fade-in">
      <div className={`${bgColor} ${textColor} text-xl font-bold p-4 rounded-lg flex items-center justify-center`}>
        <span className="mr-3 text-2xl">{resultEmoji}</span>
        {resultText}
      </div>
      <div className="mt-4">
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-medium text-gray-700">Confidence Score</span>
          <span className={`text-sm font-semibold ${textColor}`}>
            {(score * 100).toFixed(2)}%
          </span>
        </div>
        <ProgressBar score={score} />
      </div>
    </div>
  );
};

export default ResultDisplay;

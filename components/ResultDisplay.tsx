import React from 'react';

interface ResultDisplayProps {
  result: any;
}

const ResultDisplay: React.FC<ResultDisplayProps> = ({ result }) => {
  const isReal = result?.is_real;
  const scorePercent = result?.score ? (result.score * 100).toFixed(1) : "0.0";
  
  return (
    <div className="flex flex-col items-center justify-center p-4 animate-in fade-in zoom-in duration-500 w-full">
      {/* Icon Circle */}
      <div className={`w-28 h-28 rounded-full flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(0,0,0,0.5)] border-4 ${isReal ? 'bg-green-500/10 border-green-500/50 text-green-500' : 'bg-red-500/10 border-red-500/50 text-red-500'}`}>
        {isReal ? (
          <svg className="w-14 h-14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"/></svg>
        ) : (
          <svg className="w-14 h-14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/></svg>
        )}
      </div>
      
      {/* Main Text */}
      <h2 className="text-4xl font-black text-white mb-2 tracking-tight drop-shadow-lg">
        {isReal ? "VERIFIED" : "REJECTED"}
      </h2>
      <p className={`text-sm font-mono uppercase tracking-[0.2em] mb-8 ${isReal ? 'text-green-400' : 'text-red-400'}`}>
        Confidence: {scorePercent}%
      </p>

      {/* Details Grid */}
      {result.details && (
        <div className="grid grid-cols-2 gap-4 w-full bg-white/5 rounded-2xl p-4 border border-white/5 backdrop-blur-sm">
          <div className="text-center p-2">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Motion</p>
            <p className="text-xl font-bold text-indigo-400">{result.details.motion_consistency?.toFixed(2) || '-'}</p>
          </div>
          <div className="text-center p-2 border-l border-white/10">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Visual</p>
            <p className="text-xl font-bold text-indigo-400">{result.details.visual_liveness?.toFixed(2) || '-'}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultDisplay;
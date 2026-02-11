import React, { useState, useCallback } from 'react';
import ResultDisplay from './components/ResultDisplay';
import FaceScan from './components/FaceScan';

// Type definition
interface PredictionResult {
  score: number;
  is_real: boolean;
  status: string;
  details?: {
    motion_consistency: number;
    visual_liveness: number;
    frames_processed: number;
  };
}

const App: React.FC = () => {
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [scanKey, setScanKey] = useState<number>(0);

  // ดึง URL จาก .env
  const NGROK_URL = (import.meta as any).env?.VITE_NGROK_URL;

  // ปรับ handleSubmit ให้รับ imageBlob ด้วย
  const handleSubmit = useCallback(async (scanData: any, imageBlob: Blob | null) => {
    if (!NGROK_URL) {
      setError('Backend URL is not configured.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);

    // --- จุดแก้ไขสำคัญ 1: ห่อ scanData ด้วย key "data" ---
    // เพื่อแก้ Error: 'list' object has no attribute 'get'
    const payload = { data: scanData };
    const jsonBlob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    
    // เตรียม FormData
    const formData = new FormData();
    formData.append('file', jsonBlob, 'liveness.json');
    
    // --- จุดแก้ไขสำคัญ 2: แนบรูปภาพไปด้วย ---
    // เพื่อให้ Backend นำไปคำนวณ Visual Score ได้
    if (imageBlob) {
      formData.append('image', imageBlob, 'capture.jpg');
    }

    let formattedUrl = NGROK_URL.trim();
    if (formattedUrl.endsWith('/')) {
        formattedUrl = formattedUrl.slice(0, -1);
    }

    try {
      const response = await fetch(`${formattedUrl}/predict`, {
        method: 'POST',
        headers: {
          'ngrok-skip-browser-warning': '69420',
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || errorData.message || `Server Error: ${response.status}`);
      }

      const data: PredictionResult = await response.json();
      setResult(data);
    } catch (err: any) {
      console.error('API Error:', err);
      setError(err.message || 'Connection failed.');
    } finally {
      setIsLoading(false);
    }
  }, [NGROK_URL]);
  
  const handleScanAgain = () => {
    setResult(null);
    setError(null);
    setIsLoading(false);
    setScanKey(prev => prev + 1);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#05050a] text-slate-200 font-sans selection:bg-indigo-500/30 overflow-hidden relative">
      
      {/* Background Ambience */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-600/20 rounded-full blur-[128px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-purple-600/10 rounded-full blur-[128px] pointer-events-none" />

      <div className="w-full max-w-md z-10 px-6 py-8">
        
        {/* Header */}
        <header className="text-center mb-8 animate-in fade-in slide-in-from-top-4 duration-700">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/5 rounded-2xl shadow-[0_0_40px_-10px_rgba(79,70,229,0.3)] mb-6 border border-white/10 backdrop-blur-md">
            <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white mb-2 drop-shadow-lg">
            GSYNC <span className="text-indigo-500">LIVENESS</span>
          </h1>
          <p className="text-slate-500 text-xs font-bold tracking-[0.2em] uppercase">
            {result ? "Verification Report" : "Biometric Security Check"}
          </p>
        </header>

        {/* Main Card */}
        <main className="relative bg-black/40 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border border-white/10 overflow-hidden ring-1 ring-white/5">
          <div className="p-1">
            
            {/* 1. State: Scanning */}
            {!result && !isLoading && !error && (
               <FaceScan key={scanKey} onScanComplete={handleSubmit} />
            )}

            {/* 2. State: Loading */}
            {isLoading && (
              <div className="flex flex-col items-center justify-center py-24 space-y-8 min-h-[400px]">
                <div className="relative">
                  <div className="w-24 h-24 border-4 border-white/5 border-t-indigo-500 rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-12 h-12 bg-indigo-500/20 rounded-full animate-pulse blur-md"></div>
                  </div>
                </div>
                <div className="text-center space-y-2">
                  <p className="text-xl font-bold text-white uppercase tracking-widest animate-pulse">Processing</p>
                  <p className="text-xs text-indigo-300/70 font-mono">Analyzing vectors & textures...</p>
                </div>
              </div>
            )}
            
            {/* 3. State: Error */}
            {(!NGROK_URL || error) && !isLoading && (
              <div className="p-10 flex flex-col items-center text-center min-h-[400px] justify-center">
                <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-6 text-red-500 border border-red-500/20">
                   <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">System Error</h3>
                <p className="text-slate-400 mb-8 text-sm leading-relaxed">
                  {error || "API Endpoint is missing. Please check your environment variables."}
                </p>
                <button onClick={handleScanAgain} className="w-full py-4 px-6 bg-white text-black font-bold rounded-2xl hover:bg-slate-200 transition-all shadow-lg active:scale-95 uppercase tracking-wider text-xs">
                  Retry Connection
                </button>
              </div>
            )}

            {/* 4. State: Result */}
            {result && (
              <div className="p-6 flex flex-col justify-between min-h-[450px]">
                <ResultDisplay result={result} />
                <button 
                  onClick={handleScanAgain} 
                  className="w-full mt-6 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 px-6 rounded-2xl transition-all shadow-[0_10px_30px_-10px_rgba(79,70,229,0.5)] active:scale-[0.98] uppercase tracking-wider text-xs"
                >
                  New Scan
                </button>
              </div>
            )}

          </div>
        </main>

        <footer className="mt-8 text-center">
          <p className="text-slate-600 text-[10px] font-bold uppercase tracking-[0.3em]">
            Secure Identity V2.0
          </p>
        </footer>
      </div>
    </div>
  );
};

export default App;
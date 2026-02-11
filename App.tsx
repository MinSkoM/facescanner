import React, { useState, useCallback } from 'react';
import { PredictionResult } from './types';
import ResultDisplay from './components/ResultDisplay';
import FaceScan from './components/FaceScan';

const App: React.FC = () => {
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [scanKey, setScanKey] = useState<number>(0); // Used to reset the FaceScan component

  const NGROK_URL = (import.meta as any).env?.VITE_NGROK_URL;

  const handleSubmit = useCallback(async (scanData: object) => {
    if (!NGROK_URL) {
      setError('Backend URL is not configured. Please contact the site administrator.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);

    const blob = new Blob([JSON.stringify(scanData)], { type: 'application/json' });
    const formData = new FormData();
    formData.append('file', blob, 'liveness.json');
    
    let formattedUrl = NGROK_URL.trim();
    if (formattedUrl.endsWith('/')) {
        formattedUrl = formattedUrl.slice(0, -1);
    }

    try {
      const response = await fetch(`${formattedUrl}/predict`, {
        method: 'POST',
        headers: {
          // เพิ่มบรรทัดนี้สำคัญมาก! เพื่อทะลุหน้า Warning ของ Ngrok
          'ngrok-skip-browser-warning': '69420', 
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }

      const data: PredictionResult = await response.json();
      setResult(data);
    } catch (err: any) {
      console.error('Prediction API error:', err);
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  }, [NGROK_URL]);
  
  const handleScanAgain = () => {
    setResult(null);
    setError(null);
    setIsLoading(false);
    setScanKey(prevKey => prevKey + 1); // Change key to force remount/reset of FaceScan
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f8fafc] p-6 font-sans text-slate-900">
      <div className="w-full max-w-md">
        {/* Header */}
        <header className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-white rounded-2xl shadow-sm mb-4 border border-slate-200">
            <svg className="w-7 h-7 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-800 uppercase">GSYNC <span className="text-indigo-600">Vision</span></h1>
          <p className="text-slate-500 text-sm font-medium mt-1 uppercase tracking-widest">Identity Verification</p>
        </header>

        {/* Main Container */}
        <main className="bg-white rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.04)] border border-slate-100 overflow-hidden">
          <div className="p-4"> {/* ลด padding เพื่อให้พื้นที่กล้องใหญ่ขึ้น */}
            
            {!result && !isLoading && !error && (
              <div className="animate-in fade-in duration-500">
                {/* ส่ง Props ที่จำเป็นไปให้ FaceScan */}
                <FaceScan key={scanKey} onScanComplete={handleSubmit} />
              </div>
            )}

            {isLoading && (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="relative w-16 h-16 mb-6">
                  <div className="absolute inset-0 border-4 border-slate-100 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                </div>
                <p className="text-slate-800 font-bold uppercase tracking-widest text-xs">Analyzing Biometrics</p>
              </div>
            )}

            {error && (
              <div className="p-8 text-center bg-red-50 rounded-[2rem]">
                <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                </div>
                <p className="text-red-800 font-bold mb-6">{error}</p>
                <button onClick={handleScanAgain} className="w-full py-4 bg-white border border-red-200 text-red-600 font-bold rounded-2xl hover:bg-red-100 transition-all">Try Again</button>
              </div>
            )}

            {result && (
              <div className="p-2 animate-in zoom-in duration-300">
                <ResultDisplay result={result} />
                <button onClick={handleScanAgain} className="mt-4 w-full bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-black transition-all active:scale-[0.98]">
                  Re-Scan Identity
                </button>
              </div>
            )}
          </div>
        </main>

        <footer className="mt-8 text-center text-slate-400 text-[10px] font-bold uppercase tracking-[0.3em]">
          System Secure Layer v2.4
        </footer>
      </div>
    </div>
  );
};

export default App;
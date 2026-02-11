import React, { useState, useCallback, useRef, useEffect } from 'react';

// ==========================================
// 1. COMPONENTS (ส่วนแสดงผลย่อย)
// ==========================================

// --- ResultDisplay: ส่วนแสดงผลลัพธ์ (Design ใหม่) ---
const ResultDisplay = ({ result }) => {
  const isReal = result?.is_real;
  // แปลงค่า score เป็น % (รองรับกรณีไม่มีค่า)
  const scorePercent = result?.score ? (result.score * 100).toFixed(1) : "0.0";
  
  return (
    <div className="flex flex-col items-center justify-center p-4 animate-in fade-in zoom-in duration-500">
      {/* Icon Ring */}
      <div className={`w-28 h-28 rounded-full flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(0,0,0,0.5)] border-4 ${isReal ? 'bg-green-500/10 border-green-500/50 text-green-500' : 'bg-red-500/10 border-red-500/50 text-red-500'}`}>
        {isReal ? (
          <svg className="w-14 h-14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"/></svg>
        ) : (
          <svg className="w-14 h-14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/></svg>
        )}
      </div>
      
      {/* Text Result */}
      <h2 className="text-4xl font-black text-white mb-2 tracking-tight drop-shadow-lg">
        {isReal ? "VERIFIED" : "REJECTED"}
      </h2>
      <p className={`text-sm font-mono uppercase tracking-[0.2em] mb-8 ${isReal ? 'text-green-400' : 'text-red-400'}`}>
        Confidence: {scorePercent}%
      </p>

      {/* Details Grid (ถ้ามีข้อมูล) */}
      {result.details && (
        <div className="grid grid-cols-2 gap-4 w-full bg-white/5 rounded-2xl p-4 border border-white/5 backdrop-blur-sm">
          <div className="text-center p-2">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Motion</p>
            <p className="text-xl font-bold text-indigo-400">{result.details.motion_consistency?.toFixed(2) || '-'}</p>
          </div>
          <div className="text-center p-2 border-l border-white/10">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Liveness</p>
            <p className="text-xl font-bold text-indigo-400">{result.details.visual_liveness?.toFixed(2) || '-'}</p>
          </div>
        </div>
      )}
    </div>
  );
};

// --- FaceScan: ส่วนกล้องและ HUD (Design ใหม่ + Logic กล้องพื้นฐาน) ---
const FaceScan = ({ onScanComplete }) => {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle, scanning, complete
  const [progress, setProgress] = useState(0);

  // เปิดกล้องเมื่อ Component ถูกโหลด
  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setStatus('ready');
      }
    } catch (err) {
      console.error("Camera Error", err);
      alert("Cannot access camera. Please allow permission.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
  };

  const startScanning = () => {
    setStatus('scanning');
    let count = 0;
    const maxFrames = 40; // จำลองระยะเวลาสแกน (ประมาณ 2 วินาที)
    
    const interval = setInterval(() => {
      count++;
      setProgress((count / maxFrames) * 100);
      
      if (count >= maxFrames) {
        clearInterval(interval);
        setStatus('complete');
        
        // ส่งข้อมูลกลับไปที่ App (Logic เดิมของคุณต้องการ object scanData)
        // ตรงนี้ส่ง dummy data หรือ data จริงจากการ capture frame ก็ได้
        const scanData = { 
          timestamp: Date.now(), 
          message: "scan_captured",
          // ถ้ามี logic capture frame จริง ให้ใส่ตรงนี้
        };
        onScanComplete(scanData);
      }
    }, 50);
  };

  return (
    <div className="relative w-full aspect-[3/4] bg-neutral-900 overflow-hidden rounded-[2.3rem] shadow-inner ring-1 ring-white/10">
      <video ref={videoRef} className="w-full h-full object-cover transform scale-x-[-1]" playsInline muted />
      
      {/* HUD Overlay */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-radial-gradient from-transparent via-black/10 to-black/80" />
        
        {/* Face Oval */}
        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[55%] w-[65%] h-[55%] rounded-[50%] transition-all duration-700 ease-out ${
           status === 'scanning' ? 'border-[3px] border-indigo-500 shadow-[0_0_60px_rgba(99,102,241,0.6)] scale-105' : 'border-2 border-white/20'
        }`}>
           {/* Corner Markers */}
           <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-3 bg-indigo-400/80"></div>
           <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-1 h-3 bg-indigo-400/80"></div>
           <div className="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 w-3 h-1 bg-indigo-400/80"></div>
           <div className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 w-3 h-1 bg-indigo-400/80"></div>
        </div>

        {/* Laser Scan Line */}
        {status === 'scanning' && (
           <div className="absolute inset-0 z-20 overflow-hidden">
             <div className="w-full h-[2px] bg-indigo-400 shadow-[0_0_25px_rgba(99,102,241,1)] absolute animate-scan-line" />
           </div>
        )}
      </div>

      {/* Button & Progress Bar */}
      <div className="absolute bottom-8 left-0 w-full px-6 flex justify-center z-30">
        {status === 'ready' && (
          <button 
            onClick={startScanning} 
            className="group relative w-20 h-20 rounded-full flex items-center justify-center bg-white/10 border border-white/20 backdrop-blur-md hover:scale-110 transition-all duration-300 cursor-pointer shadow-lg"
          >
            <div className="absolute inset-0 rounded-full bg-indigo-500 opacity-20 group-hover:opacity-40 animate-ping" />
            <div className="w-14 h-14 bg-white rounded-full shadow-[0_0_20px_rgba(255,255,255,0.5)] flex items-center justify-center">
               <div className="w-5 h-5 bg-indigo-600 rounded-sm" />
            </div>
          </button>
        )}
        
        {status === 'scanning' && (
           <div className="w-full max-w-[220px] h-2 bg-gray-800 rounded-full overflow-hidden border border-white/10">
              <div className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 transition-all duration-100 animate-pulse" style={{ width: `${progress}%` }} />
           </div>
        )}
      </div>
      
      {/* Animation Styles */}
      <style>{`
        @keyframes scan-line {
          0% { top: 10%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 90%; opacity: 0; }
        }
        .animate-scan-line {
          animation: scan-line 2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
      `}</style>
    </div>
  );
};

// ==========================================
// 2. MAIN APP (Logic เดิม + Design ใหม่)
// ==========================================

const App = () => {
  // State เดิมของคุณ
  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [scanKey, setScanKey] = useState(0); 

  // Env Variable เดิม
  const NGROK_URL = import.meta.env?.VITE_NGROK_URL;

  // Logic: handleSubmit (คงเดิม 100% ตามที่คุณให้มา)
  const handleSubmit = useCallback(async (scanData) => {
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
          'ngrok-skip-browser-warning': '69420', // Header สำคัญที่คุณใส่ไว้
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      console.error('Prediction API error:', err);
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  }, [NGROK_URL]);
  
  // Logic: handleScanAgain (คงเดิม)
  const handleScanAgain = () => {
    setResult(null);
    setError(null);
    setIsLoading(false);
    setScanKey(prevKey => prevKey + 1);
  };

  // --- RENDER (เปลี่ยนแค่หน้ากากเป็น Dark Mode) ---
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#05050a] text-slate-200 relative overflow-hidden font-sans selection:bg-indigo-500/30">
      
      {/* Background Effects */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-600/20 rounded-full blur-[128px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-purple-600/10 rounded-full blur-[128px] pointer-events-none" />

      <div className="w-full max-w-md z-10 px-6">
        
        {/* Header Section */}
        <header className="text-center mb-8 animate-in fade-in slide-in-from-top-4 duration-700">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/5 rounded-2xl shadow-[0_0_40px_-10px_rgba(79,70,229,0.3)] mb-6 border border-white/10 backdrop-blur-md">
            <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-4xl font-black tracking-tight text-white mb-2 drop-shadow-lg">
            GSYNC <span className="text-indigo-500">Liveness Detection</span>
          </h1>
          <p className="text-slate-400 text-sm font-medium tracking-widest uppercase">
            {result ? "Verification Complete" : "Secure Identity Check"}
          </p>
        </header>

        {/* Main Card Container */}
        <main className="relative bg-black/40 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl border border-white/10 overflow-hidden ring-1 ring-white/5">
          <div className="p-1">
            
            {/* 1. Normal State: Scanning */}
            {!result && !isLoading && !error && (
              <FaceScan key={scanKey} onScanComplete={handleSubmit} />
            )}

            {/* 2. Loading State (Design ใหม่) */}
            {isLoading && (
              <div className="flex flex-col items-center justify-center py-24 space-y-8 min-h-[400px]">
                <div className="relative">
                  <div className="w-24 h-24 border-4 border-white/5 border-t-indigo-500 rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-12 h-12 bg-indigo-500/20 rounded-full animate-pulse blur-md"></div>
                  </div>
                </div>
                <div className="text-center space-y-2">
                  <p className="text-xl font-bold text-white uppercase tracking-widest animate-pulse">Analyzing</p>
                  <p className="text-sm text-indigo-300/70 font-mono">Verifying biometric data...</p>
                </div>
              </div>
            )}
            
            {/* 3. Error/Config State (Design ใหม่) */}
            {(!NGROK_URL || error) && !isLoading && (
              <div className="p-10 flex flex-col items-center text-center min-h-[400px] justify-center">
                <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 ${error ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'}`}>
                   <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                   </svg>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">
                  {error ? 'System Error' : 'Setup Required'}
                </h3>
                <p className="text-slate-400 mb-8">
                  {error || "The API endpoint is not configured in your environment settings."}
                </p>
                <button onClick={handleScanAgain} className="w-full py-4 px-6 bg-white text-black font-bold rounded-2xl hover:bg-slate-200 transition-all shadow-lg active:scale-95">
                  Try Again
                </button>
              </div>
            )}

            {/* 4. Result State (Design ใหม่) */}
            {result && (
              <div className="p-6 min-h-[450px] flex flex-col justify-between">
                <ResultDisplay result={result} />
                <button 
                  onClick={handleScanAgain} 
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 px-6 rounded-2xl transition-all shadow-[0_10px_30px_-10px_rgba(79,70,229,0.5)] active:scale-[0.98] mt-4"
                >
                  Scan Again
                </button>
              </div>
            )}
          </div>
        </main>

        {/* Footer Info */}
        <footer className="mt-8 text-center text-slate-500 text-[10px] font-bold uppercase tracking-[0.3em]">
          Secure Identity Verification v2.0
        </footer>
      </div>
    </div>
  );
};

export default App;
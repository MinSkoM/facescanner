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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 font-sans">
      <div className="w-full max-w-lg mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800">Face Liveness Detection</h1>
           <p className="text-gray-600 mt-2">
            {result ? "Prediction Result" : "Perform a quick scan to verify liveness."}
          </p>
        </header>

        <main className="bg-white p-8 rounded-2xl shadow-lg space-y-6">
          {!result && !isLoading && !error && (
             <FaceScan key={scanKey} onScanComplete={handleSubmit} />
          )}

          {isLoading && (
             <div className="flex flex-col items-center justify-center p-10 space-y-4">
               <svg className="animate-spin h-10 w-10 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="text-gray-700 font-semibold">Analyzing liveness...</p>
             </div>
          )}
          
          {!NGROK_URL && (
            <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4" role="alert">
              <p className="font-bold">Configuration Notice</p>
              <p>The backend API URL is not configured. The application will not function correctly.</p>
            </div>
          )}

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative text-center" role="alert">
              <strong className="font-bold">Error: </strong>
              <span className="block sm:inline">{error}</span>
               <button onClick={handleScanAgain} className="mt-4 w-full bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700">
                  Try Again
               </button>
            </div>
          )}

          {result && (
            <div className="text-center">
              <ResultDisplay result={result} />
              <button onClick={handleScanAgain} className="mt-6 w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700">
                Scan Again
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
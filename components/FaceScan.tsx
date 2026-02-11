import React, { useState, useRef, useEffect, useCallback } from 'react';

const FRAMES_TO_COLLECT = 100;
const API_URL = "https://malika-shedable-recollectively.ngrok-free.dev/predict"; 

declare const FaceMesh: any;

interface FaceScanProps {
    onScanComplete?: (data: any) => void;
}

const FaceScan: React.FC<FaceScanProps> = ({ onScanComplete }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const faceMeshRef = useRef<any>(null);
    const recordedDataRef = useRef<any[]>([]);
    const animationFrameId = useRef<number>();
    
    const isScanningRef = useRef(false);
    const sensorsRef = useRef({ 
        accel: { x: 0, y: 0, z: 0 }, 
        gyro: { x: 0, y: 0, z: 0 } 
    });

    const [status, setStatus] = useState<string>('initializing');
    const [frameCount, setFrameCount] = useState(0);
    const [debugMsg, setDebugMsg] = useState<string>("กำลังโหลด AI...");
    const [result, setResult] = useState<any>(null);

    useEffect(() => {
        const handleMotion = (e: DeviceMotionEvent) => {
            sensorsRef.current.accel = {
                x: e.accelerationIncludingGravity?.x || 0,
                y: e.accelerationIncludingGravity?.y || 0,
                z: e.accelerationIncludingGravity?.z || 0
            };
        };
        const handleOrientation = (e: DeviceOrientationEvent) => {
            sensorsRef.current.gyro = {
                x: e.beta || 0,
                y: e.gamma || 0,
                z: e.alpha || 0
            };
        };

        window.addEventListener('devicemotion', handleMotion);
        window.addEventListener('deviceorientation', handleOrientation);
        return () => {
            window.removeEventListener('devicemotion', handleMotion);
            window.removeEventListener('deviceorientation', handleOrientation);
        };
    }, []);

    const cleanup = useCallback(() => {
        isScanningRef.current = false;
        if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
        }
    }, []);

    const onResults = useCallback(async (results: any) => {
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.save();
                ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                ctx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);
                ctx.restore();
            }
        }

        if (isScanningRef.current) {
            if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
                const landmarks = results.multiFaceLandmarks[0];
                recordedDataRef.current.push({
                    faceMesh: landmarks.map((lm: any) => [lm.x, lm.y, lm.z]).flat(),
                    sensors: { ...sensorsRef.current },
                    meta: { t: Date.now(), camera_facing: 'user' }
                });

                const count = recordedDataRef.current.length;
                setFrameCount(count);

                if (count >= FRAMES_TO_COLLECT) {
                    isScanningRef.current = false;
                    setStatus('processing');
                    setDebugMsg("กำลังประมวลผลคะแนน...");
                    await sendDataToAPI();
                }
            } else {
                setDebugMsg("❌ ไม่พบใบหน้า กรุณาจัดตำแหน่งใหม่"); 
            }
        }
    }, []);

    const sendDataToAPI = async () => {
        try {
            // 1. ดึงภาพปัจจุบันจาก Canvas (ภาพที่แสดงบนจอ)
            const canvas = canvasRef.current;
            if (!canvas) return;
            
            // แปลงภาพเป็น Blob (JPEG)
            const imageBlob = await new Promise<Blob | null>(resolve => 
                canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.8)
            );

            const payload = { data: recordedDataRef.current };
            const jsonBlob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            
            const formData = new FormData();
            formData.append('file', jsonBlob, 'scan.json');
            if (imageBlob) {
                formData.append('image', imageBlob, 'frame.jpg'); // ส่งรูปไปด้วย!
            }

            const response = await fetch(API_URL, {
                method: 'POST',
                body: formData,
                headers: { "ngrok-skip-browser-warning": "69420" }
            });

            const data = await response.json();
            setResult(data);
            setStatus('done');
        } catch (e: any) {
            setDebugMsg(`❌ Error: ${e.message}`);
            setStatus('ready');
        }
    };

    const startScan = async () => {
        setResult(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: { ideal: 480 }, height: { ideal: 640 }, facingMode: 'user' } 
            });

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.onloadedmetadata = async () => {
                    await videoRef.current!.play();
                    if (canvasRef.current) {
                        canvasRef.current.width = videoRef.current!.videoWidth;
                        canvasRef.current.height = videoRef.current!.videoHeight;
                    }
                    setStatus('scanning');
                    recordedDataRef.current = [];
                    setFrameCount(0);
                    isScanningRef.current = true;
                    startLoop();
                };
            }
        } catch (e) {
            setStatus('error');
            setDebugMsg("ไม่สามารถเปิดกล้องได้");
        }
    };

    const startLoop = () => {
        const loop = async () => {
            if (!isScanningRef.current) return;
            if (videoRef.current && faceMeshRef.current && !videoRef.current.paused) {
                await faceMeshRef.current.send({ image: videoRef.current });
            }
            animationFrameId.current = requestAnimationFrame(loop);
        };
        loop();
    };

    useEffect(() => {
        const initAI = async () => {
            try {
                faceMeshRef.current = new FaceMesh({
                    locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
                });
                await faceMeshRef.current.setOptions({
                    maxNumFaces: 1,
                    refineLandmarks: false,
                    minDetectionConfidence: 0.5,
                });
                faceMeshRef.current.onResults(onResults);
                setStatus('ready');
                setDebugMsg("พร้อมสแกนใบหน้า");
            } catch (e) { setStatus('error'); }
        };
        initAI();
        return cleanup;
    }, [onResults, cleanup]);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0a] text-white p-6 font-sans">
            {/* Header Section */}
            <div className="text-center mb-8">
                <h1 className="text-3xl font-black tracking-tighter bg-gradient-to-b from-white to-neutral-500 bg-clip-text text-transparent">
                    GSYNC <span className="text-blue-500">VISION</span>
                </h1>
                <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-bold mt-1">Liveness Identity Verification</p>
            </div>

            {/* Camera Container */}
            <div className="relative w-full max-w-[340px] aspect-[3/4] rounded-[2.5rem] overflow-hidden border border-white/10 shadow-[0_0_50px_-12px_rgba(59,130,246,0.3)] bg-neutral-900">
                <video ref={videoRef} className="hidden" playsInline muted />
                <canvas ref={canvasRef} className="w-full h-full object-cover transform -scale-x-100" />
                
                {/* Face Oval Overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className={`w-[75%] h-[68%] border-2 rounded-[50%] transition-all duration-500 ${
                        status === 'scanning' ? 'border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.5)] scale-105' : 'border-white/20'
                    }`}>
                        {/* Corner Brackets */}
                        <div className="absolute -top-2 -left-2 w-6 h-6 border-t-2 border-l-2 border-blue-400 rounded-tl-lg" />
                        <div className="absolute -bottom-2 -right-2 w-6 h-6 border-b-2 border-right-2 border-blue-400 rounded-br-lg" />
                    </div>
                </div>

                {/* Scanning Effect */}
                {status === 'scanning' && (
                    <div className="absolute inset-0 overflow-hidden pointer-events-none">
                        <div className="w-full h-[20%] bg-gradient-to-b from-blue-500/30 to-transparent absolute top-0 animate-scan-line border-b border-blue-400/50" />
                    </div>
                )}

                {/* Progress Bar (Bottom) */}
                {status === 'scanning' && (
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[80%] h-1.5 bg-white/10 rounded-full overflow-hidden backdrop-blur-md">
                        <div 
                            className="h-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-300" 
                            style={{ width: `${(frameCount / FRAMES_TO_COLLECT) * 100}%` }} 
                        />
                    </div>
                )}
            </div>

            {/* Status & Results Section */}
            <div className="mt-8 w-full max-w-[340px] min-h-[140px]">
                {result ? (
                    <div className="bg-neutral-900/50 backdrop-blur-xl p-6 rounded-[2rem] border border-white/10 shadow-xl animate-in fade-in zoom-in duration-300">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-xs font-bold text-neutral-400 uppercase tracking-widest">Verification Result</span>
                            <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${result.is_real ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                {result.is_real ? 'Success' : 'Failed'}
                            </div>
                        </div>
                        
                        <div className={`text-4xl font-black text-center mb-1 ${result.is_real ? 'text-white' : 'text-red-500'}`}>
                            {((result.score || 0) * 100).toFixed(1)}%
                        </div>
                        <p className="text-center text-[10px] text-neutral-500 mb-4 font-medium italic">Confidence Score</p>
                        
                        <div className="space-y-2 text-[11px] text-neutral-400 border-t border-white/5 pt-4 font-mono">
                            <div className="flex justify-between">
                                <span className="opacity-60 uppercase">Motion Sync</span>
                                <span className="text-white font-bold">{(result.details?.motion_consistency ?? 0).toFixed(4)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="opacity-60 uppercase">Liveness</span>
                                <span className="text-white font-bold">{(result.details?.visual_liveness ?? 0).toFixed(4)}</span>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-4">
                        <p className="text-sm text-neutral-400 font-medium animate-pulse">{debugMsg}</p>
                    </div>
                )}
            </div>

            {/* Action Button */}
            <div className="mt-auto mb-8 w-full max-w-[340px]">
                {status === 'ready' || status === 'done' ? (
                    <button 
                        onClick={startScan} 
                        className="group relative w-full overflow-hidden bg-white text-black font-black py-5 rounded-[1.5rem] shadow-[0_20px_40px_-15px_rgba(255,255,255,0.2)] active:scale-95 transition-all"
                    >
                        <span className="relative z-10">{status === 'done' ? 'RE-VERIFY IDENTITY' : 'START AUTHENTICATION'}</span>
                        <div className="absolute inset-0 bg-gradient-to-r from-neutral-200 to-white group-hover:from-white group-hover:to-white transition-all" />
                    </button>
                ) : (
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-12 h-12 border-3 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                        <span className="text-[10px] font-bold text-blue-500 tracking-[0.2em]">PROCESSING...</span>
                    </div>
                )}
            </div>

            {/* CSS Animation (Add this to your globals.css or styled-component) */}
            <style jsx>{`
                @keyframes scan-line {
                    0% { top: 0%; opacity: 0; }
                    50% { opacity: 1; }
                    100% { top: 80%; opacity: 0; }
                }
                .animate-scan-line {
                    animation: scan-line 2s linear infinite;
                }
            `}</style>
        </div>
    );
};

export default FaceScan;
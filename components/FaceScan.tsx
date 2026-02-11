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
        <div className="flex flex-col items-center">
            {/* Camera Feed Container */}
            <div className="relative w-full aspect-[3/4] rounded-[2rem] overflow-hidden bg-slate-900 shadow-inner group">
                <video ref={videoRef} className="hidden" playsInline muted />
                <canvas ref={canvasRef} className="w-full h-full object-cover transform -scale-x-100 opacity-90" />
                
                {/* Overlay Glass Effect */}
                <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/40 pointer-events-none" />

                {/* Face Oval Guide */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className={`w-[70%] h-[70%] border-2 rounded-[50%] transition-all duration-700 ${
                        status === 'scanning' 
                        ? 'border-indigo-400 shadow-[0_0_30px_rgba(129,140,248,0.6)] scale-105' 
                        : 'border-white/30'
                    }`}>
                        {/* Focus Brackets */}
                        <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-indigo-500 rounded-tl-xl" />
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-indigo-500 rounded-br-xl" />
                    </div>
                </div>

                {/* Futuristic Scanning Line */}
                {status === 'scanning' && (
                    <div className="absolute inset-0 pointer-events-none overflow-hidden">
                        <div className="w-full h-[15%] bg-gradient-to-b from-indigo-500/40 to-transparent absolute top-0 animate-scan-line border-b-2 border-indigo-400" />
                    </div>
                )}

                {/* Status Label (Top Right) */}
                <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
                    <div className={`w-2 h-2 rounded-full ${status === 'scanning' ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
                    <span className="text-[10px] font-bold text-white uppercase tracking-tighter">
                        {status === 'scanning' ? 'Live' : 'Ready'}
                    </span>
                </div>

                {/* Progress Micro-Bar (Bottom) */}
                {status === 'scanning' && (
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[60%] h-1 bg-white/20 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-indigo-500 transition-all duration-300 shadow-[0_0_10px_#6366f1]" 
                            style={{ width: `${(frameCount / FRAMES_TO_COLLECT) * 100}%` }} 
                        />
                    </div>
                )}
            </div>

            {/* Messaging Area */}
            <div className="mt-6 w-full text-center min-h-[40px]">
                <p className="text-sm font-bold text-slate-600 uppercase tracking-wide">
                    {status === 'scanning' ? (
                        <span className="flex items-center justify-center gap-2">
                            Hold Still <span className="inline-block w-1 h-1 bg-slate-400 rounded-full animate-bounce" />
                        </span>
                    ) : debugMsg}
                </p>
            </div>

            {/* Trigger Button */}
            <div className="w-full mt-2">
                {status === 'ready' || status === 'done' ? (
                    <button 
                        onClick={startScan} 
                        className="w-full py-5 bg-indigo-600 text-white font-black rounded-2xl shadow-[0_10px_25px_-5px_rgba(79,70,229,0.4)] hover:bg-indigo-700 active:scale-95 transition-all uppercase tracking-widest text-sm"
                    >
                        {status === 'done' ? 'Start Over' : 'Verify Now'}
                    </button>
                ) : (
                    <div className="py-4 flex justify-center">
                        <div className="px-6 py-2 bg-slate-100 rounded-full text-slate-400 text-[10px] font-black tracking-[0.2em] uppercase">
                            Capturing Frames...
                        </div>
                    </div>
                )}
            </div>

            <style jsx>{`
                @keyframes scan-line {
                    0% { transform: translateY(-100%); opacity: 0; }
                    20% { opacity: 1; }
                    80% { opacity: 1; }
                    100% { transform: translateY(600%); opacity: 0; }
                }
                .animate-scan-line {
                    animation: scan-line 2.5s ease-in-out infinite;
                }
            `}</style>
        </div>
    );
};

export default FaceScan;
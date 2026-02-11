import React, { useState, useRef, useEffect, useCallback } from 'react';

const FRAMES_TO_COLLECT = 80; 

// 28 จุด Landmarks
const SELECTED_LANDMARKS_INDICES = [
    1, 4, 33, 61, 133, 159, 263, 291, 362, 386, 
    10, 152, 234, 454, 123, 352, 6, 168, 
    0, 11, 12, 13, 14, 15, 16, 17, 18, 200
];

declare const FaceMesh: any;

interface FaceScanProps {
    onScanComplete: (data: any[], imageBlob: Blob | null) => void;
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
    const [progress, setProgress] = useState(0);

    // Sensors
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
        if (window.DeviceMotionEvent) window.addEventListener('devicemotion', handleMotion);
        if (window.DeviceOrientationEvent) window.addEventListener('deviceorientation', handleOrientation);
        return () => {
            if (window.DeviceMotionEvent) window.removeEventListener('devicemotion', handleMotion);
            if (window.DeviceOrientationEvent) window.removeEventListener('deviceorientation', handleOrientation);
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
        if (canvasRef.current && videoRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.save();
                ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                // วาดแบบปกติ (ไม่กลับด้านใน Canvas เพื่อให้รูปที่ส่งไป Backend ถูกต้อง)
                ctx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);
                ctx.restore();
            }
        }

        if (isScanningRef.current) {
            if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
                const fullLandmarks = results.multiFaceLandmarks[0];
                
                // กรองเหลือ 28 จุด
                const selectedLandmarks = SELECTED_LANDMARKS_INDICES.map(index => {
                    const lm = fullLandmarks[index];
                    return [lm.x, lm.y, lm.z];
                });
                
                const flattenedLandmarks = selectedLandmarks.flat(); // 84 floats

                // จำลองค่า Variance (ถ้า Backend ยังใช้อยู่)
                const safeBgVariance = Math.random() * 5 + 1;

                const frameData = {
                    faceMesh: flattenedLandmarks, 
                    sensors: { ...sensorsRef.current },
                    meta: { t: Date.now(), camera_facing: 'user' },
                    bg_variance: safeBgVariance,
                    motion_analysis: {
                        face_dx: 0, face_dy: 0,
                        bg_dx: 0, bg_dy: 0,
                        relative_magnitude: 0,
                        bg_variance: safeBgVariance
                    }
                };

                recordedDataRef.current.push(frameData);

                const count = recordedDataRef.current.length;
                const percent = Math.min((count / FRAMES_TO_COLLECT) * 100, 100);
                setProgress(percent);

                if (count >= FRAMES_TO_COLLECT) {
                    isScanningRef.current = false;
                    setStatus('processing');
                    finishScanning();
                }
            }
        }
    }, []);

    const finishScanning = async () => {
        try {
            let imageBlob: Blob | null = null;
            if (canvasRef.current) {
                imageBlob = await new Promise<Blob | null>(resolve => 
                    canvasRef.current!.toBlob(blob => resolve(blob), 'image/jpeg', 0.8)
                );
            }
            onScanComplete(recordedDataRef.current, imageBlob);
        } catch (e) {
            console.error("Finish scan error", e);
            setStatus('error');
        }
    };

    const startScan = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 640, height: 480, facingMode: 'user' } 
            });

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.onloadedmetadata = async () => {
                    await videoRef.current!.play();
                    if (canvasRef.current) {
                        canvasRef.current.width = videoRef.current!.videoWidth;
                        canvasRef.current.height = videoRef.current!.videoHeight;
                    }
                    recordedDataRef.current = [];
                    setProgress(0);
                    setStatus('scanning');
                    isScanningRef.current = true;
                    startLoop();
                };
            }
        } catch (e) {
            setStatus('error');
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
                    refineLandmarks: true,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5,
                });
                faceMeshRef.current.onResults(onResults);
                setStatus('ready');
            } catch (e) { 
                console.error(e);
                setStatus('error'); 
            }
        };
        initAI();
        return cleanup;
    }, [onResults, cleanup]);

    return (
        <div className="flex flex-col items-center w-full">
            <div className="relative w-full aspect-[3/4] bg-neutral-900 overflow-hidden rounded-[2.3rem] shadow-inner ring-1 ring-white/10 group">
                <video ref={videoRef} className="hidden" playsInline muted />
                
                {/* Canvas ที่ User เห็นกลับด้าน (Mirror) แต่รูปที่ส่งไป Backend ไม่กลับ */}
                <canvas 
                    ref={canvasRef} 
                    className="w-full h-full object-cover transform scale-x-[-1]" 
                />
                
                <div className="absolute inset-0 pointer-events-none bg-radial-gradient from-transparent via-black/10 to-black/80" />
                <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[55%] w-[65%] h-[55%] rounded-[50%] transition-all duration-700 ease-out pointer-events-none ${
                   status === 'scanning' ? 'border-[3px] border-indigo-500 shadow-[0_0_60px_rgba(99,102,241,0.6)] scale-105' : 'border-2 border-white/20'
                }`}>
                   <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-3 bg-indigo-400/80"></div>
                   <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-1 h-3 bg-indigo-400/80"></div>
                   <div className="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 w-3 h-1 bg-indigo-400/80"></div>
                   <div className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 w-3 h-1 bg-indigo-400/80"></div>
                </div>

                {status === 'scanning' && (
                   <div className="absolute inset-0 z-20 overflow-hidden pointer-events-none">
                     <div className="w-full h-[2px] bg-indigo-400 shadow-[0_0_25px_rgba(99,102,241,1)] absolute animate-scan-line" />
                   </div>
                )}
            </div>

            <div className="absolute bottom-8 left-0 w-full px-8 z-30 flex flex-col items-center">
                {status === 'ready' && (
                  <button onClick={startScan} className="group relative w-20 h-20 rounded-full flex items-center justify-center bg-white/10 border border-white/20 backdrop-blur-md hover:scale-110 transition-all duration-300 cursor-pointer shadow-lg">
                    <div className="absolute inset-0 rounded-full bg-indigo-500 opacity-20 group-hover:opacity-40 animate-ping" />
                    <div className="w-14 h-14 bg-white rounded-full shadow-[0_0_20px_rgba(255,255,255,0.5)] flex items-center justify-center">
                       <div className="w-5 h-5 bg-indigo-600 rounded-sm" />
                    </div>
                  </button>
                )}
                
                {status === 'scanning' && (
                   <div className="w-full max-w-[200px] space-y-2">
                       <div className="h-2 bg-gray-800 rounded-full overflow-hidden border border-white/10">
                          <div className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 transition-all duration-100 ease-linear shadow-[0_0_10px_rgba(99,102,241,0.8)]" style={{ width: `${progress}%` }} />
                       </div>
                       <p className="text-center text-[10px] text-indigo-300 font-bold tracking-widest uppercase animate-pulse">Scanning...</p>
                   </div>
                )}
            </div>
            
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

export default FaceScan;
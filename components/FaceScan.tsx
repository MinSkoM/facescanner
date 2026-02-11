import React, { useState, useRef, useEffect, useCallback } from 'react';

const FRAMES_TO_COLLECT = 80;
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
        <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-white p-6">
            <h1 className="text-2xl font-bold mb-6 tracking-tight">Gsync Liveness</h1>

            <div className="relative w-full max-w-[340px] aspect-[3/4] rounded-[2rem] overflow-hidden border-4 border-neutral-800 shadow-2xl bg-black">
                <video ref={videoRef} className="hidden" playsInline muted />
                <canvas ref={canvasRef} className="w-full h-full object-cover transform -scale-x-100" />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-[70%] h-[65%] border-2 border-dashed border-white/30 rounded-[50%]" />
                </div>
                {status === 'scanning' && (
                    <div className="absolute bottom-0 left-0 w-full h-2 bg-neutral-800">
                        <div className="h-full bg-green-500 transition-all duration-100" style={{ width: `${(frameCount / FRAMES_TO_COLLECT) * 100}%` }} />
                    </div>
                )}
            </div>

            <div className="mt-8 w-full max-w-[340px]">
                {result ? (
                    <div className="bg-neutral-900 p-5 rounded-2xl border border-neutral-800">
                        <div className={`text-xl font-bold text-center ${result.is_real ? 'text-green-400' : 'text-red-400'}`}>
                            {result.is_real ? '✅ ตัวตนจริง' : '❌ ตรวจพบการปลอมแปลง'}
                        </div>
                        <div className="text-4xl font-black text-center my-3">
                            {((result.score || 0) * 100).toFixed(1)}%
                        </div>
                        <div className="space-y-1 text-xs text-neutral-400 border-t border-neutral-800 pt-3">
                            <div className="flex justify-between">
                                <span>Motion Consistency:</span>
                                <span className="text-neutral-200">{(result.details?.motion_consistency ?? result.details?.head_1 ?? 0).toFixed(4)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Visual Liveness:</span>
                                <span className="text-neutral-200">{(result.details?.visual_liveness ?? result.details?.head_2 ?? 0).toFixed(4)}</span>
                            </div>
                        </div>
                    </div>
                ) : (
                    <p className="text-center text-neutral-400 font-medium">{debugMsg}</p>
                )}
            </div>

            <div className="mt-auto mb-10 w-full max-w-[340px]">
                {status === 'ready' || status === 'done' ? (
                    <button onClick={startScan} className="w-full bg-white text-black font-bold py-5 rounded-2xl shadow-xl active:scale-95 transition-transform">
                        {status === 'done' ? 'สแกนอีกครั้ง' : 'เริ่มสแกน'}
                    </button>
                ) : (
                    <div className="flex justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FaceScan;
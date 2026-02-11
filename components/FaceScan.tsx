import React, { useState, useRef, useEffect, useCallback } from 'react';

const FRAMES_TO_COLLECT = 80;

declare const FaceMesh: any;

interface FaceScanProps {
    onScanComplete: (data: object) => void;
}

const FaceScan: React.FC<FaceScanProps> = ({ onScanComplete }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const faceMeshRef = useRef<any>(null);
    const recordedDataRef = useRef<any[]>([]);
    const animationFrameId = useRef<number>();
    
    // Logic: ใช้ Ref คุมสถานะ (ห้ามเอาออก อันนี้คือตัวแก้บั๊ก)
    const isScanningRef = useRef(false);

    const [status, setStatus] = useState<string>('initializing');
    const [frameCount, setFrameCount] = useState(0);
    const [debugMsg, setDebugMsg] = useState<string>("Initializing...");

    const cleanup = useCallback(() => {
        isScanningRef.current = false;
        if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
        }
    }, []);

    useEffect(() => {
        const initAI = async () => {
            if (typeof FaceMesh === 'undefined') {
                setStatus('error');
                return;
            }
            try {
                faceMeshRef.current = new FaceMesh({
                    locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
                });

                await faceMeshRef.current.setOptions({
                    maxNumFaces: 1,
                    refineLandmarks: false,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5,
                });

                faceMeshRef.current.onResults(onResults);
                setStatus('ready');
                setDebugMsg("Ready. Click Start.");
            } catch (e: any) {
                setStatus('error');
            }
        };
        initAI();
        return cleanup;
    }, [cleanup]);

    const onResults = useCallback((results: any) => {
        // วาดรูป (ปรับให้เต็ม Canvas ไม่บีบ)
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                const w = canvasRef.current.width;
                const h = canvasRef.current.height;
                ctx.save();
                ctx.clearRect(0, 0, w, h);
                // วาดเต็มพื้นที่
                ctx.drawImage(results.image, 0, 0, w, h);
                ctx.restore();
            }
        }

        // Logic การบันทึก
        if (isScanningRef.current) {
            if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
                const landmarks = results.multiFaceLandmarks[0];
                recordedDataRef.current.push({
                    faceMesh: landmarks.map((lm: any) => [lm.x, lm.y, lm.z]).flat(),
                    meta: { t: Date.now() }
                });

                const count = recordedDataRef.current.length;
                setFrameCount(count);

                if (count >= FRAMES_TO_COLLECT) {
                    isScanningRef.current = false;
                    setStatus('processing');
                    setDebugMsg("Scan Complete! Uploading...");
                    onScanComplete({ data: recordedDataRef.current });
                }
            } else {
                setDebugMsg("Scanning... Face NOT detected!"); 
            }
        }
    }, [onScanComplete]);

    const startScan = async () => {
        try {
            // ขอความละเอียด 4:3 (320x240)
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 320, height: 240, facingMode: 'user' } 
            });

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                
                videoRef.current.onloadedmetadata = async () => {
                    await videoRef.current!.play();
                    
                    // ตั้งค่า Canvas ให้เท่ากับ Video เป๊ะๆ (จะได้รับไม่เบี้ยว)
                    if (canvasRef.current) {
                        canvasRef.current.width = videoRef.current!.videoWidth;
                        canvasRef.current.height = videoRef.current!.videoHeight;
                    }

                    setStatus('scanning');
                    setDebugMsg("Keep face still...");
                    recordedDataRef.current = [];
                    setFrameCount(0);
                    isScanningRef.current = true;
                    
                    startLoop();
                };
            }
        } catch (e) {
            setStatus('permission_required');
        }
    };

    const startLoop = () => {
        const loop = async () => {
            if (!isScanningRef.current && status !== 'scanning') return; 

            if (videoRef.current && faceMeshRef.current && !videoRef.current.paused) {
                try {
                    await faceMeshRef.current.send({ image: videoRef.current });
                } catch(e) {}
            }
            animationFrameId.current = requestAnimationFrame(loop);
        };
        loop();
    };

    return (
        <div className="flex flex-col items-center w-full max-w-md mx-auto p-4">
            {/* Container นี้กำหนด aspect-ratio เป็น 4/3 เพื่อให้ตรงกับกล้อง 
                และใช้ max-width เพื่อไม่ให้ใหญ่เกินไป
            */}
            <div className="relative w-full max-w-[400px] aspect-[4/3] bg-black rounded-lg overflow-hidden shadow-2xl border-4 border-gray-800">
                
                {/* Video ซ่อนไว้ (opacity-0) แต่ต้องมีขนาดเต็มพื้นที่ */}
                <video 
                    ref={videoRef} 
                    className="absolute inset-0 w-full h-full object-cover opacity-0" 
                    playsInline 
                    muted 
                />
                
                {/* Canvas โชว์ภาพจริง กลับด้านแนวนอนเพื่อให้เหมือนกระจก */}
                <canvas 
                    ref={canvasRef} 
                    className="absolute inset-0 w-full h-full object-cover transform -scale-x-100" 
                />

                {/* UI Overlay */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    {status === 'ready' && (
                        <button 
                            onClick={startScan} 
                            className="pointer-events-auto bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-8 rounded-full shadow-lg transition transform hover:scale-105"
                        >
                            START SCAN
                        </button>
                    )}
                    
                    {status === 'scanning' && (
                        <div className="absolute top-4 right-4 bg-red-600/90 backdrop-blur text-white px-4 py-1 rounded-full text-sm font-bold shadow animate-pulse">
                            REC {frameCount}/{FRAMES_TO_COLLECT}
                        </div>
                    )}

                    {status === 'processing' && (
                         <div className="bg-black/60 backdrop-blur absolute inset-0 flex flex-col items-center justify-center text-white">
                             <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white mb-2"></div>
                             Processing...
                         </div>
                    )}
                </div>
            </div>
            
            <div className="mt-4 text-center">
                <p className={`text-sm font-semibold ${status === 'error' ? 'text-red-500' : 'text-gray-600'}`}>
                    {debugMsg}
                </p>
                {status === 'error' && (
                     <p className="text-xs text-red-400 mt-1">Please check backend logs.</p>
                )}
            </div>
        </div>
    );
};

export default FaceScan;
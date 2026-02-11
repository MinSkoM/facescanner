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
    
    // ⭐ แก้ไข 1: ใช้ Ref เพื่อบอกสถานะ (AI จะได้อ่านค่าล่าสุดเสมอ)
    const isScanningRef = useRef(false);

    const [status, setStatus] = useState<string>('initializing');
    const [frameCount, setFrameCount] = useState(0);
    const [debugMsg, setDebugMsg] = useState<string>("Initializing...");

    const cleanup = useCallback(() => {
        isScanningRef.current = false; // สั่งหยุดทันที
        if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
        }
    }, []);

    // 1. Setup FaceMesh
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

    // 2. Callback (หัวใจสำคัญ)
    const onResults = useCallback((results: any) => {
        // วาดรูป
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.save();
                ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                ctx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);
                ctx.restore();
            }
        }

        // ⭐ แก้ไข 2: เช็คจาก Ref โดยตรง (ไม่อิง State แล้ว)
        if (isScanningRef.current) {
            if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
                const landmarks = results.multiFaceLandmarks[0];
                
                // บันทึกข้อมูล
                recordedDataRef.current.push({
                    faceMesh: landmarks.map((lm: any) => [lm.x, lm.y, lm.z]).flat(),
                    meta: { t: Date.now() } // ตัด Sensor ออกชั่วคราวเพื่อเทสระบบ
                });

                const count = recordedDataRef.current.length;
                setFrameCount(count); // อัปเดต UI

                // ถ้าครบแล้ว
                if (count >= FRAMES_TO_COLLECT) {
                    isScanningRef.current = false; // หยุดบันทึก
                    setStatus('processing');
                    setDebugMsg("Scan Complete! Processing...");
                    onScanComplete({ data: recordedDataRef.current });
                }
            } else {
                setDebugMsg("Scanning... Face NOT detected!"); 
            }
        }
    }, [onScanComplete]); // เอา status ออกจาก dependency array

    // 3. Start Function
    const startScan = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 320, height: 240, facingMode: 'user' } 
            });

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                
                videoRef.current.onloadedmetadata = async () => {
                    await videoRef.current!.play();
                    
                    if (canvasRef.current) {
                        canvasRef.current.width = videoRef.current!.videoWidth;
                        canvasRef.current.height = videoRef.current!.videoHeight;
                    }

                    // ⭐ เริ่มระบบ
                    setStatus('scanning');
                    setDebugMsg("Scanning... Keep face in frame.");
                    recordedDataRef.current = [];
                    setFrameCount(0);
                    isScanningRef.current = true; // เปิดสวิตช์ Ref
                    
                    startLoop();
                };
            }
        } catch (e) {
            setStatus('permission_required');
        }
    };

    const startLoop = () => {
        const loop = async () => {
            // เช็คว่าต้องทำต่อไหมจาก Ref
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
            <div className="relative border-4 border-gray-300 rounded-lg overflow-hidden w-[320px] h-[240px] bg-black shadow-xl">
                <video ref={videoRef} className="absolute inset-0 opacity-0" playsInline muted />
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full transform -scale-x-100" />

                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    {status === 'ready' && (
                        <button 
                            onClick={startScan} 
                            className="pointer-events-auto bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-full shadow-lg text-xl animate-bounce"
                        >
                            START
                        </button>
                    )}
                    
                    {status === 'scanning' && (
                        <div className="absolute top-2 right-2 bg-red-600 text-white px-3 py-1 rounded-full text-sm font-bold animate-pulse">
                            REC ● {frameCount}/{FRAMES_TO_COLLECT}
                        </div>
                    )}
                </div>
            </div>
            
            <div className="mt-4 p-3 bg-gray-100 rounded-lg w-full text-center border border-gray-300">
                <p className={`font-bold ${status === 'scanning' && frameCount === 0 ? 'text-red-500' : 'text-gray-700'}`}>
                    {debugMsg}
                </p>
            </div>
        </div>
    );
};

export default FaceScan;
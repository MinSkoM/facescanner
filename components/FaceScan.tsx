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

    const [status, setStatus] = useState<string>('initializing');
    const [frameCount, setFrameCount] = useState(0);
    // เพิ่มตัวแปร Debug บนหน้าจอ
    const [logs, setLogs] = useState<string[]>([]);

    const addLog = (msg: string) => {
        console.log(msg); // ลง Console ด้วย
        setLogs(prev => [msg, ...prev].slice(0, 5)); // โชว์แค่ 5 บรรทัดล่าสุดบนจอ
    };

    const cleanup = useCallback(() => {
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
                addLog("❌ Error: FaceMesh script is missing!");
                setStatus('error');
                return;
            }

            try {
                addLog("1. Initializing FaceMesh...");
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
                addLog("✅ 2. FaceMesh Ready.");
                setStatus('ready');
            } catch (e: any) {
                addLog(`❌ Error Init: ${e.message}`);
            }
        };
        initAI();
        return cleanup;
    }, [cleanup]);

    // 2. Callback เมื่อ AI เจอหน้า (จุดสำคัญที่ต้องเช็ค)
    const onResults = useCallback((results: any) => {
        // วาด Canvas
        if (canvasRef.current && canvasRef.current.getContext('2d')) {
            const ctx = canvasRef.current.getContext('2d')!;
            ctx.save();
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            ctx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);
            ctx.restore();
        }

        // เช็คผลลัพธ์
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            // เจอหน้า!
            if (status === 'scanning') {
                const landmarks = results.multiFaceLandmarks[0];
                recordedDataRef.current.push({
                    faceMesh: landmarks.map((lm: any) => [lm.x, lm.y, lm.z]).flat(),
                    meta: { t: Date.now() }
                });
                
                const count = recordedDataRef.current.length;
                setFrameCount(count);

                if (count % 10 === 0) addLog(`✅ Saving... (${count}/${FRAMES_TO_COLLECT})`);

                if (count >= FRAMES_TO_COLLECT) {
                    addLog("🎉 Complete! Sending data...");
                    setStatus('processing');
                    onScanComplete({ data: recordedDataRef.current });
                }
            }
        } else {
            // AI ทำงาน แต่หาหน้าไม่เจอ
            if (Math.random() > 0.95) addLog("⚠️ AI Running but NO FACE detected."); 
        }
    }, [status, onScanComplete]);

    // 3. เริ่มกล้องและลูป
    const startScan = async () => {
        try {
            addLog("3. Requesting Camera...");
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 320, height: 240, facingMode: 'user' } 
            });

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                // ต้องรอให้ Video เล่นจริงก่อนส่งให้ AI
                videoRef.current.onloadedmetadata = async () => {
                    addLog("4. Video Metadata loaded. Playing...");
                    await videoRef.current!.play();
                    
                    if (canvasRef.current) {
                        canvasRef.current.width = videoRef.current!.videoWidth;
                        canvasRef.current.height = videoRef.current!.videoHeight;
                    }

                    setStatus('scanning');
                    recordedDataRef.current = [];
                    setFrameCount(0);
                    
                    addLog("🚀 5. Starting AI Loop...");
                    sendToAI(); 
                };
            }
        } catch (e: any) {
            addLog(`❌ Camera Error: ${e.message}`);
            setStatus('permission_required');
        }
    };

    const sendToAI = async () => {
        if (
            videoRef.current && 
            faceMeshRef.current && 
            !videoRef.current.paused && 
            !videoRef.current.ended
        ) {
            try {
                await faceMeshRef.current.send({ image: videoRef.current });
            } catch (e) {
                console.error(e);
            }
        }
        // เรียกตัวเองซ้ำ (Loop)
        animationFrameId.current = requestAnimationFrame(sendToAI);
    };

    return (
        <div className="flex flex-col items-center w-full max-w-md mx-auto p-4">
            {/* พื้นที่แสดงผล Debug Log */}
            <div className="w-full bg-gray-900 text-green-400 font-mono text-xs p-2 mb-2 rounded h-24 overflow-y-auto">
                {logs.map((log, i) => <div key={i}>{log}</div>)}
            </div>

            <div className="relative border-4 border-gray-300 rounded-lg overflow-hidden w-[320px] h-[240px] bg-black">
                {/* Video จริง (ซ่อนไว้ข้างหลังแต่ต้องเล่น) */}
                <video 
                    ref={videoRef} 
                    className="absolute inset-0 object-cover opacity-0" 
                    playsInline 
                    muted 
                />
                
                {/* Canvas ที่วาดผลลัพธ์ */}
                <canvas 
                    ref={canvasRef} 
                    className="absolute inset-0 w-full h-full object-cover transform -scale-x-100" 
                />

                {/* Overlay สถานะ */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    {status !== 'scanning' && status !== 'processing' && (
                        <button 
                            onClick={startScan} 
                            className="pointer-events-auto bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-full shadow-lg"
                        >
                            START SCAN
                        </button>
                    )}
                    
                    <div className="absolute bottom-2 right-2 bg-black/50 text-white px-2 rounded">
                        Frames: {frameCount}
                    </div>
                </div>
            </div>
            
            <p className="mt-2 text-sm text-gray-500">
                Status: <span className="font-bold text-blue-600">{status}</span>
            </p>
        </div>
    );
};

export default FaceScan;
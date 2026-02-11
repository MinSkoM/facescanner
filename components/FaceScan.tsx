import React, { useState, useRef, useEffect, useCallback } from 'react';

// --- CONFIGURATION ---
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
    const [debugMsg, setDebugMsg] = useState<string>("Waiting...");

    const cleanup = useCallback(() => {
        if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
        }
    }, []);

    // 1. Initialize FaceMesh
    useEffect(() => {
        const initFaceMesh = async () => {
            if (typeof FaceMesh === 'undefined') {
                setDebugMsg("❌ Error: FaceMesh script not found! Check index.html");
                setStatus('error');
                return;
            }

            try {
                setDebugMsg("Loading Model...");
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
                setDebugMsg("Model Loaded. Waiting for camera...");
                setStatus('ready');
            } catch (e: any) {
                setDebugMsg(`❌ Model Error: ${e.message}`);
                setStatus('error');
            }
        };
        initFaceMesh();
        return cleanup;
    }, [cleanup]);

    // 2. Handle Results (ถ้าฟังก์ชันนี้ทำงาน เลขต้องขยับ)
    const onResults = useCallback((results: any) => {
        // วาดภาพลง Canvas
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.save();
                ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                ctx.translate(canvasRef.current.width, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);
                ctx.restore();
            }
        }

        // เช็คว่าเจอหน้าไหม
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            if (status === 'scanning') {
                const landmarks = results.multiFaceLandmarks[0];
                
                // เก็บข้อมูล
                recordedDataRef.current.push({
                    faceMesh: landmarks.map((lm: any) => [lm.x, lm.y, lm.z]).flat(),
                    meta: { timestamp: Date.now() }
                });

                const count = recordedDataRef.current.length;
                setFrameCount(count); // อัปเดตตัวเลขหน้าจอ
                
                if (count >= FRAMES_TO_COLLECT) {
                    setStatus('processing');
                    onScanComplete({ data: recordedDataRef.current });
                }
            }
        } else {
             // ถ้า AI ทำงานแต่หาหน้าไม่เจอ จะเข้าตรงนี้
             if(status === 'scanning') setDebugMsg("AI Running... Face NOT detected");
        }
    }, [status, onScanComplete]);

    // 3. Start Camera & Loop
    const startScan = async () => {
        try {
            setDebugMsg("Opening Camera...");
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 320, height: 240, facingMode: 'user' } 
            });
            
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                
                // บังคับเล่นวิดีโอ
                videoRef.current.onloadedmetadata = async () => {
                    await videoRef.current!.play();
                    setDebugMsg("Camera Playing. Starting Loop...");
                    
                    // ตั้งค่า Canvas ให้เท่ากับ Video
                    if (canvasRef.current) {
                        canvasRef.current.width = videoRef.current!.videoWidth;
                        canvasRef.current.height = videoRef.current!.videoHeight;
                    }

                    setStatus('scanning');
                    recordedDataRef.current = [];
                    setFrameCount(0);
                    
                    startLoop(); // เริ่มส่งภาพเข้า AI
                };
            }
        } catch (err: any) {
            setDebugMsg(`❌ Camera Error: ${err.message}`);
            setStatus('permission_required');
        }
    };

    const startLoop = () => {
        const loop = async () => {
            if (
                videoRef.current && 
                faceMeshRef.current && 
                videoRef.current.readyState >= 2 && 
                !videoRef.current.paused
            ) {
                try {
                    await faceMeshRef.current.send({ image: videoRef.current });
                } catch (e) {
                    console.error(e);
                }
            }
            animationFrameId.current = requestAnimationFrame(loop);
        };
        loop();
    };

    return (
        <div className="flex flex-col items-center p-4">
            <h2 className="text-xl font-bold mb-2">Debug Mode</h2>
            
            {/* แสดง Video ตัวจริง (ปกติจะซ่อน) เพื่อเช็คว่ากล้องติดไหม */}
            <div className="relative border-4 border-blue-500 w-[320px] h-[240px]">
                <video 
                    ref={videoRef} 
                    className="absolute inset-0 w-full h-full object-cover opacity-50" // ทำให้จางๆ จะได้เห็น Canvas ซ้อน
                    playsInline 
                    muted 
                />
                <canvas 
                    ref={canvasRef} 
                    className="absolute inset-0 w-full h-full object-cover" 
                />
            </div>

            <div className="mt-4 p-4 bg-gray-100 rounded w-full max-w-md text-center">
                <p className="font-bold text-lg">Status: {status}</p>
                <p className="text-red-600 font-mono text-sm my-2">{debugMsg}</p>
                <p className="text-3xl font-bold text-blue-600 my-2">{frameCount} / {FRAMES_TO_COLLECT}</p>
                
                {status === 'ready' || status === 'error' ? (
                    <button 
                        onClick={startScan} 
                        className="bg-blue-600 text-white px-6 py-2 rounded shadow hover:bg-blue-700"
                    >
                        Start Scan
                    </button>
                ) : null}
            </div>
            
            <div className="mt-4 text-xs text-left text-gray-500 w-full max-w-md">
                <p><strong>วิธีแก้ปัญหา:</strong></p>
                <ul className="list-disc ml-4">
                    <li>ถ้า Video ไม่ขึ้นภาพเลย = กล้องเสีย/ไม่ได้รับอนุญาต</li>
                    <li>ถ้าขึ้น Error "FaceMesh script not found" = ต้องแก้ index.html</li>
                    <li>ถ้า Video ขยับแต่เลข Frame ไม่เดิน = แสงน้อย หรือ AI หาหน้าไม่เจอ</li>
                </ul>
            </div>
        </div>
    );
};

export default FaceScan;
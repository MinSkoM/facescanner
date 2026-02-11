import React, { useState, useRef, useEffect, useCallback } from 'react';

// --- CONFIGURATION ---
const SCAN_DURATION_TIMEOUT = 5000;
const FRAMES_TO_COLLECT = 80;
const MIN_FRAMES_REQUIRED = 5; 

declare const FaceMesh: any;
// declare const drawConnectors: any; // ปิดการเรียกใช้ตัววาดเส้น
// declare const FACEMESH_TESSELATION: any;

interface FaceScanProps {
    onScanComplete: (data: object) => void;
}

type ScanStatus = 'idle' | 'initializing' | 'permission_required' | 'ready' | 'scanning' | 'processing' | 'error' | 'timeout';

const StatusMessages: Record<ScanStatus, string> = {
    idle: 'พร้อมเริ่มสแกน',
    initializing: 'กำลังโหลดโมเดล (Performance Mode)...',
    permission_required: 'กรุณาอนุญาตให้ใช้กล้อง',
    ready: 'พร้อมแล้ว! กรุณาอยู่ในที่สว่าง',
    scanning: 'กำลังสแกน... ขยับหน้าช้าๆ',
    processing: 'กำลังประมวลผล...',
    error: 'ตรวจจับหน้าไม่เจอ หรือแสงน้อยเกินไป',
    timeout: 'หมดเวลา! กำลังส่งข้อมูลเท่าที่มี...',
};

const FaceScan: React.FC<FaceScanProps> = ({ onScanComplete }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const faceMeshRef = useRef<any>(null);
    const recordedDataRef = useRef<any[]>([]);
    const latestSensorDataRef = useRef<{ accel: any, gyro: any }>({ accel: {x:0,y:0,z:0}, gyro: {x:0,y:0,z:0} });
    const animationFrameId = useRef<number>();
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    const [status, setStatus] = useState<ScanStatus>('initializing');
    const [progress, setProgress] = useState(0);
    const [frameCount, setFrameCount] = useState(0);

    const cleanup = useCallback(() => {
        if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }
    }, []);

    useEffect(() => {
        const initFaceMesh = async () => {
            try {
                if (typeof FaceMesh === 'undefined') {
                    console.error("FaceMesh script not loaded");
                    setStatus('error');
                    return;
                }

                faceMeshRef.current = new FaceMesh({
                    locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
                });

                await faceMeshRef.current.setOptions({
                    maxNumFaces: 1,
                    refineLandmarks: false, // ปิดอันนี้! ช่วยให้ลื่นขึ้นมาก
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5,
                });

                faceMeshRef.current.onResults(onFaceMeshResults);
                setStatus('ready');
            } catch (e) {
                console.error("Failed to initialize FaceMesh", e);
                setStatus('error');
            }
        };
        initFaceMesh();
        return cleanup;
    }, [cleanup]);

    const finishScan = useCallback(() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);

        const dataCount = recordedDataRef.current.length;
        
        if (dataCount >= MIN_FRAMES_REQUIRED) {
            setStatus('processing');
            const finalData = {
                data: recordedDataRef.current,
                meta: {
                    userAgent: navigator.userAgent,
                    timestamp: Date.now(),
                    camera_facing: 'user'
                }
            };
            onScanComplete(finalData); 
        } else {
            setStatus('error');
            alert(`Low Performance: Collected ${dataCount} frames. Please use better lighting.`);
            setTimeout(() => setStatus('ready'), 2000);
        }
        cleanup();
    }, [onScanComplete, cleanup]);

    const onFaceMeshResults = useCallback((results: any) => {
        if (!canvasRef.current || !videoRef.current) return;
        
        // เราจะไม่วาด Canvas บ่อยๆ เพื่อประหยัดแรงเครื่อง (วาดเฉพาะตอนจำเป็น)
        // หรือวาดแค่ภาพกล้อง ไม่วาดเส้น
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            ctx.save();
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            ctx.translate(canvasRef.current.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);
            
            // --- ปิดส่วนนี้เพื่อลดภาระเครื่อง ---
            // if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            //      drawConnectors(ctx, results.multiFaceLandmarks[0], FACEMESH_TESSELATION, { color: '#C0C0C070', lineWidth: 1 });
            // }
            // --------------------------------
            
            ctx.restore();
        }

        // Logic การเก็บข้อมูล (ส่วนนี้สำคัญ ห้ามตัด)
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];

            if (status === 'scanning' || status === 'timeout') {
                const frameData = {
                    faceMesh: landmarks.map((lm: any) => [lm.x, lm.y, lm.z]).flat(),
                    sensors: { ...latestSensorDataRef.current },
                    bg_variance: 0.0,
                    meta: { camera_facing: 'user' },
                };
                
                recordedDataRef.current.push(frameData);
                const count = recordedDataRef.current.length;
                
                // อัปเดต UI (ระวัง re-render)
                if (count % 2 === 0) setFrameCount(count); // อัปเดตทุก 2 เฟรมพอ
                
                const currentProgress = Math.min(count / FRAMES_TO_COLLECT, 1.0);
                setProgress(currentProgress);

                if (count >= FRAMES_TO_COLLECT) {
                    finishScan();
                }
            }
        }
    }, [status, finishScan]);

    const startSensors = async () => {
         // ... (Sensor code เหมือนเดิม)
         const initSensor = (SensorClass: any, key: 'accel' | 'gyro') => {
            try {
                const sensor = new SensorClass({ frequency: 30 }); // ลดความถี่ Sensor ลงเหลือ 30Hz ก็พอ
                sensor.addEventListener('reading', () => {
                    if (sensor.x != null) latestSensorDataRef.current[key] = { x: sensor.x, y: sensor.y, z: sensor.z };
                });
                sensor.start();
            } catch (e) { }
        };

        if ('Accelerometer' in window) initSensor((window as any).Accelerometer, 'accel');
        if ('Gyroscope' in window) initSensor((window as any).Gyroscope, 'gyro');
    };
    
    const startScan = async () => {
        try {
            // 1. ลดความละเอียดกล้องลงเหลือ 320x240 (QVGA)
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    width: { ideal: 320 }, 
                    height: { ideal: 240 }, 
                    facingMode: 'user',
                    frameRate: { ideal: 30, max: 30 }
                } 
            });
            
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await new Promise((resolve) => {
                    if (videoRef.current) videoRef.current.onloadedmetadata = () => videoRef.current!.play().then(resolve);
                });

                if(canvasRef.current) {
                    canvasRef.current.width = videoRef.current.videoWidth;
                    canvasRef.current.height = videoRef.current.videoHeight;
                }
            }

            recordedDataRef.current = [];
            setFrameCount(0);
            setProgress(0);
            setStatus('scanning');
            startSensors();

            const renderLoop = async () => {
                // เช็คว่า video พร้อมจริงๆ ค่อยส่ง
                if (videoRef.current && faceMeshRef.current && videoRef.current.readyState >= 2 && !videoRef.current.paused) {
                    await faceMeshRef.current.send({ image: videoRef.current });
                }
                animationFrameId.current = requestAnimationFrame(renderLoop);
            };
            renderLoop();

            timeoutRef.current = setTimeout(() => {
                setStatus('timeout'); 
                finishScan();
            }, SCAN_DURATION_TIMEOUT);

        } catch (err) {
            console.error("Camera error:", err);
            setStatus('permission_required');
        }
    };

    return (
        <div className="flex flex-col items-center justify-center w-full">
            <div className="relative w-full max-w-md mx-auto aspect-square rounded-full overflow-hidden border-4 border-gray-200 shadow-2xl bg-black">
                <video ref={videoRef} className="absolute w-full h-full object-cover hidden" playsInline muted />
                <canvas ref={canvasRef} className="w-full h-full object-cover transform -scale-x-100" />
                
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    {(status === 'ready' || status === 'idle' || status === 'error') && (
                        <div className="bg-black/40 w-full h-full flex flex-col items-center justify-center backdrop-blur-sm pointer-events-auto">
                            <p className="text-white font-semibold text-lg drop-shadow-md mb-6 px-4 text-center">{StatusMessages[status]}</p>
                            <button onClick={startScan} className="bg-blue-600 hover:bg-blue-500 text-white text-lg font-bold py-3 px-8 rounded-full shadow-lg transition hover:scale-105">
                                Start Scan (Fast)
                            </button>
                        </div>
                    )}

                    {(status === 'scanning' || status === 'timeout') && (
                         <div className="relative w-full h-full flex items-center justify-center">
                             {/* เอา SVG หมุนๆ ออกชั่วคราว ถ้ามันกินแรง */}
                             <div className="absolute bottom-10 left-0 right-0 text-center">
                                 <span className="inline-block bg-black/60 text-white text-sm px-3 py-1 rounded-full backdrop-blur-md">
                                     Frames: {frameCount} / {FRAMES_TO_COLLECT}
                                 </span>
                             </div>
                         </div>
                    )}
                    
                    {(status === 'initializing' || status === 'processing') && (
                        <div className="bg-black/60 w-full h-full flex flex-col items-center justify-center backdrop-blur-sm">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4"></div>
                            <p className="text-white font-medium">{StatusMessages[status]}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FaceScan;
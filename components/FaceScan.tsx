import React, { useState, useRef, useEffect, useCallback } from 'react';

// --- CONFIGURATION ---
const SCAN_DURATION_TIMEOUT = 10000; // ตัดจบที่ 10 วินาที ถ้ายังสแกนไม่ครบ
const FRAMES_TO_COLLECT = 80;        // เป้าหมายคือเก็บ 80 เฟรม
const MIN_FRAMES_REQUIRED = 15;      // แต่อย่างน้อยต้องมี 15 เฟรมถึงจะยอมให้ผ่าน

// ประกาศตัวแปร Global ของ MediaPipe
declare const FaceMesh: any;
declare const drawConnectors: any;
declare const FACEMESH_TESSELATION: any;

interface FaceScanProps {
    onScanComplete: (data: object) => void;
}

type ScanStatus = 'idle' | 'initializing' | 'permission_required' | 'ready' | 'scanning' | 'processing' | 'error' | 'timeout';

const StatusMessages: Record<ScanStatus, string> = {
    idle: 'พร้อมเริ่มสแกน',
    initializing: 'กำลังโหลดโมเดล...',
    permission_required: 'กรุณาอนุญาตให้ใช้กล้อง',
    ready: 'พร้อมแล้ว! กรุณาอยู่ในที่สว่าง',
    scanning: 'กำลังสแกน... หมุนศีรษะเป็นวงกลมช้าๆ',
    processing: 'กำลังประมวลผล...',
    error: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง',
    timeout: 'หมดเวลา! กำลังส่งข้อมูลเท่าที่มี...',
};

const FaceScan: React.FC<FaceScanProps> = ({ onScanComplete }) => {
    // --- Refs ---
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const faceMeshRef = useRef<any>(null);
    const recordedDataRef = useRef<any[]>([]);
    const latestSensorDataRef = useRef<{ accel: any, gyro: any }>({ accel: {x:0,y:0,z:0}, gyro: {x:0,y:0,z:0} });
    const animationFrameId = useRef<number>();
    const timeoutRef = useRef<NodeJS.Timeout | null>(null); // ตัวเก็บ Timer

    // --- State ---
    const [status, setStatus] = useState<ScanStatus>('initializing');
    const [progress, setProgress] = useState(0);

    // --- Cleanup Function ---
    const cleanup = useCallback(() => {
        if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }
    }, []);

    // --- Initialize FaceMesh ---
    useEffect(() => {
        const initFaceMesh = async () => {
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

    // --- Logic: จบการทำงาน (Finish Scan) ---
    // ฟังก์ชันนี้จะถูกเรียกเมื่อครบ 80 เฟรม หรือ หมดเวลา
    const finishScan = useCallback(() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);

        const dataCount = recordedDataRef.current.length;
        console.log(`Scan finished. Collected ${dataCount} frames.`);

        // ตรวจสอบว่าข้อมูลพอไหม
        if (dataCount >= MIN_FRAMES_REQUIRED) {
            setStatus('processing');
            
            // เตรียมข้อมูลส่งกลับ
            const finalData = {
                data: recordedDataRef.current,
                meta: {
                    userAgent: navigator.userAgent,
                    timestamp: Date.now(),
                    camera_facing: 'user'
                }
            };
            
            // เรียก Callback ส่งข้อมูลให้ App.tsx
            onScanComplete(finalData); 
        } else {
            setStatus('error');
            alert("Face not detected clearly or lighting is too low. Please try again.");
            // รีเซ็ตเพื่อเริ่มใหม่
            setTimeout(() => setStatus('ready'), 2000);
        }
        
        cleanup(); // ปิดกล้อง
    }, [onScanComplete, cleanup]);


    // --- Logic: รับค่าจาก FaceMesh (รันต่อเนื่องทุกเฟรม) ---
    const onFaceMeshResults = useCallback((results: any) => {
        if (!canvasRef.current || !videoRef.current) return;
        
        // วาดภาพลง Canvas
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        ctx.save();
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        
        // พลิกภาพแนวนอนเพื่อให้เหมือนกระจก
        ctx.translate(canvasRef.current.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);
        
        // วาดเส้น Mesh บนหน้า
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];
            drawConnectors(ctx, landmarks, FACEMESH_TESSELATION, { color: '#C0C0C070', lineWidth: 1 });

            // ถ้าสถานะกำลังสแกน ให้เก็บข้อมูล
            if (status === 'scanning' || status === 'timeout') { // timeout ก็ยอมให้เก็บเฟรมสุดท้ายได้
                const frameData = {
                    faceMesh: landmarks.map((lm: any) => [lm.x, lm.y, lm.z]).flat(),
                    sensors: { ...latestSensorDataRef.current },
                    bg_variance: 0.0, // Placeholder
                    meta: { camera_facing: 'user' },
                };
                
                recordedDataRef.current.push(frameData);
                
                // คำนวณ Progress Bar
                const currentProgress = Math.min(recordedDataRef.current.length / FRAMES_TO_COLLECT, 1.0);
                setProgress(currentProgress);

                // เช็คว่าครบ 80 เฟรมหรือยัง
                if (recordedDataRef.current.length >= FRAMES_TO_COLLECT) {
                    finishScan();
                }
            }
        }
        ctx.restore();
    }, [status, finishScan]);


    // --- Logic: เริ่มต้น Sensors ---
    const startSensors = async () => {
        // ฟังก์ชัน Helper สำหรับเริ่ม Sensor
        const initSensor = (SensorClass: any, key: 'accel' | 'gyro') => {
            try {
                const sensor = new SensorClass({ frequency: 60 });
                sensor.addEventListener('reading', () => {
                    if (sensor.x != null) {
                        latestSensorDataRef.current[key] = { x: sensor.x, y: sensor.y, z: sensor.z };
                    }
                });
                sensor.start();
            } catch (e) {
                console.warn(`Sensor ${key} not supported or blocked:`, e);
            }
        };

        if ('Accelerometer' in window) initSensor((window as any).Accelerometer, 'accel');
        if ('Gyroscope' in window) initSensor((window as any).Gyroscope, 'gyro');

        // ขอ Permission (สำหรับ Chrome/Android)
        try {
            if (navigator.permissions) {
                await Promise.all([
                    navigator.permissions.query({ name: 'accelerometer' as PermissionName }),
                    navigator.permissions.query({ name: 'gyroscope' as PermissionName })
                ]);
            }
        } catch (e) {
             console.log("Permission query skipped");
        }
    };
    
    // --- Logic: ปุ่ม Start Scan ---
    const startScan = async () => {
        try {
            // 1. เปิดกล้อง
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 640, height: 480, facingMode: 'user' } 
            });
            
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                // รอให้วิดีโอพร้อมเล่นจริง
                await new Promise((resolve) => {
                    if (videoRef.current) {
                        videoRef.current.onloadedmetadata = () => {
                            videoRef.current!.play().then(resolve);
                        };
                    }
                });

                // ตั้งค่าขนาด Canvas ให้ตรงกับวิดีโอ
                if(canvasRef.current) {
                    canvasRef.current.width = videoRef.current.videoWidth;
                    canvasRef.current.height = videoRef.current.videoHeight;
                }
            }

            // 2. เริ่มระบบต่างๆ
            recordedDataRef.current = [];
            setProgress(0);
            setStatus('scanning');
            startSensors();

            // 3. เริ่ม Loop ส่งภาพเข้า FaceMesh
            const renderLoop = async () => {
                if (videoRef.current && faceMeshRef.current && videoRef.current.readyState >= 2) {
                    await faceMeshRef.current.send({ image: videoRef.current });
                }
                animationFrameId.current = requestAnimationFrame(renderLoop);
            };
            renderLoop();

            // 4. ตั้งเวลาตัดจบ (Watchdog Timer) - แก้ปัญหาค้าง
            timeoutRef.current = setTimeout(() => {
                console.warn("Watchdog Timer triggered: Forcing finish scan.");
                // เปลี่ยนสถานะแต่ยังไม่หยุดทันที รอให้ finishScan จัดการ
                setStatus('timeout'); 
                finishScan();
            }, SCAN_DURATION_TIMEOUT);

        } catch (err) {
            console.error("Camera access denied:", err);
            setStatus('permission_required');
        }
    };

    // --- JSX Render ---
    return (
        <div className="flex flex-col items-center justify-center w-full">
            <div className="relative w-full max-w-md mx-auto aspect-square rounded-full overflow-hidden border-4 border-gray-200 shadow-2xl bg-black">
                {/* Video ซ่อนไว้ ใช้ส่งภาพเฉยๆ */}
                <video ref={videoRef} className="absolute w-full h-full object-cover hidden" playsInline muted />
                
                {/* Canvas แสดงผลและวาดเส้น */}
                <canvas ref={canvasRef} className="w-full h-full object-cover transform -scale-x-100" />
                
                {/* Overlay สถานะ */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    
                    {/* ปุ่ม Start (แสดงเมื่อไม่ได้ Scan) */}
                    {(status === 'ready' || status === 'idle' || status === 'error') && (
                        <div className="bg-black/40 w-full h-full flex flex-col items-center justify-center backdrop-blur-sm pointer-events-auto">
                            <p className="text-white font-semibold text-lg drop-shadow-md mb-6 px-4 text-center">
                                {StatusMessages[status]}
                            </p>
                            <button
                                onClick={startScan}
                                className="bg-blue-600 hover:bg-blue-500 text-white text-lg font-bold py-3 px-8 rounded-full shadow-lg transform transition hover:scale-105 active:scale-95"
                            >
                                Start Scan
                            </button>
                        </div>
                    )}

                    {/* Progress Circle (แสดงตอน Scan) */}
                    {(status === 'scanning' || status === 'timeout') && (
                         <div className="relative w-full h-full flex items-center justify-center">
                             <svg className="absolute inset-0 w-full h-full p-2" viewBox="0 0 100 100">
                                 {/* Background Circle */}
                                 <circle className="text-gray-600 opacity-30" strokeWidth="4" stroke="currentColor" fill="transparent" r="46" cx="50" cy="50" />
                                 {/* Progress Circle */}
                                 <circle
                                    className={`${status === 'timeout' ? 'text-yellow-500' : 'text-green-500'}`}
                                    strokeWidth="4"
                                    strokeDasharray={2 * Math.PI * 46}
                                    strokeDashoffset={(1 - progress) * (2 * Math.PI * 46)}
                                    strokeLinecap="round"
                                    stroke="currentColor"
                                    fill="transparent"
                                    r="46" cx="50" cy="50"
                                    style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 0.1s linear' }}
                                />
                             </svg>
                             <div className="absolute bottom-10 left-0 right-0 text-center">
                                 <span className="inline-block bg-black/60 text-white text-sm px-3 py-1 rounded-full backdrop-blur-md">
                                     {status === 'timeout' ? 'Finishing up...' : 'Scanning...'}
                                 </span>
                             </div>
                         </div>
                    )}

                    {/* Loading/Processing Overlay */}
                    {(status === 'initializing' || status === 'processing') && (
                        <div className="bg-black/60 w-full h-full flex flex-col items-center justify-center backdrop-blur-sm">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4"></div>
                            <p className="text-white font-medium">{StatusMessages[status]}</p>
                        </div>
                    )}
                </div>
            </div>
            
            {/* คำแนะนำเพิ่มเติมด้านล่าง */}
            {status === 'scanning' && (
                <p className="mt-4 text-gray-600 text-sm animate-pulse">
                    Please keep your face inside the circle
                </p>
            )}
        </div>
    );
};

export default FaceScan;
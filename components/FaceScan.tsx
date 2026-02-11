import React, { useState, useRef, useEffect, useCallback } from 'react';

const SCAN_DURATION_S = 4;
const FRAMES_TO_COLLECT = 80;

declare const FaceMesh: any;
declare const drawConnectors: any;
declare const FACEMESH_TESSELATION: any;

interface FaceScanProps {
    onScanComplete: (data: object) => void;
}

type ScanStatus = 'idle' | 'initializing' | 'permission_required' | 'ready' | 'scanning' | 'processing' | 'error';

const StatusMessages: Record<ScanStatus, string> = {
    idle: 'Click Start to begin the scan.',
    initializing: 'Initializing camera and models...',
    permission_required: 'Camera and sensor access is required.',
    ready: 'Ready to scan. Please position your face in the center.',
    scanning: 'Scanning... Move your head slowly in a circle.',
    processing: 'Processing scan data...',
    error: 'An error occurred. Please try again.',
};

const FaceScan: React.FC<FaceScanProps> = ({ onScanComplete }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const faceMeshRef = useRef<any>(null);
    const recordedDataRef = useRef<any[]>([]);
    const latestSensorDataRef = useRef<{ accel: any, gyro: any }>({ accel: {}, gyro: {} });
    const animationFrameId = useRef<number>();

    const [status, setStatus] = useState<ScanStatus>('idle');
    const [progress, setProgress] = useState(0);

    const cleanup = useCallback(() => {
        if (animationFrameId.current) {
            cancelAnimationFrame(animationFrameId.current);
        }
        if (videoRef.current?.srcObject) {
            (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
        }
        if (faceMeshRef.current) {
            // Fix: Cast the faceMesh instance to provide the correct signature for the `close` method, resolving a static analysis error.
            (faceMeshRef.current as { close: () => void }).close();
        }
    }, []);

    useEffect(() => {
        setStatus('initializing');
        try {
            faceMeshRef.current = new FaceMesh({
                locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
            });

            faceMeshRef.current.setOptions({
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

        return cleanup;
    }, []);

    const onFaceMeshResults = (results: any) => {
        if (!canvasRef.current) return;
        const canvasCtx = canvasRef.current.getContext('2d');
        if (!canvasCtx) return;

        canvasCtx.save();
        canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        canvasCtx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);

        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];
            drawConnectors(canvasCtx, landmarks, FACEMESH_TESSELATION, { color: '#C0C0C070', lineWidth: 1 });

            if (status === 'scanning') {
                const frameData = {
                    faceMesh: landmarks.map((lm: any) => [lm.x, lm.y, lm.z]).flat(),
                    sensors: { ...latestSensorDataRef.current },
                    meta: { camera_facing: 'user' },
                };
                recordedDataRef.current.push(frameData);
                
                const currentProgress = recordedDataRef.current.length / FRAMES_TO_COLLECT;
                setProgress(currentProgress);

                if (recordedDataRef.current.length >= FRAMES_TO_COLLECT) {
                    finishScan();
                }
            }
        }
        canvasCtx.restore();
    };

    const startSensors = async () => {
        if (!('Accelerometer' in window) || !('Gyroscope' in window)) {
            console.warn("Motion sensors not supported on this device.");
            return; // Continue without sensor data if not available
        }
        
        const startSensor = (sensorName: 'Accelerometer' | 'Gyroscope', key: 'accel' | 'gyro') => {
            try {
                const sensor = new (window as any)[sensorName]({ frequency: 60 });
                sensor.addEventListener('reading', () => {
                    latestSensorDataRef.current[key] = { x: sensor.x, y: sensor.y, z: sensor.z };
                });
                sensor.start();
            } catch (e) {
                console.error(`Could not start ${sensorName}`, e);
            }
        };

        await navigator.permissions.query({ name: 'accelerometer' as PermissionName });
        await navigator.permissions.query({ name: 'gyroscope' as PermissionName });

        startSensor('Accelerometer', 'accel');
        startSensor('Gyroscope', 'gyro');
    };
    
    const startScan = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
                if(canvasRef.current) {
                    canvasRef.current.width = videoRef.current.videoWidth;
                    canvasRef.current.height = videoRef.current.videoHeight;
                }
            }
            setStatus('scanning');
            recordedDataRef.current = [];
            await startSensors();
            
            const renderLoop = async () => {
                if (videoRef.current && faceMeshRef.current) {
                    await faceMeshRef.current.send({ image: videoRef.current });
                }
                animationFrameId.current = requestAnimationFrame(renderLoop);
            };
            renderLoop();
        } catch (err) {
            console.error("Camera access denied:", err);
            setStatus('permission_required');
        }
    };

    const finishScan = () => {
        setStatus('processing');
        if (animationFrameId.current) {
            cancelAnimationFrame(animationFrameId.current);
        }
        onScanComplete({ data: recordedDataRef.current });
        cleanup();
    };

    return (
        <div className="relative w-full max-w-md mx-auto aspect-square rounded-full overflow-hidden border-4 border-gray-200 shadow-lg">
            <video ref={videoRef} className="absolute w-full h-full object-cover hidden" playsInline />
            <canvas ref={canvasRef} className="w-full h-full object-cover transform -scale-x-100" />
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-30 p-4">
                {status !== 'scanning' && (
                    <div className="text-center">
                        <p className="text-white font-semibold text-lg drop-shadow-md mb-4">{StatusMessages[status]}</p>
                        {(status === 'ready' || status === 'idle' || status === 'permission_required') && (
                             <button
                                onClick={startScan}
                                className="bg-blue-600 text-white font-bold py-3 px-6 rounded-full hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-300 transition-all duration-300 shadow-xl"
                            >
                                Start Scan
                            </button>
                        )}
                    </div>
                )}
                {status === 'scanning' && (
                     <div className="relative w-full h-full">
                         <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
                             <circle className="text-gray-400 opacity-50" strokeWidth="4" stroke="currentColor" fill="transparent" r="48" cx="50" cy="50" />
                             <circle
                                className="text-blue-500"
                                strokeWidth="4"
                                strokeDasharray={2 * Math.PI * 48}
                                strokeDashoffset={(1 - progress) * (2 * Math.PI * 48)}
                                strokeLinecap="round"
                                stroke="currentColor"
                                fill="transparent"
                                r="48" cx="50" cy="50"
                                style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 0.3s' }}
                            />
                         </svg>
                         <div className="absolute bottom-6 left-0 right-0 text-center">
                             <p className="text-white font-semibold text-lg drop-shadow-md">{StatusMessages.scanning}</p>
                         </div>
                     </div>
                )}
            </div>
        </div>
    );
};

export default FaceScan;
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
        <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center',
            minHeight: '100vh',
            backgroundColor: '#1a1a1a',
            color: 'white',
            fontFamily: 'sans-serif',
            padding: '20px'
        }}>
            <h1 style={{ fontSize: '1.5rem', marginBottom: '20px' }}>Face Liveness Scan</h1>

            {/* Video Container - ปรับเป็นแนวตั้ง (Portrait) */}
            <div style={{ 
            position: 'relative', 
            width: '100%', 
            maxWidth: '350px', 
            aspectRatio: '3/4', 
            borderRadius: '20px', 
            overflow: 'hidden',
            border: `4px solid ${isScanning ? '#00ff00' : '#333'}`,
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
            }}>
            <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
            
            {/* Overlay วงกลมให้เอาหน้าไปวาง */}
            <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '250px',
                height: '250px',
                border: '2px dashed rgba(255,255,255,0.5)',
                borderRadius: '50%',
                pointerEvents: 'none'
            }}></div>
            </div>

            {/* ส่วนแสดงผลคะแนน - ใหญ่และชัดเจน */}
            {result && (
            <div style={{ 
                marginTop: '20px', 
                padding: '15px', 
                borderRadius: '15px', 
                backgroundColor: '#333',
                width: '100%',
                maxWidth: '350px',
                textAlign: 'center'
            }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: result.is_real ? '#4caf50' : '#f44336' }}>
                RESULT: {result.is_real ? '✅ REAL' : '❌ SPOOF'}
                </div>
                <div style={{ fontSize: '2rem', margin: '10px 0' }}>{(result.score * 100).toFixed(2)}%</div>
                
                <div style={{ fontSize: '0.8rem', color: '#aaa', textAlign: 'left', marginTop: '10px' }}>
                • Motion Head: {result.details.motion_consistency}<br />
                • Visual Head: {result.details.visual_liveness}
                </div>
            </div>
            )}

            {/* ปุ่มกด - ใหญ่พิเศษสำหรับนิ้วโป้งคนสแกน */}
            <button 
            onClick={isScanning ? stopScan : startScan}
            style={{
                marginTop: '30px',
                width: '100%',
                maxWidth: '350px',
                padding: '20px',
                fontSize: '1.2rem',
                fontWeight: 'bold',
                borderRadius: '50px',
                border: 'none',
                backgroundColor: isScanning ? '#f44336' : '#007bff',
                color: 'white',
                boxShadow: '0 5px 15px rgba(0,0,0,0.3)',
                cursor: 'pointer'
            }}
            >
            {isScanning ? 'CANCEL' : 'START SCAN'}
            </button>
        </div>
    );
};

export default FaceScan;
import json
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
import tensorflow as tf
from pydantic import BaseModel
from typing import Optional
import os

# สมมติว่า LivenessPredictor อยู่ในไฟล์เดียวกันหรือ import มา
# ในที่นี้เราจะดึง Logic การเลือกจุดสำคัญมาใช้ใน preprocess
from utils import preprocess_json_for_inference 

app = FastAPI(title="Face Liveness Detection API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- TFLite Configuration ---
MODEL_PATH = "Combined_Vision_Motion.tflite"
interpreter = None
input_details = None
output_details = None

# 28 Landmark Indices ที่ใช้บ่อย (อ้างอิงตามมาตรฐาน Mediapipe ที่ครอบคลุมจุดสำคัญ)
# หากคุณมีลิสต์ที่ใช้ตอน Train เฉพาะเจาะจง ให้เปลี่ยนตัวเลขในลิสต์นี้ครับ
SELECTED_LANDMARK_INDICES = [
    1, 4, 33, 61, 133, 159, 263, 291, 362, 386, # ตาและจมูก
    10, 152, 234, 454, 123, 352, 6, 168,      # รูปหน้าและสันจมูก
    0, 11, 12, 13, 14, 15, 16, 17, 37, 39     # ปากและแนวกราม
]

@app.on_event("startup")
def load_model():
    global interpreter, input_details, output_details
    if not os.path.exists(MODEL_PATH):
        print(f"ERROR: Model file not found at {MODEL_PATH}")
        return
        
    try:
        # ใช้ tf.lite.Interpreter (TensorFlow 2.15)
        interpreter = tf.lite.Interpreter(model_path=MODEL_PATH)
        interpreter.allocate_tensors()
        input_details = interpreter.get_input_details()
        output_details = interpreter.get_output_details()
        
        print("✅ TFLite model loaded successfully.")
    except Exception as e:
        print(f"❌ Failed to load model: {e}")
        raise e

@app.post("/predict")
async def predict(file: UploadFile = File(...), image: Optional[UploadFile] = File(None)):
    try:
        # 1. อ่านข้อมูล JSON (Motion & Landmarks)
        json_content = await file.read()
        data = json.loads(json_content)
        scan_data = data.get('data', [])
        
        # Preprocess ข้อมูล Vector (ส่วนนี้ของคุณน่าจะถูกแล้ว)
        from utils import preprocess_json_for_inference
        X_lm, X_sn, X_bg = preprocess_json_for_inference(scan_data)

        # ---------------------------------------------------------
        # 2. จัดการรูปภาพ (Visual Input) ** แก้จุดนี้ **
        # ---------------------------------------------------------
        if image:
            # อ่านไฟล์รูปภาพแปลงเป็น numpy array
            img_bytes = await image.read()
            nparr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            # เช็คขนาดที่โมเดลต้องการ (Input Index 2 คือ Visual)
            # input_details[2]['shape'] มักจะเป็น [1, 128, 128, 3] หรือ [1, 224, 224, 3]
            target_h = input_details[2]['shape'][1]
            target_w = input_details[2]['shape'][2]
            
            # A. Resize ให้ตรงกับโมเดล
            img = cv2.resize(img, (target_w, target_h))
            
            # B. แปลงสี BGR -> RGB (สำคัญ! ถ้าสีผิด ผลลัพธ์จะเพี้ยน)
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            
            # C. Normalize (สำคัญมาก! แก้ปัญหาคะแนนเต็ม)
            # แปลงเป็น float32 และหาร 255.0 เพื่อให้ค่าอยู่ระหว่าง 0.0 - 1.0
            img_input = img.astype(np.float32) / 255.0
            
            # D. เพิ่มมิติ Batch (จาก [128,128,3] เป็น [1,128,128,3])
            img_input = np.expand_dims(img_input, axis=0)
            
        else:
            # กรณีไม่มีรูป (ไม่ควรเกิดขึ้นถ้า Frontend ส่งมา)
            # สร้างภาพดำเปล่าๆ เพื่อกัน Crash
            target_h = input_details[2]['shape'][1]
            target_w = input_details[2]['shape'][2]
            img_input = np.zeros((1, target_h, target_w, 3), dtype=np.float32)

        # ---------------------------------------------------------
        # 3. ส่งเข้าโมเดล (Inference)
        # ---------------------------------------------------------
        
        # Input 0: Sensors
        interpreter.set_tensor(input_details[0]['index'], X_sn.astype(np.float32)) 
        
        # Input 1: Landmarks
        interpreter.set_tensor(input_details[1]['index'], X_lm.astype(np.float32))
        
        # Input 2: Visual (รูปภาพที่ process แล้ว)
        interpreter.set_tensor(input_details[2]['index'], img_input)
        
        # Input 3: Motion Analysis
        interpreter.set_tensor(input_details[3]['index'], X_bg.astype(np.float32))

        # Run
        interpreter.invoke()

        # Get Output
        res_motion = interpreter.get_tensor(output_details[0]['index'])[0][0] # Motion Score
        res_visual = interpreter.get_tensor(output_details[1]['index'])[0][0] # Visual Score
        
        print(f"DEBUG Scores -> Motion: {res_motion:.4f}, Visual: {res_visual:.4f}")

        # Weighting: คุณอาจจะให้ความสำคัญกับ Visual น้อยลงถ้ามันยังไม่แม่น
        # เช่น Motion 70% + Visual 30%
        final_score = (res_motion * 0.6) + (res_visual * 0.4)
        
        # ตัดสินผล (Threshold 0.7)
        is_real = final_score > 0.7 
        
        return {
            "score": round(final_score, 4),
            "is_real": bool(is_real),
            "status": "success",
            "details": {
                "motion_consistency": round(float(res_0), 4),
                "visual_liveness": round(float(res_1), 4),
                "frames_processed": 80
            }
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e), "is_real": False, "score": 0.0}
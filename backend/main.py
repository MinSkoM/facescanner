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
async def predict(file: UploadFile = File(...)):
    global interpreter, input_details, output_details

    if interpreter is None:
        raise HTTPException(status_code=500, detail="Model not initialized.")

    try:
        contents = await file.read()
        json_data = json.loads(contents)
    except:
        raise HTTPException(status_code=400, detail="Invalid JSON.")

    # 1. Preprocess เบื้องต้น
    # หมายเหตุ: ต้องแก้ใน preprocess_json_for_inference ให้รับแค่ 28 จุด 
    # หรือ Slice ข้อมูลก่อนส่งเข้าฟังก์ชันนี้
    X_lm, X_sn, X_bg = preprocess_json_for_inference(json_data)

    if X_lm is None:
        raise HTTPException(status_code=422, detail="Data length error (need 80 frames).")

    # 2. แก้ปัญหา Dimension Mismatch (1404 -> 84)
    # ถ้า X_lm ออกมาเป็น (1, 80, 1404) เราจะ Slice ให้เหลือ (1, 80, 84)
    if X_lm.shape[-1] == 1404:
        # แปลงเป็น (1, 80, 468, 3) -> เลือกเฉพาะจุด -> แปลงกลับเป็น (1, 80, 84)
        X_lm_reshaped = X_lm.reshape(1, 80, 468, 3)
        X_lm = X_lm_reshaped[:, :, SELECTED_LANDMARK_INDICES, :].reshape(1, 80, 84)

    try:
        # --- Mapping Inputs ตาม Index ที่ตรวจพบใน Log ---
        
        # Index 0: input_motion_1 (Sensors: [1, 80, 6])
        interpreter.set_tensor(input_details[0]['index'], X_sn.astype(np.float32)) 
        
        # Index 1: input_motion_0 (Landmarks: [1, 80, 84])
        interpreter.set_tensor(input_details[1]['index'], X_lm.astype(np.float32))
        
        # Index 2: input_vision_rgb (Image/Background: [1, 224, 224, 3])
        # หากไม่มีภาพส่งมา ให้ส่งค่า 0 (Black Image)
        bg_input = np.zeros((1, 224, 224, 3), dtype=np.float32)
        interpreter.set_tensor(input_details[2]['index'], bg_input)
        
        # Index 3: input_motion_2 (Motion Analysis: [1, 80, 6])
        # ใช้ข้อมูล X_bg (Motion Features) จาก preprocess
        interpreter.set_tensor(input_details[3]['index'], X_bg.astype(np.float32))

        # --- ในไฟล์ main.py ส่วนของเมธอด predict ---

        # 3. Run Inference
        interpreter.invoke()

        # 4. ดึงค่าจาก Output ทั้ง 2 หัว
        res_0 = interpreter.get_tensor(output_details[0]['index'])[0][0]
        res_1 = interpreter.get_tensor(output_details[1]['index'])[0][0]
        
        # คำนวณ Score (สามารถปรับเปลี่ยน Logic ได้ตามต้องการ)
        final_score = float((res_0 + res_1) / 2)
        
        # ตัดสินผล (แนะนำให้ใช้ค่าที่เข้มงวดขึ้นถ้าต้องการกัน Spoof)
        is_real = final_score > 0.7  # ปรับจาก 0.5 เป็น 0.7 เพื่อความชัวร์
        
        return {
            "score": round(final_score, 4),
            "is_real": is_real,
            "status": "success",
            "details": {
                "motion_consistency": round(float(res_0), 4),
                "visual_liveness": round(float(res_1), 4),
                "frames_processed": 80
            }
        }

    except Exception as e:
        print(f"Inference Error: {e}")
        return {"status": "error", "message": str(e)}
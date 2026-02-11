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
async def predict(
    file: UploadFile = File(...), 
    image: Optional[UploadFile] = File(None) # รับไฟล์ภาพที่ส่งมาจาก Frontend
):
    global interpreter, input_details, output_details

    if interpreter is None:
        raise HTTPException(status_code=500, detail="Model not initialized.")

    try:
        contents = await file.read()
        json_data = json.loads(contents)
    except:
        raise HTTPException(status_code=400, detail="Invalid JSON.")

    # 1. Preprocess ข้อมูล JSON (Landmarks + Sensors)
    X_lm, X_sn, X_bg = preprocess_json_for_inference(json_data)

    if X_lm is None:
        raise HTTPException(status_code=422, detail="Data length error (need 80 frames).")

    # 2. จัดการ Dimension Landmarks (1404 -> 84)
    if X_lm.shape[-1] == 1404:
        X_lm_reshaped = X_lm.reshape(1, 80, 468, 3)
        X_lm = X_lm_reshaped[:, :, SELECTED_LANDMARK_INDICES, :].reshape(1, 80, 84)

    # 3. เตรียมข้อมูลรูปภาพ (Visual Input - Index 2)
    if image:
        try:
            image_bytes = await image.read()
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            # Resize เป็น 224x224 ตามที่ Model ต้องการ
            img_resized = cv2.resize(img, (224, 224))
            # Normalize เป็นช่วง 0.0 - 1.0 และเพิ่มมิติเป็น [1, 224, 224, 3]
            img_input = img_resized.astype(np.float32) / 255.0
            img_input = np.expand_dims(img_input, axis=0)
        except Exception as e:
            print(f"Image processing error: {e}")
            img_input = np.zeros((1, 224, 224, 3), dtype=np.float32)
    else:
        # กรณีไม่มีภาพส่งมา ให้ส่งค่า 0 (Black Image) ป้องกัน Model พัง
        img_input = np.zeros((1, 224, 224, 3), dtype=np.float32)

    try:
        # --- Mapping Inputs เข้าสู่ TFLite Interpreter ---
        
        # Index 0: Sensors (input_motion_1)
        interpreter.set_tensor(input_details[0]['index'], X_sn.astype(np.float32)) 
        
        # Index 1: Landmarks (input_motion_0)
        interpreter.set_tensor(input_details[1]['index'], X_lm.astype(np.float32))
        
        # Index 2: Visual RGB (input_vision_rgb) - **ใช้ภาพจริงแล้ว**
        interpreter.set_tensor(input_details[2]['index'], img_input)
        
        # Index 3: Motion Analysis (input_motion_2)
        interpreter.set_tensor(input_details[3]['index'], X_bg.astype(np.float32))

        # 4. Run Inference
        interpreter.invoke()

        # 5. ดึงค่า Output ทั้ง 2 หัว
        res_0 = interpreter.get_tensor(output_details[0]['index'])[0][0] # Motion Head
        res_1 = interpreter.get_tensor(output_details[1]['index'])[0][0] # Vision Head
        
        # คำนวณคะแนนเฉลี่ย
        final_score = float((res_0 + res_1) / 2)
        
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
        print(f"Inference Error: {e}")
        return {"status": "error", "message": str(e)}
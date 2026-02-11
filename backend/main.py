
import json
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
import tensorflow as tf
from pydantic import BaseModel
from typing import Optional
import os

from utils import preprocess_json_for_inference

app = FastAPI(title="Face Liveness Detection API")

# --- CORS Configuration ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# --- TFLite Model Loading ---
MODEL_PATH = "Combined_Vision_Motion.tflite"
interpreter = None
input_details = None
output_details = None

@app.on_event("startup")
def load_model():
    global interpreter, input_details, output_details
    if not os.path.exists(MODEL_PATH):
        print(f"ERROR: Model file not found at {MODEL_PATH}")
        return
        
    try:
        # ------------------ แก้ไขตรงนี้ ------------------
        # ลบหรือ Comment บรรทัดเดิมทิ้ง:
        # interpreter = tf.lite.Interpreter(model_path=MODEL_PATH)
        
        # ใช้ของใหม่แทน (รองรับ Flex Ops ดีกว่า):
        interpreter = tf.lite.Interpreter(model_path=MODEL_PATH)
        # -----------------------------------------------

        interpreter.allocate_tensors()
        input_details = interpreter.get_input_details()
        output_details = interpreter.get_output_details()
        print("LiteRT model loaded successfully.") # เปลี่ยนข้อความนิดหน่อย
        print("Input Details:", input_details)
        print("Output Details:", output_details)
        
    except Exception as e:
        print(f"Failed to load model: {e}")
        # เพิ่มบรรทัดนี้เพื่อให้เห็น Error ชัดๆ ถ้ามันพังอีก
        raise e


class PredictionResponse(BaseModel):
    score: float
    is_real: bool
    error: Optional[str] = None

@app.get("/")
def read_root():
    return {"status": "Liveness Detection API is running"}

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    global interpreter, input_details, output_details

    if interpreter is None:
        raise HTTPException(status_code=500, detail="Model is not loaded.")

    try:
        contents = await file.read()
        json_data = json.loads(contents)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON file.")

    # ใช้ตัวช่วย Preprocess ที่คุณมี
    X_lm, X_sn, X_bg = preprocess_json_for_inference(json_data)

    if X_lm is None or X_sn is None or X_bg is None:
        raise HTTPException(status_code=422, detail="Data length not enough (need 80 frames).")

    try:
        # --- ส่ง Input 4 ตัวตามลำดับ Index ใน Log ---
        # Index 0: Sensors (80, 6)
        interpreter.set_tensor(input_details[0]['index'], X_sn) 
        
        # Index 1: Landmarks (80, 84)
        interpreter.set_tensor(input_details[1]['index'], X_lm)
        
        # Index 2: Vision/Image (224, 224, 3) 
        # (ถ้าใน JSON ไม่มีภาพจริง ระบบ preprocess มักจะใส่ zeros มาให้)
        interpreter.set_tensor(input_details[2]['index'], X_bg if X_bg.shape == (1, 224, 224, 3) else np.zeros((1, 224, 224, 3), dtype=np.float32))
        
        # Index 3: Motion/Background Features (80, 6)
        # หมายเหตุ: ถ้า preprocess แยก X_bg ออกมาเป็น 2 ส่วนไม่ได้ ให้ลองส่ง X_sn หรือ zeros เข้าไปเทสก่อน
        interpreter.set_tensor(input_details[3]['index'], np.zeros((1, 80, 6), dtype=np.float32))

        interpreter.invoke()

        # --- ดึง Output ---
        # ลองดึงจาก Index 0 ของ Output ก่อน (สอดคล้องกับ Index 325 หรือ 435)
        output_data = interpreter.get_tensor(output_details[0]['index'])
        score = float(output_data[0][0])
        
        # ปรับเกณฑ์ตามความเหมาะสม
        is_real = score > 0.5 
        
        return {
            "score": score, 
            "is_real": is_real,
            "status": "success"
        }

    except Exception as e:
        print(f"Inference Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

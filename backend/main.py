
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
        # In a real app, you might want to prevent startup or handle this more gracefully.
        # For this example, we'll let it proceed but endpoints will fail.
        return
        
    try:
        interpreter = tf.lite.Interpreter(model_path=MODEL_PATH)
        interpreter.allocate_tensors()
        input_details = interpreter.get_input_details()
        output_details = interpreter.get_output_details()
        print("TFLite model loaded successfully.")
        print("Input Details:", input_details)
        print("Output Details:", output_details)
    except Exception as e:
        print(f"Failed to load TFLite model: {e}")
        interpreter = None


class PredictionResponse(BaseModel):
    score: float
    is_real: bool
    error: Optional[str] = None

@app.get("/")
def read_root():
    return {"status": "Liveness Detection API is running"}

@app.post("/predict", response_model=PredictionResponse)
async def predict(file: UploadFile = File(...)):
    global interpreter, input_details, output_details

    if interpreter is None:
        raise HTTPException(status_code=500, detail="Model is not loaded. Check server logs.")

    try:
        contents = await file.read()
        json_data = json.loads(contents)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON file.")

    X_lm, X_sn, X_bg = preprocess_json_for_inference(json_data)

    if X_lm is None or X_sn is None or X_bg is None:
        raise HTTPException(status_code=422, detail="Preprocessing failed. The provided JSON may not have enough valid data.")

    # The model expects 3 inputs. We assume the order based on a typical setup.
    # IMPORTANT: Adjust the indices if your model's input order is different.
    # You can verify the expected input names/order from `input_details`.
    try:
        # Assuming input order: landmarks, sensors, background
        interpreter.set_tensor(input_details[0]['index'], X_lm)
        interpreter.set_tensor(input_details[1]['index'], X_sn)
        interpreter.set_tensor(input_details[2]['index'], X_bg)
        
        interpreter.invoke()
        
        output_data = interpreter.get_tensor(output_details[0]['index'])
        score = float(output_data[0][0])
        is_real = score > 0.5
        
        return {"score": score, "is_real": is_real}
        
    except Exception as e:
        print(f"Inference error: {e}")
        raise HTTPException(status_code=500, detail=f"An error occurred during model inference: {e}")

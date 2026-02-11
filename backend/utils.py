
import numpy as np
import pandas as pd
import scipy.signal
import tensorflow as tf

# --- CONFIG ---
MAX_SEQ_LENGTH = 80   
NUM_LANDMARKS = 28 * 3 
NUM_SENSORS = 6        
NUM_BG = 6             
GATE_THRESHOLD = 3.0  
ENABLE_SMOOTHING = True
SMOOTH_SPAN = 3

def safe_float(val):
    try:
        return float(val) if val is not None else 0.0
    except: return 0.0

def process_signal_data(data_seq):
    if not isinstance(data_seq, (list, np.ndarray)) or len(data_seq) == 0:
            return np.zeros((MAX_SEQ_LENGTH, 1))
    
    df = pd.DataFrame(data_seq)
    if ENABLE_SMOOTHING: 
        df = df.ewm(span=SMOOTH_SPAN, adjust=False).mean()
    
    vals = df.astype(float).fillna(0.0).values
    median = np.median(vals, axis=0)
    q75, q25 = np.percentile(vals, [75 ,25], axis=0)
    iqr = q75 - q25
    iqr[iqr == 0] = 1.0 
    
    normalized = (vals - median) / iqr
    return np.clip(normalized, -4.0, 4.0)

def perform_temporal_alignment(lm_seq, sn_seq, bg_seq):
    if len(lm_seq) < 15 or len(sn_seq) < 15:
        return lm_seq, sn_seq, bg_seq 
    try:
        face_dy = []
        prev = np.array(lm_seq[0])
        for curr in lm_seq:
            curr = np.array(curr)
            diff = np.mean(curr[1::3]) - np.mean(prev[1::3]) 
            face_dy.append(diff)
            prev = curr
            
        gyro_x = [s[3] for s in sn_seq] 

        def norm(arr):
            a = np.array(arr)
            return (a - np.mean(a)) / (np.std(a) + 1e-6)

        corr = scipy.signal.correlate(norm(face_dy), norm(gyro_x), mode='full')
        lags = scipy.signal.correlation_lags(len(face_dy), len(gyro_x), mode='full')
        best_lag = lags[np.argmax(corr)]
        
        if abs(best_lag) > 30: return lm_seq, sn_seq, bg_seq 

        aligned_lm, aligned_sn, aligned_bg = list(lm_seq), list(sn_seq), list(bg_seq)
        if best_lag < 0:
            shift = abs(best_lag)
            if shift < len(lm_seq) - 5:
                aligned_lm = lm_seq[:-shift]; aligned_sn = sn_seq[shift:]; aligned_bg = bg_seq[:-shift]
        elif best_lag > 0:
            shift = abs(best_lag)
            if shift < len(lm_seq) - 5:
                aligned_lm = lm_seq[shift:]; aligned_sn = sn_seq[:-shift]; aligned_bg = bg_seq[shift:]

        min_len = min(len(aligned_lm), len(aligned_sn), len(aligned_bg))
        return aligned_lm[:min_len], aligned_sn[:min_len], aligned_bg[:min_len]
    except: return lm_seq, sn_seq, bg_seq

def preprocess_json_for_inference(json_data):
    frames = json_data.get('data', [])
    if not frames: return None, None, None
    
    all_vars = [f.get('bg_variance', 0) for f in frames]
    is_gate_open = np.mean(all_vars) >= GATE_THRESHOLD if all_vars else False
    
    lm_seq, sn_seq, bg_seq = [], [], []
    prev_lm = None 
    
    for f in frames:
        meta = f.get('meta', {}) or {}
        mult = -1 if meta.get('camera_facing') == 'environment' else 1
        
        raw_lm = f.get('faceMesh')
        if raw_lm is None: continue
        curr_lm = np.array(raw_lm).flatten()
        
        if prev_lm is None: d_lm = np.zeros_like(curr_lm)
        else: d_lm = curr_lm - prev_lm
        lm_seq.append(d_lm); prev_lm = curr_lm 

        s = f.get('sensors', {}) or {}
        a = s.get('accel') or {}; g = s.get('gyro') or {}
        
        sn_seq.append([safe_float(a.get('x')), safe_float(a.get('y')), safe_float(a.get('z'))*mult, 
                       safe_float(g.get('x')), safe_float(g.get('y')), safe_float(g.get('z'))])

        if is_gate_open:
            m = f.get('motion_analysis', {}) or {}
            bg_seq.append([safe_float(m.get('face_dx')), safe_float(m.get('face_dy')),
                           safe_float(m.get('bg_dx')), safe_float(m.get('bg_dy')),
                           safe_float(m.get('relative_magnitude')), safe_float(f.get('bg_variance'))])
        else: bg_seq.append([0.0] * NUM_BG)

    lm_seq, sn_seq, bg_seq = perform_temporal_alignment(lm_seq, sn_seq, bg_seq)
    if len(lm_seq) < 5: return None, None, None
    
    X_lm = process_signal_data(np.array(lm_seq))
    X_sn = process_signal_data(np.array(sn_seq))
    X_bg = process_signal_data(np.array(bg_seq))

    def crop_pad(arr):
        if len(arr) > MAX_SEQ_LENGTH:
            start = (len(arr)-MAX_SEQ_LENGTH)//2
            return arr[start : start + MAX_SEQ_LENGTH]
        elif len(arr) < MAX_SEQ_LENGTH:
            return np.vstack((arr, np.zeros((MAX_SEQ_LENGTH - len(arr), arr.shape[1]))))
        return arr
        
    return (
        np.expand_dims(crop_pad(X_lm), 0).astype(np.float32), 
        np.expand_dims(crop_pad(X_sn), 0).astype(np.float32), 
        np.expand_dims(crop_pad(X_bg), 0).astype(np.float32)
    )

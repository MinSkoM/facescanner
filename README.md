
# Face Liveness Detection App

This project contains a Python FastAPI backend for TFLite model inference and a React + TypeScript frontend for the user interface.

## Prerequisites

- Python 3.8+
- Node.js 18+ and npm
- `ngrok` for exposing the local backend

## Backend Setup

The backend is a FastAPI server that handles the machine learning inference.

1.  **Navigate to the backend directory:**
    If you have a `backend` folder, `cd backend`. The Python files are expected to be in the same directory.

2.  **Create a virtual environment (recommended):**
    ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows, use `venv\Scripts\activate`
    ```

3.  **Install dependencies:**
    ```bash
    pip install "fastapi[all]" "numpy" "pandas" "scipy" "tensorflow"
    ```

4.  **Add the TFLite Model:**
    Place your TFLite model file in the same directory as `main.py` and name it `Combined_Vision_Motion.tflite`.

5.  **Run the FastAPI server:**
    ```bash
    uvicorn main:app --reload
    ```
    The server will start on `http://127.0.0.1:8000`.

6.  **Expose with ngrok:**
    Open a new terminal and run:
    ```bash
    ngrok http 8000
    ```
    `ngrok` will give you a public URL (e.g., `https://xxxx-xx-xxx-xx-xx.ngrok-free.app`). Copy this URL.

## Frontend Setup

The frontend is a React application built with TypeScript and styled with Tailwind CSS.

1.  **Install dependencies:**
    In the root directory of the frontend files, run:
    ```bash
    npm install
    ```
    
    *Note: If you are in an environment that handles this for you, you can skip this step.*

2.  **Configure Environment Variable:**
    The frontend needs to know the URL of your running backend. Create a file named `.env.local` in the root of your frontend project (next to `index.html`).
    Add the following line, replacing the URL with your actual ngrok URL from the backend setup:
    ```
    VITE_NGROK_URL=https://xxxx-xx-xxx-xx-xx.ngrok-free.app
    ```
    
    **For Vercel Deployment:** Instead of a `.env.local` file, you must set this environment variable in your Vercel project settings. Go to your project's `Settings` > `Environment Variables` and add a new variable with the name `VITE_NGROK_URL`.

3.  **Run the development server:**
    ```bash
    npm run dev
    ```
    
    *Note: This command might vary based on your project setup (e.g., `vite`, `react-scripts start`). The application should start on a local port (e.g., `http://localhost:5173`).*

4.  **Use the Application:**
    - Open the frontend application in your browser.
    - Upload a valid JSON data file.
    - Click "Predict" to see the liveness detection result.

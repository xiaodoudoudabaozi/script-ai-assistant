FROM python:3.12-slim

WORKDIR /app

# 系统依赖（libgomp1 给 ONNX Runtime / OpenCV 用）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 libglib2.0-0 libxcb1 libx11-6 libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 预下载 RapidOCR 模型（避免首次运行等待）
RUN python -c "from rapidocr_onnxruntime import RapidOCR; ocr = RapidOCR(); print('RapidOCR ready')"

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

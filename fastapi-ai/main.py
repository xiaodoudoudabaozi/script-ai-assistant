"""
main.py - FastAPI 文档解析服务
POST /parse 接收 DOCX/PDF，返回纯文本 JSON
"""

import sys
import io
import hashlib
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from parse import parse


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("✅ FastAPI AI 服务已启动")
    yield
    print("🔻 FastAPI AI 服务已关闭")


app = FastAPI(
    title="剧本 AI 解析服务",
    version="1.0.0",
    lifespan=lifespan,
)

# 允许 Next.js 跨域调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3002",
        "http://localhost:3003",
        "http://127.0.0.1:3003",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """健康检查"""
    return {"status": "ok"}


@app.post("/parse")
async def parse_document(file: UploadFile = File(...)):
    """
    解析上传的 DOCX/PDF 文件，返回纯文本

    Returns:
        {
            "status": "success",
            "text": "解析后的纯文本",
            "md5": "文件的 MD5 校验值",
            "filename": "原始文件名",
            "size": "文件大小(字节)"
        }
    """
    # ---------- 1. 读取文件 ----------
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="文件内容为空")

    # ---------- 2. MD5 校验 ----------
    md5_hash = hashlib.md5(content).hexdigest()

    # ---------- 3. 解析 ----------
    try:
        text = parse(content, file.filename)
    except ValueError as e:
        raise HTTPException(status_code=415, detail=str(e))
    except Exception as e:
        import traceback
        error_detail = f"解析失败: {e}\n{traceback.format_exc()}"
        print(error_detail)  # 打印到控制台
        raise HTTPException(status_code=500, detail=error_detail)

    # 检测低质量提取结果
    is_low_text = len(text.strip()) < 50
    warning = None
    ext = file.filename.lower().split(".")[-1] if "." in file.filename else ""
    if is_low_text:
        if ext == "pdf":
            warning = "此PDF经OCR后仍未提取到足够文字，可能是纯图或低清晰度。"
        elif ext in ("png", "jpg", "jpeg"):
            warning = "此图片未识别到文字，可能是纯图或低清晰度。"
        else:
            warning = "文件文本内容过少，可能是扫描版或格式异常。"
    elif ext in ("png", "jpg", "jpeg"):
        warning = "图片OCR识别完成"  # 确认图片已被OCR处理

    return {
        "status": "success",
        "text": text,
        "md5": md5_hash,
        "filename": file.filename,
        "size": len(content),
        "warning": warning,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

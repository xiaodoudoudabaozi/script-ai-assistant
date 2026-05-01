"""debug_parse.py - 调试解析问题"""
import sys
import io
import hashlib

# 设置输出编码
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# 导入解析函数
from parse import parse

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

@app.post('/parse')
async def parse_document(file: UploadFile = File(...)):
    print(f'收到请求: {file.filename}')
    content = await file.read()
    print(f'文件大小: {len(content)}')
    md5_hash = hashlib.md5(content).hexdigest()
    print(f'MD5: {md5_hash}')
    try:
        text = parse(content, file.filename)
        print(f'解析成功, 文本长度: {len(text)}')
        return {'status': 'success', 'text': text, 'md5': md5_hash}
    except Exception as e:
        import traceback
        error = traceback.format_exc()
        print(f'解析错误: {error}')
        raise HTTPException(status_code=500, detail=str(e))

@app.get('/health')
async def health():
    return {'status': 'ok'}

import uvicorn
uvicorn.run(app, host='0.0.0.0', port=8000)
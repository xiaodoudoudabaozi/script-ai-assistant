"""
parse.py - 文档解析核心逻辑
支持 DOCX (.docx)、PDF (.pdf)、图片 (.png/.jpg/.jpeg) 提取纯文本
图片通过 RapidOCR 提取中英文
"""

import io
from typing import Union

# RapidOCR 全局单例
_ocr = None

def _get_ocr():
    global _ocr
    if _ocr is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr = RapidOCR()
    return _ocr


def parse_docx(content: bytes) -> str:
    """从 DOCX 文件字节流提取纯文本"""
    import docx
    doc = docx.Document(io.BytesIO(content))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n".join(paragraphs)


def parse_pdf(content: bytes, ocr_threshold: int = 50) -> str:
    """
    从 PDF 文件字节流提取纯文本，文本过少时自动启用 OCR
    ocr_threshold: 嵌入文本少于该字符数时判定为扫描版，走 OCR
    """
    import fitz
    doc = fitz.open(stream=content, filetype="pdf")
    text_parts = []
    for page in doc:
        t = page.get_text("text")
        if t.strip():
            text_parts.append(t.strip())
    text = "\n\n".join(text_parts)

    if len(text.strip()) >= ocr_threshold:
        return text

    # 嵌入文字太少，视为扫描版，逐页 OCR
    return _parse_pdf_ocr(content)


def _parse_pdf_ocr(content: bytes) -> str:
    """扫描版 PDF：逐页渲染为图片后用 RapidOCR 识别"""
    import fitz
    from PIL import Image
    import numpy as np

    doc = fitz.open(stream=content, filetype="pdf")
    ocr = _get_ocr()
    all_lines = []

    print(f"扫描版PDF，共 {len(doc)} 页，开始OCR...")
    for page_num, page in enumerate(doc):
        print(f"  OCR第 {page_num + 1}/{len(doc)} 页...")
        pix = page.get_pixmap(dpi=150)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        result, _ = ocr(np.array(img))
        if result:
            for line in result:
                text = line[1]
                if text and text.strip():
                    all_lines.append(text.strip())

    return "\n".join(all_lines)


def parse_image(content: bytes) -> str:
    """从图片字节流提取文字（RapidOCR）"""
    from PIL import Image
    img = Image.open(io.BytesIO(content))
    ocr = _get_ocr()
    import numpy as np
    result, _ = ocr(np.array(img))
    if not result:
        return ""
    lines = [line[1] for line in result]
    return "\n".join(lines)


def parse(content: bytes, filename: str) -> str:
    """
    主解析入口，根据文件扩展名分发到对应解析器
    """
    ext = filename.lower().split(".")[-1] if "." in filename else ""
    if ext == "docx":
        return parse_docx(content)
    elif ext == "pdf":
        return parse_pdf(content)
    elif ext in ("png", "jpg", "jpeg"):
        return parse_image(content)
    else:
        raise ValueError(f"不支持的文件格式: .{ext}，仅支持 .docx, .pdf, .png, .jpg, .jpeg")

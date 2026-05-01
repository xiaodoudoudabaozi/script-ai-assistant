import io
import fitz  # PyMuPDF

pdf_path = r"c:\Users\Tom\Desktop\剧本agent\郑宝珠B.pdf"
output_path = r"c:\Users\Tom\Desktop\剧本agent\郑宝珠B.txt"

def parse_pdf(content: bytes) -> str:
    """从 PDF 文件字节流提取纯文本（PyMuPDF / fitz）"""
    doc = fitz.open(stream=content, filetype="pdf")
    text_parts = []
    for page in doc:
        t = page.get_text("text")
        if t.strip():
            text_parts.append(t.strip())
    return "\n\n".join(text_parts)

# 读取PDF文件
with open(pdf_path, "rb") as f:
    pdf_content = f.read()

# 解析PDF
text = parse_pdf(pdf_content)

# 保存到文本文件
with open(output_path, "w", encoding="utf-8") as f:
    f.write(text)

print(f"PDF文字已提取并保存到: {output_path}")
print(f"\n提取的文字预览:\n{text[:500]}...")

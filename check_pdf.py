import fitz

pdf_path = r"c:\Users\Tom\Desktop\剧本agent\郑宝珠B.pdf"

doc = fitz.open(pdf_path)
print(f"PDF页数: {len(doc)}")
print()

for i, page in enumerate(doc):
    print(f"--- 第 {i+1} 页 ---")
    
    # 尝试获取文本
    text = page.get_text("text")
    print(f"文本长度: {len(text)}")
    print(f"文本内容: {repr(text[:200])}")
    print()
    
    # 检查页面上的图像
    images = page.get_images()
    print(f"图像数量: {len(images)}")
    for img in images:
        print(f"  图像信息: {img}")
    print()

# P0 基础设施文档

> 剧本杀店铺管理 Agent — P0 基础设施
> 更新于 2026-04-30

---

## 一、已完成的 P0 模块

| 模块 | 状态 | 说明 |
|------|------|------|
| Next.js 项目 | ✅ | `nextjs/` |
| docker-compose.yml | ✅ | 编排所有服务 |
| init-db.sql | ✅ | 数据库初始化 |
| FastAPI AI 服务 | ✅ | `fastapi-ai/` |
| 本地缓存逻辑 | ✅ | `nextjs/src/lib/cache.ts` + `parse.ts` |

---

## 二、FastAPI 文档解析服务

### 路径
```
fastapi-ai/
├── main.py          # FastAPI 主服务（POST /parse, GET /health）
├── parse.py          # 解析核心逻辑（DOCX/PDF → 纯文本）
├── requirements.txt  # Python 依赖
└── Dockerfile
```

### 依赖
```
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
python-docx>=1.1.0
PyMuPDF>=1.25.0
```

### 启动方式（本地）

**方式 A：直接运行**
```bash
cd fastapi-ai
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**方式 B：Docker**
```bash
cd fastapi-ai
docker build -t script-parser .
docker run -p 8000:8000 script-parser
```

### 接口说明

#### `POST /parse`
- **Content-Type**: `multipart/form-data`
- **Body**: `file`（DOCX 或 PDF 文件）
- **返回**:
```json
{
  "status": "success",
  "text": "解析后的纯文本",
  "md5": "文件 MD5 校验值",
  "filename": "原始文件名",
  "size": 12345
}
```
- 支持格式: `.docx`, `.pdf`

#### `GET /health`
- 健康检查，始终返回 `{"status": "ok"}`

### 验证
```bash
# 1. 启动服务后
curl http://localhost:8000/health

# 2. 测试解析（找一个 .docx 或 .pdf 文件）
curl -X POST http://localhost:8000/parse \
  -F "file=@/path/to/your/script.docx"
```

---

## 三、Next.js 本地缓存逻辑

### 文件
```
nextjs/src/lib/
├── cache.ts   # 缓存读写 + MD5 校验
└── parse.ts   # 解析流程（缓存优先 → API 回退）
```

### 缓存目录结构
```
/data/scripts/{id}/
├── parsed.txt   # 解析后的纯文本
└── meta.json    # 元数据（含原始文件 MD5）
```

### 核心函数

**cache.ts**
| 函数 | 说明 |
|------|------|
| `readCache(id, expectedMd5?)` | 读取缓存，返回 `string \| null` |
| `writeCache(id, text, fileMd5?)` | 写入缓存到 `/data/scripts/{id}/parsed.txt` |
| `deleteCache(id)` | 删除缓存目录 |
| `cacheExists(id)` | 检查缓存是否存在 |
| `md5(str)` | 字符串 MD5 |
| `md5Bytes(buf)` | 字节 MD5 |

**parse.ts**
| 函数 | 说明 |
|------|------|
| `parseScript(file, filename, scriptId, forceRefresh?)` | 完整解析流程 |
| `checkApiHealth()` | 检查 FastAPI 服务是否可用 |

### 解析流程
```
parseScript()
  ├── 1. 读缓存 → 命中 → 直接返回
  ├── 2. 未命中 → 调 POST /parse
  ├── 3. 写入本地缓存
  └── 4. 返回文本
```

### 环境变量
```bash
NEXT_PUBLIC_API_URL=http://localhost:8000   # FastAPI 服务地址（默认）
```

---

## 四、快速启动（完整流程）

```bash
# 1. 启动数据库（PostgreSQL）
docker compose up postgres -d

# 2. 初始化数据库
psql -h localhost -U postgres -d script_shop -f init-db.sql

# 3. 启动 FastAPI 服务
cd fastapi-ai && pip install -r requirements.txt && uvicorn main:app --port 8000

# 4. 启动 Next.js
cd nextjs && npm install && npm run dev
```

---

## 五、后续任务（P1）

- [ ] 剧本内容分析 API（角色提取、场景识别）
- [ ] Next.js 前端页面开发
- [ ] 用户认证模块
- [ ] 剧本上传 + AI 分析完整流程

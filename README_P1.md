# P1 模块一 · 剧本问答 MVP

## 完成状态
- [x] 剧本上传 → 解析 → 缓存
- [x] 全本 Prompt 组装
- [x] DeepSeek API 流式对话
- [x] 前端对话界面
- [x] 会话上下文（10轮）

## 产出文件

| 文件 | 用途 |
|------|------|
| `nextjs/src/app/api/scripts/upload/route.ts` | 剧本上传 API |
| `nextjs/src/lib/prompt.ts` | Prompt 组装 |
| `nextjs/src/lib/session.ts` | 会话管理 |
| `nextjs/src/app/api/chat/route.ts` | 对话 API |
| `nextjs/src/app/page.tsx` | 前端对话界面 |
| `.env.local` | 环境变量模板 |

## 启动步骤

### 1. 配置环境变量
```bash
cp .env.local nextjs/.env.local
# 编辑 nextjs/.env.local，填入 DEEPSEEK_API_KEY
```

### 2. 启动 Docker Compose（推荐）
```bash
docker-compose up -d
```
服务：
- Next.js: http://localhost:3000
- FastAPI: http://localhost:8000
- PostgreSQL: localhost:5432

### 3. 或分别启动（开发模式）

**FastAPI:**
```bash
cd fastapi-ai
pip install -r requirements.txt
uvicorn main:app --port 8000 --reload
```

**Next.js:**
```bash
cd nextjs
npm install
npm run dev
```

## 测试流程

1. 打开 http://localhost:3000
2. 选择/上传剧本
3. 发送问题测试对话

## API 接口

| Method | Path | 说明 |
|--------|------|------|
| POST | /api/scripts/upload | 上传剧本 |
| POST | /api/chat | 流式对话 |
| GET | /api/scripts/list | 剧本列表 |

---
*完成日期: 2026-04-30*
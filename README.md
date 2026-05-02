# 剧本杀AI店员助手

基于 Next.js 14 + DeepSeek API 的剧本杀门店智能运营系统，提供 AI 剧本解析、角色级智能问答、运营仪表盘、员工排班管理等一站式解决方案。

[![Docker](https://img.shields.io/badge/Docker-3%20containers-blue)](./docker-compose.yml)
[![Next.js](https://img.shields.io/badge/Next.js-14.2.35-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue)](https://www.postgresql.org/)

## 核心功能

### AI 剧本解析
- 支持 DOCX、PDF、TXT 多格式上传
- AI 自动分类（角色/线索/时间线/剧本）
- OCR 图片线索识别
- 解析进度实时显示

### 角色级智能问答
- 基于 RAG 的剧本知识问答
- **角色隔离**：员工只能查看自己角色的内容，防止剧透
- 引用溯源：答案标注来源段落
- 对话历史搜索
- SSE 流式输出 + 断点续传

### 运营仪表盘
- 本月问答统计
- 活跃员工排行
- 热门剧本分析
- 每日趋势图表

### 员工管理
- 角色权限控制（admin/leader/employee）
- 排班管理
- Kiosk 自助查询模式

### 剧本改编
- 在线改编剧本内容
- 版本历史管理
- 一键回退到任意版本
- 差异高亮对比

## 技术架构

```
Next.js 14 (Frontend)  Port: 3009
    |
    ├── API Routes (25个)
    │   /api/chat      - AI问答
    │   /api/scripts   - 剧本管理
    │   /api/employees - 员工管理
    │   /api/dashboard - 数据统计
    │
    ├── PostgreSQL 16  Port: 5432
    │
    └── FastAPI AI     Port: 8000
        Document Parsing + OCR
```

## 快速启动

### 环境要求
- Docker & Docker Compose
- DeepSeek API Key

### 1. 克隆项目
```bash
git clone https://github.com/xiaodoudoudabaozi/script-ai-assistant.git
cd script-ai-assistant
```

### 2. 配置环境变量
```bash
echo "DEEPSEEK_API_KEY=your_api_key_here" > .env
```

### 3. 启动服务
```bash
docker-compose up -d
```

### 4. 访问系统
- 前端界面: http://localhost:3009
- API 文档: http://localhost:8000/docs

## 项目结构

```
script-ai-assistant/
├── nextjs/                 # Next.js 前端 + API
│   ├── src/
│   │   ├── app/           # 页面路由
│   │   │   ├── page.tsx   # 主聊天页
│   │   │   ├── scripts/   # 剧本管理
│   │   │   ├── dashboard/ # 仪表盘
│   │   │   └── api/       # API路由 (25个)
│   │   ├── lib/           # 工具库
│   │   └── ...
│   ├── package.json
│   └── Dockerfile
├── fastapi-ai/             # Python AI服务
│   ├── main.py            # FastAPI入口
│   ├── parse.py           # 文档解析
│   └── Dockerfile
├── docker-compose.yml      # Docker编排
├── init-db.sql            # 数据库初始化
└── README.md
```

## 项目统计

| 指标 | 数值 |
|------|------|
| TypeScript 文件 | 44 个 |
| 总代码行数 | 5,553 行 |
| API 路由 | 25 个 |
| Git 提交 | 36 次 |
| Docker 容器 | 3 个 |
| 数据库表 | 9 张 |

## 安全特性

- JWT + Cookie 双认证
- bcrypt 密码加密
- 角色级权限控制
- API 路由统一认证中间件
- 输入验证与 SQL 注入防护

## 开发历程

- **v1.0** (2025-04) - 基础问答功能
- **v2.0** (2025-04) - 多文件上传 + AI分类 + 角色过滤 + 图片线索
- **v2.1** (2025-04) - P0完成：认证安全加固 + 搜索功能
- **v2.2** (2025-04) - P1完成：QA缓存 + 版本回退 + 引用溯源
- **v2.3** (2025-05) - P2完成：仪表盘 + Kiosk + 差异高亮 + 组长角色
- **v2.4** (2025-05) - 代码审查修复 + 部署优化

## 许可证

MIT License

---

> 本项目基于 OpenClaw 构建，使用 DeepSeek API 提供 AI 能力。

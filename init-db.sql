-- =====================================================
-- 剧本杀AI店员助手 - 数据库初始化脚本
-- 对齐技术规格文档 v1.9 + 后端代码实际使用
-- =====================================================

-- 应用设置表（LLM模型配置，规格文档2.3节）
CREATE TABLE IF NOT EXISTS app_settings (
    id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
    active_llm_model VARCHAR(50) DEFAULT 'deepseek-v4-pro',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 初始化默认模型
INSERT INTO app_settings (id, active_llm_model)
VALUES ('default', 'deepseek-v4-pro')
ON CONFLICT (id) DO NOTHING;

-- 员工表（规格文档5.3节）
CREATE TABLE IF NOT EXISTS employees (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    role          VARCHAR(20) NOT NULL DEFAULT 'staff',   -- staff / admin
    phone         VARCHAR(20),
    position      VARCHAR(50),                            -- DM / 前台 / 店长
    password_hash VARCHAR(255),                           -- bcrypt 加密存储
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 排班表（规格文档5.3节）
CREATE TABLE IF NOT EXISTS schedules (
    id            SERIAL PRIMARY KEY,
    employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date          DATE NOT NULL,
    shift         VARCHAR(20) NOT NULL,                   -- 上午 / 下午 / 全天 / 晚班
    role_in_shift VARCHAR(50) NOT NULL DEFAULT 'DM',     -- 当日角色：DM（某本）/ 前台 / 其他
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(employee_id, date, shift)
);

-- 剧本表（规格文档4.2.4节）
CREATE TABLE IF NOT EXISTS scripts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              VARCHAR(255) NOT NULL,
    version           INTEGER DEFAULT 1,
    author            VARCHAR(100),
    genre             VARCHAR(50),                        -- 硬核/情感/恐怖/欢乐/阵营/其他
    player_count      VARCHAR(20),                        -- 人数：如 "6人"、"6-8人"
    act_count         INTEGER,                            -- 幕数
    difficulty        VARCHAR(20),                        -- 简单/中等/困难
    duration          VARCHAR(20),                        -- 预计时长：如 "4-5小时"
    is_sensitive      BOOLEAN DEFAULT FALSE,
    sensitivity_note  TEXT,
    original_file_path VARCHAR(500),
    cached_text_path  VARCHAR(500),
    cache_checksum    VARCHAR(64),                        -- MD5 校验
    cached_at         TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 改编日志表（规格文档4.2.4节）
CREATE TABLE IF NOT EXISTS adaptation_logs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id       INTEGER REFERENCES employees(id),
    script_id         UUID REFERENCES scripts(id) ON DELETE CASCADE,
    adaptation_type   VARCHAR(50) NOT NULL,               -- element_replacement / plot_tweak / perspective_expand / manual_adapt
    instruction       TEXT,                               -- 管理员改编指令原文
    changes_summary   TEXT,                               -- AI 生成的改动摘要
    output_file_path  VARCHAR(500),                       -- 导出文件路径
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 操作日志表（规格文档4.2.4节）
CREATE TABLE IF NOT EXISTS operation_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       INTEGER REFERENCES employees(id),
    action        VARCHAR(50) NOT NULL,                   -- login / logout / query / permission_denied / model_switch / upload / delete
    detail        TEXT,                                   -- 操作详情
    ip_address    VARCHAR(45),
    user_agent    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 对话表（用户创建的每个对话线程）
CREATE TABLE IF NOT EXISTS conversations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    script_id     UUID NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
    title         VARCHAR(255) NOT NULL DEFAULT '新对话',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 对话历史表（服务端持久化，规格文档4.5.6节）
CREATE TABLE IF NOT EXISTS chat_history (
    id              SERIAL PRIMARY KEY,
    session_id      VARCHAR(100) NOT NULL,
    script_id       UUID NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL,
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 剧本文件表（多文件支持：DM手册/角色剧本/线索卡/其他）
CREATE TABLE IF NOT EXISTS script_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    script_id       UUID NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
    file_name       VARCHAR(255) NOT NULL,
    file_type       VARCHAR(50) NOT NULL DEFAULT 'other',   -- dm_manual / character_script / clue_card / other
    character_name  VARCHAR(100),
    cached_text_path VARCHAR(500),
    cache_checksum  VARCHAR(64),
    file_size       BIGINT,
    cached_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 问答缓存表（高频问答缓存，24h过期）
CREATE TABLE IF NOT EXISTS qa_cache (
    id              SERIAL PRIMARY KEY,
    script_id       UUID NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
    question_hash   VARCHAR(64) NOT NULL,
    question        TEXT NOT NULL,
    answer          TEXT NOT NULL,
    character_name  VARCHAR(100) DEFAULT '',
    hit_count       INT DEFAULT 1,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(script_id, question_hash, character_name)
);

-- 版本历史表（改编版本追踪）
CREATE TABLE IF NOT EXISTS script_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    script_id       UUID NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
    version_number  INT NOT NULL DEFAULT 1,
    label           VARCHAR(255) DEFAULT '',
    content         TEXT NOT NULL,
    source          VARCHAR(50) NOT NULL DEFAULT 'adaptation',
    adaptation_id   UUID REFERENCES adaptation_logs(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 索引
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_chat_session         ON chat_history(session_id, script_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversation    ON chat_history(conversation_id);
CREATE INDEX IF NOT EXISTS idx_qa_cache_lookup       ON qa_cache(script_id, question_hash, character_name);
CREATE INDEX IF NOT EXISTS idx_conversations_user    ON conversations(user_id, script_id);
CREATE INDEX IF NOT EXISTS idx_schedules_employee ON schedules(employee_id);
CREATE INDEX IF NOT EXISTS idx_schedules_date     ON schedules(date);
CREATE INDEX IF NOT EXISTS idx_scripts_name       ON scripts(name);
CREATE INDEX IF NOT EXISTS idx_scripts_genre      ON scripts(genre);
CREATE INDEX IF NOT EXISTS idx_adaptation_script  ON adaptation_logs(script_id);
CREATE INDEX IF NOT EXISTS idx_adaptation_operator ON adaptation_logs(operator_id);
CREATE INDEX IF NOT EXISTS idx_operation_user     ON operation_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_operation_time     ON operation_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_script_files_script ON script_files(script_id);
CREATE INDEX IF NOT EXISTS idx_versions_script ON script_versions(script_id, version_number DESC);

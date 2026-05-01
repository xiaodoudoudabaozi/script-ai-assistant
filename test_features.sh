#!/bin/bash
# 功能测试脚本（不调用DeepSeek API，不花钱）
set -e
BASE="http://localhost:3009"
PASS=0; FAIL=0

green() { echo -e "\033[32m  PASS\033[0m $1"; PASS=$((PASS+1)); }
red() { echo -e "\033[31m  FAIL\033[0m $1 ($2)"; FAIL=$((FAIL+1)); }
check_contains() { if echo "$2" | grep -qF "$3"; then green "$1"; else red "$1" "$2"; fi; }
check_code() { if [ "$2" = "$3" ]; then green "$1"; else red "$1" "HTTP $2, 期望 $3"; fi; }

echo "========================================"
echo "  功能测试"
echo "========================================"

# ── P0-2 JWT认证 ──
echo ""; echo "── P0-2 JWT认证 ──"

CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/scripts/list)
check_code "无cookie返回401" "$CODE" "401"

LOGIN=$(curl -s -c /tmp/tc.txt -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" -d '{"employeeId":"admin","password":"admin123"}')
check_contains "登录成功" "$LOGIN" '"success":true'

R=$(curl -s -b /tmp/tc.txt $BASE/api/scripts/list)
check_contains "带cookie访问API" "$R" '"name"'

R=$(curl -s -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" -d '{"employeeId":"admin","password":"wrong"}')
check_contains "错误密码被拒" "$R" '"error"'

# ── P1-4 chat_history类型 ──
echo ""; echo "── P1-4 chat_history类型修正 ──"

T=$(docker exec claude_code-postgres-1 psql -U postgres -d scriptstore -t -c \
  "SELECT data_type FROM information_schema.columns WHERE table_name='chat_history' AND column_name='script_id';" | tr -d ' ')
check_contains "script_id类型=uuid" "$T" "uuid"

FK=$(docker exec claude_code-postgres-1 psql -U postgres -d scriptstore -t -c \
  "SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_name='chat_history' AND constraint_name='fk_chat_history_script';" | tr -d ' ')
check_contains "FK约束存在" "$FK" "1"

# ── P0-1 搜索 ──
echo ""; echo "── P0-1 搜索对话历史 ──"

# 插入测试对话记录到chat_history
SID="20478a81-41ae-43e8-9368-f7a692685966"
docker exec claude_code-postgres-1 psql -U postgres -d scriptstore -c \
  "INSERT INTO conversations (id, user_id, script_id, title) VALUES ('00000000-0000-0000-0000-000000000001', 1, '$SID', '测试搜索') ON CONFLICT DO NOTHING;" > /dev/null 2>&1
docker exec claude_code-postgres-1 psql -U postgres -d scriptstore -c \
  "INSERT INTO chat_history (session_id, conversation_id, script_id, role, content) VALUES ('test', '00000000-0000-0000-0000-000000000001', '$SID', 'user', '请问凶手是谁？根据线索卡显示凶手的指纹在仓库被发现');" > /dev/null 2>&1 || true

SR=$(curl -s -b /tmp/tc.txt "$BASE/api/chat/search?q=%E5%87%B6%E6%89%8B")
check_contains "搜索'凶手'有结果" "$SR" '"conversationId"'

SR2=$(curl -s -b /tmp/tc.txt "$BASE/api/chat/search?q=a")
check_contains "短关键词返回空" "$SR2" '{"results":[]}'

# 清理测试数据
docker exec claude_code-postgres-1 psql -U postgres -d scriptstore -c \
  "DELETE FROM chat_history WHERE session_id='test'; DELETE FROM conversations WHERE id='00000000-0000-0000-0000-000000000001';" > /dev/null 2>&1

# ── P1-7 QA缓存 ──
echo ""; echo "── P1-7 QA缓存 ──"

TB=$(docker exec claude_code-postgres-1 psql -U postgres -d scriptstore -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='qa_cache';" | tr -d ' ')
check_contains "qa_cache表存在" "$TB" "1"

# 验证缓存写入（插入一条假缓存验证表可写入）
docker exec claude_code-postgres-1 psql -U postgres -d scriptstore -c \
  "INSERT INTO qa_cache (script_id, question_hash, question, answer, character_name) VALUES ('$SID', 'testhash123', '测试问题', '测试答案', '') ON CONFLICT DO NOTHING;" > /dev/null 2>&1
CACHE=$(docker exec claude_code-postgres-1 psql -U postgres -d scriptstore -t -c \
  "SELECT answer FROM qa_cache WHERE question_hash='testhash123';" | tr -d ' ')
check_contains "qa_cache可读写" "$CACHE" "测试答案"
docker exec claude_code-postgres-1 psql -U postgres -d scriptstore -c \
  "DELETE FROM qa_cache WHERE question_hash='testhash123';" > /dev/null 2>&1

echo ""; echo "========================================"
echo "  结果: $PASS 通过, $FAIL 失败"
echo "========================================"

# Git 回退操作教程

> 适用于：C:\Users\Tom\Desktop\claude_code  
> 创建日期：2026-05-01  
> 当前 commit 基线：071f6b8

---

## 一、基础概念

### 什么是 commit？
每做一次改动、执行 `git commit`，就等于给当前代码拍了一张快照（存档）。每个存档有一个唯一编号，叫 commit hash，比如 `92c6933`。

### 当前所有 commit
```
92c6933  P0-2: JWT认证
f20bd7a  P0-2: 认证中间件
f1b0b57  P1-7: 问答缓存
c11cee2  P0-1: 对话搜索
2ea4239  P1-4: chat_history类型修正
071f6b8  初始提交 — v2.1.0 基线
```

**重点：** 上面的在上，下面的是老的。每个新 commit 叠在老的上面。

---

## 二、如何查看当前状态

### 查看所有 commit
```
git log --oneline
```

### 查看改了哪些文件（还没 commit 的）
```
git status
```

### 查看具体改了什么
```
git diff
```

---

## 三、回退方法一：git revert（推荐，安全）

### 原理
`git revert` 是"反向操作"——不是你删掉那个 commit，而是再做一个新的 commit，把那个 commit 的改动全部撤销。**之前的 commit 都还在，随时可以回来。**

### 用法

假如你想撤掉 **QA 缓存**（f1b0b57），在终端敲：
```
cd C:\Users\Tom\Desktop\claude_code
git revert f1b0b57 --no-edit
```

`--no-edit` 意思是"用默认的提交消息，不用我写"。不加的话会弹出编辑器让你写消息。

撤销之后重启 Next.js 容器：
```
docker restart claude_code-nextjs-1
```

### 撤错了怎么办？
如果刚才 revert 的东西你又想要回来了，再 revert 一次刚才那个 revert 的 commit：
```
git revert <刚才revert生成的commit-hash> --no-edit
```
简单说：**revert 一个 revert 就是恢复。**

### 哪些功能对应哪些 commit

| 功能 | commit | 数据库改动 | 回退时需注意 |
|------|--------|-----------|-------------|
| JWT认证 | 92c6933 | 无 | 只改代码 |
| ~~认证中间件~~ | f20bd7a | 无 | 已被92c6933覆盖 |
| QA缓存 | f1b0b57 | 新建qa_cache表 | 表可以留着不管 |
| 对话搜索 | c11cee2 | 无 | 只改代码 |
| chat_history类型修正 | 2ea4239 | ALTER TABLE | 类型已改，revert后代码期望VARCHAR但DB是UUID |

---

## 四、回退方法二：git reset（激进，有风险）

### 原理
`git reset` 是"时光倒流"——直接回到某个 commit，**之后的 commit 全部删除**。代码会回到那个时间点的状态。

### 用法

**回到初始基线（删除所有改动）：**
```
cd C:\Users\Tom\Desktop\claude_code
git reset --hard 071f6b8
```

这行命令的意思是：回到 `071f6b8`（初始提交），之后的所有改动全部丢弃。

**回到某个中间状态（比如只保留类型修正和搜索）：**
```
git reset --hard c11cee2
```
这条只保留到"对话搜索"，放弃 JWT 认证和 QA 缓存。

### 比较 revert 和 reset

| | revert | reset --hard |
|------|--------|-------------|
| 安全性 | ✅ 安全，历史不丢 | ⚠️ 危险，commit被删 |
| 历史 | 保留所有commit | 之后的commit消失 |
| 能恢复吗 | 再revert一次就行 | 一般不能（除非记得hash） |
| 推荐场景 | 想撤某个功能 | 想彻底回到某个版本 |

**建议：优先用 revert。**

---

## 五、数据库改动怎么办？

Git 只管代码文件，不管数据库。回退代码后，数据库可能和代码不匹配。

### 哪些 commit 改了数据库？

**2ea4239（chat_history 类型修正）**：
- 执行了 `ALTER TABLE chat_history ALTER COLUMN script_id TYPE UUID`
- 如果 revert 这个 commit：代码回到 VARCHAR 写法，但数据库已经是 UUID。**通常兼容**（PostgreSQL 会自动转换），但最好保持 UUID 不要动。

**f1b0b57（QA 缓存）**：
- 新建了 `qa_cache` 表
- 如果 revert：代码不再查询这个表，表留在数据库里不碍事。

### 如果需要手动操作数据库
```
docker exec -it claude_code-postgres-1 psql -U postgres -d scriptstore
```
进入后可以执行 SQL 命令。退出按 `\q`。

---

## 六、实战场景

### 场景1：新功能有 bug，想撤掉
```
git revert <那个功能的commit-hash> --no-edit
docker restart claude_code-nextjs-1
```
去浏览器验证。如果发现撤错了：
```
git revert <刚才revert生成的hash> --no-edit
docker restart claude_code-nextjs-1
```

### 场景2：搞砸了，想全部重来
```
git reset --hard 071f6b8
```
代码回到最初状态。数据库改动需手动处理（见第五节）。

### 场景3：不确定要不要撤，想看那个 commit 改了什么
```
git show f1b0b57
```
显示那个 commit 的具体改动内容，看完再决定撤不撤。

### 场景4：撤完后悔了，reset 之后想恢复
如果你刚执行了 `git reset --hard` 但还没关终端，执行：
```
git reflog
```
会显示所有操作历史，找到 reset 之前的 commit hash，然后：
```
git reset --hard <你找到的hash>
```

---

## 七、命令速查

| 想做什么 | 命令 |
|---------|------|
| 看所有 commit | `git log --oneline` |
| 看当前改了啥 | `git status` |
| 安全撤掉某个 commit | `git revert <hash> --no-edit` |
| 彻底回到某个版本 | `git reset --hard <hash>` |
| 看某个 commit 的改动 | `git show <hash>` |
| 看操作历史（急救用） | `git reflog` |

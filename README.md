# Sakura-MCP-Server

**Sakura-MCP-Server** 是面向所有兼容 MCP 的 AI Agent 的多用户长期记忆平台。Claude、Cline、Cursor、Windsurf 及其他 Agent 可以在经过授权后，把事实、偏好、人物、事件、任务、项目、文档摘要和对话结论写入同一个可治理的记忆库，并在未来的会话中召回。

它不是某几个项目的专用网关。外部系统只会作为可选 Connector 接入通用记忆模型。

## 产品目标

- **跨 Agent 共享**：不同 AI Agent 使用相同 MCP URL 和各自的凭据访问长期记忆。
- **完整多用户**：每个用户都有个人空间，也可以创建共享空间并邀请成员。
- **可治理**：记忆包含来源、版本、重要性、置信度、敏感级别、有效期和删除状态。
- **可检索**：PostgreSQL 全文检索与 pgvector 语义检索组成混合召回。
- **自动整理**：可按空间开启记忆提取、合并和冲突检测。
- **隐私可选**：同时支持 OpenAI-compatible API 和本地 Ollama。
- **不锁定数据**：保留原始内容，支持导入、导出、备份和重新生成向量。

## v0.2.0 架构

```text
任意 MCP Agent                 Web 管理后台
      │                              │
      └──── HTTPS / Authentik ──────┘
                     │
            Sakura-MCP-Server
             ├─ MCP Streamable HTTP
             ├─ 用户 / 空间 / 成员 / Agent 权限
             ├─ 记忆版本、来源、关系、冲突与审计
             ├─ 自动整理 Worker
             ├─ OpenAI-compatible Provider
             └─ Ollama Provider
                     │
             PostgreSQL + pgvector
```

## 多租户权限

每个用户首次通过 Authentik 登录时自动创建个人空间。共享空间支持：

| 角色 | 能力 |
| --- | --- |
| `owner` | 管理空间、成员和所有记忆 |
| `admin` | 邀请成员、管理设置和记忆 |
| `editor` | 创建并编辑记忆 |
| `contributor` | 创建记忆 |
| `viewer` | 只读检索 |

Agent/API Key 的 scopes 与空间角色取交集；仅知道 `memory_id` 或 `space_id` 不能绕过权限。

核心 scopes：

```text
memory:read memory:write memory:update memory:delete memory:export
space:create space:manage member:manage agent:manage admin:system
```

### Agent API Key

正式 Agent Key 保存在 PostgreSQL，而不是共享 `.env` 密钥：

```text
agent_create              创建 Key，明文 token 只返回一次
agent_list                查看前缀、scope、到期、撤销和空间授权
agent_revoke              立即撤销 Key
agent_grant_space         授予指定空间和空间级 scopes
agent_revoke_space        移除指定空间授权
```

Token 形如 `sk_sakura_<prefix>_<random-secret>`。数据库只保存完整 token 的 SHA-256 哈希和非敏感前缀。认证时同时校验：

```text
Agent 全局 scopes
∩ Agent 对目标空间的 grants
∩ Agent 所属用户在目标空间的成员角色
```

Agent 只能列出明确授权的空间；撤销后下一次请求立即失效。创建、授权和撤销 Agent Key 必须由 Authentik 人工用户执行，Agent 不能自行创建子 Key。

## MCP Tools

当前核心工具：

```text
memory_remember             写入结构化长期记忆
memory_search               全文 + pgvector 混合搜索与过滤
memory_recall               根据当前上下文进行语义召回
memory_get                  获取单条记忆
memory_update               更新并保留版本
memory_forget               软删除或管理员永久删除
memory_extract              从文本提取候选长期记忆（不保存）
memory_extract_and_remember 从文本提取并保存长期记忆
memory_conflicts            查询待处理/已解决/已忽略冲突
memory_resolve_conflict     保留、合并或忽略冲突记忆
memory_link                 建立同空间记忆关系
memory_feedback             记录召回是否有用及纠正意见
memory_import               导入 JSON/Markdown 并返回任务摘要
memory_import_status        查询导入任务与逐条错误
memory_export               导出可迁移 JSON/Markdown
space_list                  列出个人与共享空间
space_create                创建共享空间
space_list_members          查看成员与角色
space_invite_member         创建限时、一次性邀请
space_accept_invitation     Authentik 邮箱匹配后接受邀请
agent_create                创建只显示一次的 Agent Key
agent_list                  列出 Agent 与空间授权
agent_revoke                撤销 Agent Key
agent_grant_space           配置空间级权限
agent_revoke_space          移除空间级权限
```

后续工具将聚焦异步重建、审计查询和大型文档分块。

## 记忆数据模型

每条记忆属于一个空间，并包含：

```text
type / content / summary / tags
importance / confidence / sensitivity
valid_from / valid_until / expires_at
source / source_agent / source_uri
status / supersedes_id
created_by / created_at / updated_at / last_accessed_at
embedding / relations / versions / feedback
```

数据库迁移位于 `migrations/`，已覆盖用户、空间、成员、邀请、Agent 凭据、Provider、记忆、向量、版本、来源、关系、冲突、反馈、导入任务和审计日志。

## AI Provider

### OpenAI-compatible

支持 `/chat/completions` 与 `/embeddings`：

```dotenv
OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1
OPENAI_COMPATIBLE_API_KEY=
OPENAI_COMPATIBLE_CHAT_MODEL=
OPENAI_COMPATIBLE_EMBEDDING_MODEL=
```

### Ollama

支持 `/api/chat` 与 `/api/embed`：

```dotenv
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_CHAT_MODEL=
OLLAMA_EMBEDDING_MODEL=
```

每个空间最终可独立选择 Provider、模型和是否启用自动提取。更换 embedding 模型时通过后台任务重新生成向量；模型调用失败不丢失原始记忆。

### 混合检索

配置空间的 Embedding Provider 后，`memory_search` 和 `memory_recall` 使用以下混合评分：

```text
60% 向量余弦相似度
25% PostgreSQL 全文相关度
10% 记忆重要性
 5% 记忆置信度
```

未配置 Provider、模型服务不可用或查询向量失败时，会明确回退到全文检索。创建和更新记忆时会生成/重建向量；失败会把 `memory_embeddings.status` 标记为 `failed` 并记录错误，但原始记忆、来源和版本不会丢失。

空间 AI 策略可在 Web 管理台配置：

- Provider 类型；
- Chat Model；
- Embedding Model；
- 自动提取；
- 自动合并；
- 冲突检测；
- 隐私模式。

隐私模式只允许本地 Ollama，拒绝把内容发送至 OpenAI-compatible Provider。不同空间可以使用不同维度的向量，因此当前使用精确 pgvector 检索；后续将按 Provider/模型/维度分区建立 HNSW 索引。

## 记忆治理

自动提取后的新记忆可按空间策略执行治理：

- 规范化内容完全相同：建立 `duplicate_of` 关系；
- 同维度向量相似度达到阈值：创建潜在冲突，等待人工确认；
- 不会仅凭模型或相似度自动删除旧事实；
- 开放状态下同一对记忆只允许一个冲突记录；
- 关系只能建立在同一空间，禁止自关联。

冲突支持四种处理：

```text
keep_a   保留 A，B 标记为 superseded
keep_b   保留 B，A 标记为 superseded
merge    将人工确认后的合并内容写入 A，B 标记为 superseded
dismiss  认为不存在冲突，保留两条记忆
```

所有替代和合并操作保留原记忆、来源、关系及版本历史，不进行物理删除。Web 管理后台提供“冲突确认”页面；冲突解决要求人工 Authentik 用户，Agent 不能自行裁决事实。`memory_feedback` 可记录某条召回是否有帮助及纠正内容，为后续排序优化提供依据。

## 导入、导出与 MCP Resources

支持 JSON 和 Markdown。单次导入最多 500 条、正文最多 5 MB；每条独立校验，一条失败不会回滚其他有效记忆。导入复用空间权限、Embedding 和治理，`ingestion_jobs` 保存总数、成功、失败及最多 100 条错误摘要。导出不包含 Provider API Key、OIDC Token、Session 或 Agent Secret。

支持资源浏览的 MCP 客户端可以读取：

```text
memory://spaces                    当前身份可访问的空间
memory://spaces/{spaceId}          空间和最近 100 条有效记忆
memory://memories/{memoryId}       单条结构化记忆
```

Resource URI 不是权限凭据；每次读取仍校验 Bearer 身份、Agent grant、空间成员关系和 `memory:read` scope。Web 管理台“记忆管理”页面提供导入、导出 JSON 和导出 Markdown。当前同步完成并记录任务，后续大文件会沿用同一任务协议迁移到 Worker。

## Docker 部署

要求 Docker Compose，配置包含 PostgreSQL 16 + pgvector 与 MCP 服务。

```bash
git clone https://github.com/Guyao146/Sakura-MCP-Server.git
cd Sakura-MCP-Server
cp .env.example .env
# 修改数据库密码、PUBLIC_BASE_URL，并生成 SETUP_TOKEN 和 CONFIG_ENCRYPTION_KEY
chmod 600 .env
docker compose up -d --build
```

生成安装密钥：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

请运行两次，分别填写：

```dotenv
SETUP_TOKEN=<第一次生成的值>
CONFIG_ENCRYPTION_KEY=<第二次生成的值>
```

`CONFIG_ENCRYPTION_KEY` 是长期主密钥，必须离线备份。丢失后，数据库中已加密的模型 API Key 无法恢复。

启动后访问：

```text
https://mcp.example.com/setup
```

## 安装向导

首次启动的中文 Web 安装向导包含四个步骤：

1. 输入服务器 `.env` 中的 `SETUP_TOKEN`，检查 PostgreSQL、pgvector 与迁移；
2. 配置并测试 Authentik Issuer、Audience、JWKS 和首位管理员邮箱；
3. 可选配置并测试 OpenAI-compatible 或 Ollama；
4. 确认配置加密密钥已备份，完成安装并锁定向导。

安装完成前：

- `/setup` 可打开安装页面；
- Setup 写接口必须携带 `X-Setup-Token`；
- `/mcp` 返回 `503 setup_required`，不会在未配置身份系统时对外提供记忆能力。

安装完成后：

- Setup 配置接口永久返回 `410 setup_locked`；
- Authentik 和 Provider 配置从数据库加载；
- OpenAI-compatible API Key 使用 AES-256-GCM 加密存储；
- 安装令牌不能用于重新开启向导。

Authentik Provider 应使用 Public Client + Authorization Code + PKCE，并注册精确回调地址：

```text
https://mcp.example.com/auth/callback
```

管理后台登录入口：

```text
https://mcp.example.com/auth/login
```

浏览器会话 Cookie 使用 `HttpOnly`、`SameSite=Lax`，HTTPS 部署下同时使用 `Secure`；数据库只保存 Session Token 的 SHA-256 哈希。退出登录后会话立即撤销。

管理后台地址：

```text
https://mcp.example.com/admin
```

当前 Web 管理后台支持：

- 查看个人空间和共享空间；
- 创建共享空间；
- 查看空间成员并生成邮箱绑定的一次性邀请；
- 按空间搜索、创建、编辑和软删除记忆；
- 创建只显示一次的 Agent Key；
- 查看 Agent scope、前缀、到期、使用和撤销状态；
- 为 Agent 配置空间级 scopes；
- 立即撤销 Agent Key。

所有管理 API 都从 HttpOnly Session 解析内部用户身份，不接受客户端传入 `user_id`。写请求还必须提供与 Session ID 绑定的 HMAC-SHA256 CSRF Token；页面中的服务端数据使用 DOM `textContent` 渲染，不将用户内容拼接进 HTML。

如果确需重新安装，应由服务器管理员先完成数据库备份，再通过受控维护流程重置 `installation_state`；不要向 Web 客户端提供“重置安装”按钮。

健康检查：

```bash
curl https://mcp.example.com/health
```

生产环境使用 `nginx-mcp.conf.example` 提供 HTTPS，仅开放 443，不直接暴露 PostgreSQL 和 3000 端口。

## Agent 连接

MCP URL：

```text
https://mcp.example.com/mcp
```

API Key 客户端使用：

```http
Authorization: Bearer <每个 Agent 独立的密钥>
```

支持 OAuth 的客户端通过 RFC 9728 元数据发现 Authentik：

```text
/.well-known/oauth-protected-resource/mcp
```

Authentik Token 必须有专属于 MCP Server 的 audience；服务不会把用户 Token 透传给模型 Provider。

## 本地开发

要求 Node.js 22+ 和可用的 PostgreSQL + pgvector。

```powershell
cd D:\Sakura-MCP-Server
Copy-Item .env.example .env
npm.cmd install
npm.cmd run check
npm.cmd run build
npm.cmd start
```

## 当前开发状态

`v0.1.0` 是早期安全 MCP 网关版本；当前直接在 `main` 持续开发通用记忆平台 `v0.2.0`。

已完成：

- 多租户数据库 Schema 与自动迁移；
- 个人/共享空间、成员角色和邮箱邀请仓库；
- 基础记忆 CRUD、来源、版本、全文检索；
- OpenAI-compatible 与 Ollama Provider；
- 通用记忆和空间 MCP Tools；
- API Key + Authentik JWT 双认证基础。
- 首次启动 Web 安装向导、数据库诊断、Provider 测试和安装锁；
- AES-256-GCM 服务端配置加密；
- 数据库 Agent Key、哈希认证、到期、撤销与空间级 scopes；
- Authentik Authorization Code + PKCE 浏览器登录与哈希 Session；
- Web 管理后台：空间、成员邀请、记忆 CRUD、Agent Key 与空间授权；
- OpenAI-compatible/Ollama Provider 管理与空间级 AI 策略；
- 记忆 Embedding、pgvector 混合检索和故障安全回退；
- LLM 候选记忆提取与批量保存；
- 重复检测、关系、反馈、冲突队列与人工解决；
- JSON/Markdown 导入导出、任务错误报告与 MCP Resources；

进行中：

- 异步任务队列和自动合并策略增强；
- 审计后台和跨租户安全测试。

未完成的功能不会以伪造数据或静默降级方式对外宣称可用。

## 自动测试与发布

推送分支会执行类型检查、单元测试和 Docker 构建。推送 `v*` tag 后自动运行测试、生成 npm tarball 并创建 GitHub Release。

## 许可证

GNU Lesser General Public License v2.1，详见 `LICENSE`。
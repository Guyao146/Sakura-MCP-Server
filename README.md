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

## MCP Tools

当前核心工具：

```text
memory_remember             写入结构化长期记忆
memory_search               全文搜索与过滤
memory_recall               根据当前上下文召回
memory_get                  获取单条记忆
memory_update               更新并保留版本
memory_forget               软删除或管理员永久删除
space_list                  列出个人与共享空间
space_create                创建共享空间
space_list_members          查看成员与角色
space_invite_member         创建限时、一次性邀请
space_accept_invitation     Authentik 邮箱匹配后接受邀请
```

后续工具：`memory_link`、`memory_ingest`、`memory_conflicts`、`memory_feedback`、`memory_export`、Agent Key 管理和空间策略管理。

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

## Docker 部署

要求 Docker Compose，配置包含 PostgreSQL 16 + pgvector 与 MCP 服务。

```bash
git clone https://github.com/Guyao146/Sakura-MCP-Server.git
cd Sakura-MCP-Server
cp .env.example .env
# 修改数据库密码、PUBLIC_BASE_URL、Authentik 和 bootstrap key
chmod 600 .env
docker compose up -d --build
```

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

`main` 的 `v0.1.0` 是早期安全 MCP 网关版本。`feature/ai-memory-v0.2` 正在重构为通用记忆平台。

已完成：

- 多租户数据库 Schema 与自动迁移；
- 个人/共享空间、成员角色和邮箱邀请仓库；
- 基础记忆 CRUD、来源、版本、全文检索；
- OpenAI-compatible 与 Ollama Provider；
- 通用记忆和空间 MCP Tools；
- API Key + Authentik JWT 双认证基础。

进行中：

- 完整 React Web 管理后台与 OIDC Browser Session；
- 数据库 Agent Key 的创建、哈希、撤销和空间授权；
- 异步自动提取、embedding、混合检索、合并与冲突确认；
- 导入导出、MCP Resources、审计后台和跨租户安全测试。

未完成的功能不会以伪造数据或静默降级方式对外宣称可用。

## 自动测试与发布

推送分支会执行类型检查、单元测试和 Docker 构建。推送 `v*` tag 后自动运行测试、生成 npm tarball 并创建 GitHub Release。

## 许可证

GNU Lesser General Public License v2.1，详见 `LICENSE`。
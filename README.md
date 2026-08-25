# Sakura EcoSystem MCP Server

面向 **Life Dashboard、Home Assistant 和 DSH** 的安全远程 MCP 网关。服务基于官方 MCP TypeScript SDK v2，提供 Streamable HTTP 端点：`https://你的域名/mcp`。

## 当前能力

- Bearer API Key 与 Authentik JWT（OIDC）双认证；二者共用 scope 权限模型。
- RFC 9728 Protected Resource Metadata：`/.well-known/oauth-protected-resource/mcp`。
- 每请求无状态 MCP transport：认证和工具权限绝不跨客户端会话复用。
- 仅在配置相应 Adapter 后注册业务工具：
  - Home Assistant：查询实体状态、控制白名单实体、激活白名单场景；
  - Life Dashboard 内部 API：读取生活总览、DSH 工作区摘要、发送 DSH follow-up；
  - JSON Lines 审计日志。
- Docker、Nginx、GitHub CI 和 `v*` tag 自动创建 GitHub Release。

> 不会对 Agent 暴露 Home Assistant Token、Authentik Token、DSH 配对密钥或服务器 Shell。

## 本地启动

要求 Node.js 22+。Windows PowerShell 若禁止 `npm.ps1`，使用 `npm.cmd`。

```powershell
cd D:\Sakura-MCP-Server
Copy-Item .env.example .env
# 编辑 .env：至少替换 PUBLIC_BASE_URL 和 MCP_API_KEYS 中的示例 secret
npm.cmd install
npm.cmd run check
npm.cmd run build
npm.cmd start
```

验证健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

## API Key 格式与 Scope

`MCP_API_KEYS` 是逗号分隔的条目，格式为：

```dotenv
MCP_API_KEYS=cline-prod:一个至少32字节的随机密钥:life:read|home:read|dsh:summary,automation:另一个随机密钥:home:control
```

生成密钥：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

可用 scopes：`life:read`、`home:read`、`home:control`、`todo:read`、`todo:write`、`dsh:summary`、`dsh:details`、`dsh:followup`。

客户端需在 MCP 远程服务设置中填写：

```text
URL: https://mcp.example.com/mcp
Authorization: Bearer <分配给该 Agent 的密钥>
```

不同 Agent 的 UI 配置字段不同；只要它支持带 Authorization 请求头的 Streamable HTTP MCP，即可使用上述 URL。请为每个 Agent 创建不同 API Key，且只授予所需 scope。

## Authentik OIDC / OAuth

配置完整的 `AUTHENTIK_ISSUER`、`AUTHENTIK_AUDIENCE` 与 `AUTHENTIK_JWKS_URI` 后，服务会验证 JWT 的签发者、受众、过期时间和签名；标准 `scope` claim（或 `AUTHENTIK_SCOPE_CLAIM` 指定的 claim）将映射为 MCP scopes。

当前实现是 MCP **Resource Server**，可接受 Authentik 签发、且 audience 专属于 MCP 服务的 Bearer JWT。远程 OAuth 客户端还需要在 Authentik 创建 OAuth 2.1 Provider，启用 Authorization Code + PKCE、精确 redirect URI、scope 映射和 audience。不要把收到的 MCP 用户 JWT 转发到 Home Assistant 或 Life Dashboard；Adapter 必须使用自己的服务凭据。

## 业务 Adapter 配置

### Home Assistant

设置 `HOME_ASSISTANT_URL` 和一个专用最小权限 Token。写操作只有在对应白名单变量显式列出资源时才会注册/成功：

```dotenv
HOME_ASSISTANT_CONTROLLABLE_ENTITIES=light.living_room,switch.coffee_machine
HOME_ASSISTANT_ALLOWED_SCENES=scene.good_night
```

### Life Dashboard / DSH

现有 `config.php` 是浏览器 OIDC 网关，不能由 MCP Server 冒充浏览器调用。请在 Life Dashboard 后续增加专用的**内部服务 API**，使用独立 service token，并保持最小返回字段。该项目预留：

```text
GET  /internal/mcp/overview
GET  /internal/mcp/dsh/workspaces
POST /internal/mcp/dsh/followups
```

配置 `LIFE_DASHBOARD_INTERNAL_URL` 与 `LIFE_DASHBOARD_INTERNAL_TOKEN` 后才会注册对应工具。DSH 仍应沿用现有一次性配对、HMAC、防重放、详情显式授权、8,000 字符和 120 秒命令队列限制。

## Docker 与 Nginx 部署

服务器上：

```bash
cp .env.example .env
# 填写真实配置，并 chmod 600 .env
mkdir -p data
docker compose up -d --build
```

容器默认只绑定服务器本机 `127.0.0.1:3000`。使用 `nginx-mcp.conf.example` 配置 HTTPS 反向代理，必须保留 `Authorization` 请求头。生产环境仅开放 443，不要直接暴露 3000。

## 发布

推送 `main` 会运行类型检查、单元测试与 Docker 构建。创建并推送语义化 tag 后会自动执行测试、`npm pack`，并创建 GitHub Release：

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 当前限制与下一步

第一版已经完成 MCP 协议、认证、权限、HA 适配器和部署骨架。待你提供服务器域名、Authentik Provider 信息与 Life Dashboard 内部 API 后，下一步将完成真实 OAuth 浏览器授权互操作测试、Life Dashboard PHP 内部 API、To Do/日历工具与生产部署验证。
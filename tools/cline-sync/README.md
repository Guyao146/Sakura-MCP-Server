# Sakura Cline Sync

把 Cline 的本地对话历史定时同步到 Sakura-MCP-Server，自动抽取长期记忆。托盘常驻 + 本地配置面板，不需要手动触发。

## 它解决什么问题

MCP 是「工具」而非「监听器」：服务端看不到你和模型的对话，只有客户端主动调用工具时才写入。靠 `.clinerules` 让模型自己在结尾调 `memory_extract_and_remember` 并不可靠——模型会忘。

本工具改为读取 Cline 落盘的对话历史，定时增量推送，是文件级的硬采集，不依赖模型自觉。

## 工作方式

```text
定时扫描 Cline 任务目录
  → 按 taskId 对比游标，只取新增消息
  → 脱敏（默认开启）
  → 调用 memory_extract_and_remember，由服务端抽取并入库
  → 成功后推进游标；失败保持原位，下次重试
```

Cline 的历史目录（Windows）：

```text
%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\tasks\<taskId>\api_conversation_history.json
```

macOS 与 Linux 会自动换成对应的 `globalStorage` 路径，也可以在面板里手动指定。

## 安装与运行

```bash
cd tools/cline-sync
npm install
npm run build
node dist/main.js
```

开发期直接用 `npm run dev`（tsx，无需先编译）。

首次启动会打印配置面板地址，例如 `http://127.0.0.1:53124/?token=...`。托盘菜单里点「打开配置面板」也是同一个地址。

## 配置项

| 项 | 说明 |
| --- | --- |
| MCP 地址 | `https://<你的域名>/mcp` |
| Agent 密钥 | 后台「Agent 密钥」创建，需 `memory:write` 权限 |
| Cline 任务目录 | 留空自动检测 |
| 扫描间隔 | 默认 10 分钟，1–1440 |
| 忽略早于 | 默认 30 天，0 表示不限 |
| 上传前脱敏 | 默认开启 |
| 启用自动同步 | 关闭时只能手动触发 |

配置与游标存放位置（Windows）：`%APPDATA%\sakura-cline-sync\`，其中 `config.json` 含密钥，以 `0600` 权限写入。

## 托盘菜单

打开配置面板、立即同步、状态显示（每 5 秒刷新）、暂停/恢复自动同步、退出。若系统不支持托盘，程序会退回控制台模式继续运行而不是退出。

## 命令行

```bash
npm run dry-run     # 干跑：只报告会上传什么，不联网
npm run sync-once   # 执行一次同步后退出，适合 cron / 计划任务
```

## 安全说明

- 配置面板只监听 `127.0.0.1`，且每次启动生成随机 token，网络上无法访问。
- 面板返回配置时密钥是掩码的；提交时留空即保留原值。
- 脱敏覆盖 `sk_sakura_`、`sk-`、`ghp_`、`xox*`、`AKIA`、JWT、`Authorization: Bearer`、PEM 私钥块，以及 `password=`/`token:` 这类键值对。这是尽力而为的防护，不是保证——本工具会把整段对话送去抽取，敏感项目请谨慎启用。
- 认证走 Agent 密钥（Bearer），不涉及 OAuth 与动态客户端注册。

## 成本提示

`memory_extract_and_remember` 每次调用都会消耗服务端配置的 Chat Provider 额度。增量游标已经避免了重复抽取，但活跃对话仍会每个周期产生一次调用。想更省可以把扫描间隔拉长，或把「忽略早于」调小。

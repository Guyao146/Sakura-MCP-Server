#!/usr/bin/env bash
set -Eeuo pipefail

# Safe first-run installer for Linux servers. It creates .env locally and never
# prints generated secrets. Run from the repository root.

if [[ ! -f docker-compose.yml || ! -f .env.example ]]; then
  echo "请在 Sakura-MCP-Server 仓库根目录执行此脚本。" >&2
  exit 1
fi

if [[ -e .env ]]; then
  echo ".env 已存在，为避免覆盖密钥，安装脚本停止。"
  echo "如需重新生成，请先备份并删除 .env，然后重新执行。"
  exit 1
fi

command -v openssl >/dev/null || { echo "缺少 openssl，请先安装：sudo apt install openssl" >&2; exit 1; }
command -v docker >/dev/null || { echo "缺少 Docker，请先安装 Docker。" >&2; exit 1; }
docker compose version >/dev/null || { echo "缺少 Docker Compose v2。" >&2; exit 1; }

public_url="${1:-}"
if [[ -z "$public_url" ]]; then
  read -r -p "请输入 MCP 公网 HTTPS 地址（例如 https://mcp.example.com）：" public_url
fi

build_context="${SAKURA_MCP_BUILD_CONTEXT:-.}"
if [[ ! "$public_url" =~ ^https://[^/]+$ ]]; then
  echo "公网地址必须是类似 https://mcp.example.com 的 HTTPS 地址。" >&2
  exit 1
fi

generate_secret() { openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n'; }
database_password="$(generate_secret)"
setup_token="$(generate_secret)"
encryption_key="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
bootstrap_secret="$(generate_secret)"

cp .env.example .env
sed -i \
  -e "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=$public_url#" \
  -e "s#^SAKURA_MCP_BUILD_CONTEXT=.*#SAKURA_MCP_BUILD_CONTEXT=$build_context#" \
  -e "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=$database_password#" \
  -e "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://sakura:$database_password@postgres:5432/sakura_memory#" \
  -e "s#^SETUP_TOKEN=.*#SETUP_TOKEN=$setup_token#" \
  -e "s#^CONFIG_ENCRYPTION_KEY=.*#CONFIG_ENCRYPTION_KEY=$encryption_key#" \
  -e "s#^MCP_API_KEYS=.*#MCP_API_KEYS=bootstrap-admin:$bootstrap_secret:memory:read|memory:write|memory:update|memory:delete|memory:export|space:create|space:manage|member:manage|agent:manage|admin:system#" \
  .env

chmod 600 .env
mkdir -p data
chmod 700 data

echo "正在构建并启动 PostgreSQL + Sakura-MCP-Server……"
docker compose up -d --build

echo
echo "部署已启动。"
echo "安装向导：$public_url/setup"
echo "健康检查：$public_url/health"
echo
echo "重要：SETUP_TOKEN 和 CONFIG_ENCRYPTION_KEY 已写入 $PWD/.env。"
echo "请立即安全备份 .env 和 CONFIG_ENCRYPTION_KEY，不要提交到 Git。"
echo "下一步请先配置 Nginx HTTPS，再打开安装向导。"
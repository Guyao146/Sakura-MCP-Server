# Upgrade to Sakura-MCP-Server 0.2

Version 0.2 changes Sakura-MCP-Server into a PostgreSQL-backed multi-user AI memory platform.

## Before upgrading

1. Back up the current `.env` and reverse-proxy configuration.
2. Generate and securely back up independent `SETUP_TOKEN` and `CONFIG_ENCRYPTION_KEY` values.
3. Provision PostgreSQL 16 with the pgvector extension, or use the included Compose service.
4. Configure an Authentik Public OAuth client with Authorization Code + PKCE.
5. Register the exact redirect URI: `https://mcp.example.com/auth/callback`.

## Upgrade

```bash
git pull --ff-only
cp .env.example .env.new
# Merge required values into the existing .env; do not overwrite secrets blindly.
docker compose pull
docker compose up -d --build
docker compose logs -f sakura-mcp
```

新部署也可以直接运行仓库中的 `scripts/install.sh`。脚本只适用于没有 `.env` 的首次部署，发现已有 `.env` 会停止，不会覆盖现有密钥。

With `AUTO_MIGRATE=true`, migrations run in filename order at startup. Do not delete entries from `schema_migrations`.

For a fresh 0.2 deployment, visit `/setup`. An installation already marked complete will return `410 setup_locked` and cannot be reset through the browser.

## Verify

```bash
curl -fsS https://mcp.example.com/health
curl -I https://mcp.example.com/admin
docker compose ps
```

Verify `.env` is mode `600`, port 3000 is bound only to `127.0.0.1`, PostgreSQL is not published, and HTTPS is mandatory.

## Rollback

Application rollback is possible by deploying an earlier image, but database migrations are forward-only. Before rollback, restore the PostgreSQL backup taken before upgrade. Never attempt to manually remove enum values, columns or migration records from a live database.

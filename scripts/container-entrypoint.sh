#!/bin/sh
set -eu

secret_file=/run/sakura-secrets/app.env
if [ ! -r "$secret_file" ]; then
  echo "Sakura-MCP-Server secret volume is not initialized." >&2
  exit 1
fi

. "$secret_file"
export POSTGRES_PASSWORD SETUP_TOKEN CONFIG_ENCRYPTION_KEY MCP_API_KEYS
export DATABASE_URL="postgresql://sakura:${POSTGRES_PASSWORD}@postgres:5432/sakura_memory"

exec node /app/dist/index.js
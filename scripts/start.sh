#!/bin/sh

# Map Zeabur-provided variables to app's expected names
export DATABASE_URL="${DATABASE_URL:-$POSTGRES_CONNECTION_STRING}"
export REDIS_URL="${REDIS_URL:-$REDIS_CONNECTION_STRING}"

echo "[joy] Running database migration..."
timeout 30 npx drizzle-kit push --force 2>&1 || echo "[joy] Migration warning (may be first run or timed out)"
echo "[joy] Starting server..."
exec node server.js

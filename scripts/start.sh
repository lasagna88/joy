#!/bin/sh
echo "[joy] Running database migration..."
npx drizzle-kit push --force 2>&1 || echo "[joy] Migration warning (may be first run)"
echo "[joy] Starting server..."
exec node server.js

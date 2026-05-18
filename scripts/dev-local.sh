#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${ENV_FILE:-$(if [ -f .env.worktree ]; then printf '%s' .env.worktree; else printf '%s' .env; fi)}"
LOG_DIR="${LOG_DIR:-/tmp/multica-dev}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

export POSTGRES_MODE="${POSTGRES_MODE:-external}"
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:${PORT:-8080}}"
export NEXT_PUBLIC_WS_URL="${NEXT_PUBLIC_WS_URL:-ws://localhost:${PORT:-8080}/ws}"
export MULTICA_SERVER_URL="${MULTICA_SERVER_URL:-ws://localhost:${PORT:-8080}/ws}"
export MULTICA_APP_URL="${MULTICA_APP_URL:-http://localhost:${FRONTEND_PORT:-3000}}"

mkdir -p "$LOG_DIR"

echo "==> Using env file: $ENV_FILE"
echo "==> Backend:  http://localhost:${PORT:-8080}"
echo "==> Frontend: http://localhost:${FRONTEND_PORT:-3000}"
echo "==> Postgres: localhost:${POSTGRES_PORT:-5432} (external)"

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies..."
  pnpm install
fi

bash scripts/ensure-postgres.sh "$ENV_FILE"

echo "==> Running migrations..."
(cd server && go run ./cmd/migrate up)

echo "==> Starting backend and frontend..."
trap 'kill 0' EXIT
(cd server && exec go run ./cmd/server) &
pnpm dev:web &
wait

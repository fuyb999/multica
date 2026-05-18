#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ---------- Check prerequisites ----------
missing=()
command -v node >/dev/null 2>&1 || missing+=("node")
command -v pnpm >/dev/null 2>&1 || missing+=("pnpm")
command -v go >/dev/null 2>&1 || missing+=("go")
command -v docker >/dev/null 2>&1 || missing+=("docker")

if [ ${#missing[@]} -gt 0 ]; then
  echo "✗ Missing prerequisites: ${missing[*]}"
  echo "  Please install: Node.js v20+, pnpm v10.28+, Go v1.26+, Docker"
  exit 1
fi

# ---------- Environment file ----------
if [ -n "${ENV_FILE:-}" ]; then
  :
elif [ -f .git ]; then
  # Inside a git worktree (.git is a file, not a directory)
  ENV_FILE=".env.worktree"
  if [ ! -f "$ENV_FILE" ]; then
    echo "==> Worktree detected. Generating $ENV_FILE..."
    bash scripts/init-worktree-env.sh "$ENV_FILE"
  fi
else
  ENV_FILE=".env"
  if [ ! -f "$ENV_FILE" ]; then
    echo "==> Creating $ENV_FILE from .env.example..."
    cp .env.example "$ENV_FILE"
  fi
fi

echo "==> Using $ENV_FILE"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

# ---------- Install dependencies ----------
if [ ! -d node_modules ]; then
  echo "==> Installing dependencies..."
  pnpm install
fi

# ---------- Database ----------
bash scripts/ensure-postgres.sh "$ENV_FILE"

echo "==> Running migrations..."
(cd server && go run ./cmd/migrate up)

# ---------- Start services ----------
echo ""
echo "✓ Ready. Starting services..."
echo "  If :${PORT:-8080} or :${FRONTEND_PORT:-3000} is already in use, the daemon will reuse the existing process."
start_supervisor() {
  local log_dir="${LOG_DIR:-/tmp/multica-dev}"
  if command -v screen >/dev/null 2>&1; then
    if ! screen -ls 2>/dev/null | grep -q "[.]multica-dev[[:space:]]"; then
      screen -dmS multica-dev env ENV_FILE="$ENV_FILE" LOG_DIR="$log_dir" bash scripts/dev-daemon.sh
    fi
  else
    ENV_FILE="$ENV_FILE" LOG_DIR="$log_dir" nohup bash scripts/dev-daemon.sh >/dev/null 2>&1 &
  fi
}

start_supervisor
echo "  Supervisor log: ${LOG_DIR:-/tmp/multica-dev}/supervisor.log"
echo "  Backend log:    ${LOG_DIR:-/tmp/multica-dev}/backend.log"
echo "  Frontend log:   ${LOG_DIR:-/tmp/multica-dev}/frontend.log"
echo "  To stop:        make stop ENV_FILE=$ENV_FILE"

#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${ENV_FILE:-$(if [ -f .env.worktree ]; then printf '%s' .env.worktree; else printf '%s' .env; fi)}"
LOG_DIR="${LOG_DIR:-/tmp/multica-dev}"
SUPERVISOR_LOG="${SUPERVISOR_LOG:-${LOG_DIR}/supervisor.log}"
BACKEND_LOG="${LOG_DIR}/backend.log"
FRONTEND_LOG="${LOG_DIR}/frontend.log"
PID_DIR="${PID_DIR:-${LOG_DIR}/pids}"
SUPERVISOR_PID_FILE="${PID_DIR}/supervisor.pid"
BACKEND_PID_FILE="${PID_DIR}/backend.pid"
FRONTEND_PID_FILE="${PID_DIR}/frontend.pid"

mkdir -p "$LOG_DIR" "$PID_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

exec >>"$SUPERVISOR_LOG" 2>&1

is_alive() {
  local pid_file=$1
  [ -s "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

port_in_use() {
  local port=$1
  lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

port_healthy() {
  local port=$1 path=${2:-/}
  curl -sf --max-time 2 "http://localhost:${port}${path}" >/dev/null 2>&1
}

reclaim_port() {
  local port=$1
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    return 0
  fi

  echo "Reclaiming stale listener on :$port (pids: $pids)"
  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done

  local waited=0
  while port_in_use "$port"; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge 10 ]; then
      echo "Force killing stale listener on :$port"
      for pid in $pids; do
        kill -9 "$pid" 2>/dev/null || true
      done
      break
    fi
  done
}

start_backend() {
  if is_alive "$BACKEND_PID_FILE"; then
    return
  fi

  if port_in_use "${PORT:-8080}" && port_healthy "${PORT:-8080}" /health; then
    return
  fi

  if port_in_use "${PORT:-8080}"; then
    reclaim_port "${PORT:-8080}"
  fi

  echo "Starting backend on :${PORT:-8080}..."
  nohup bash -lc "cd '$REPO_ROOT/server' && exec go run ./cmd/server" >>"$BACKEND_LOG" 2>&1 &
  echo $! >"$BACKEND_PID_FILE"
}

start_frontend() {
  if is_alive "$FRONTEND_PID_FILE"; then
    return
  fi

  if port_in_use "${FRONTEND_PORT:-3000}" && port_healthy "${FRONTEND_PORT:-3000}" /; then
    return
  fi

  if port_in_use "${FRONTEND_PORT:-3000}"; then
    reclaim_port "${FRONTEND_PORT:-3000}"
  fi

  echo "Starting frontend on :${FRONTEND_PORT:-3000}..."
  nohup bash -lc "cd '$REPO_ROOT' && exec pnpm dev:web" >>"$FRONTEND_LOG" 2>&1 &
  echo $! >"$FRONTEND_PID_FILE"
}

cleanup() {
  if is_alive "$BACKEND_PID_FILE"; then
    kill "$(cat "$BACKEND_PID_FILE")" 2>/dev/null || true
  fi
  if is_alive "$FRONTEND_PID_FILE"; then
    kill "$(cat "$FRONTEND_PID_FILE")" 2>/dev/null || true
  fi
  rm -f "$BACKEND_PID_FILE" "$FRONTEND_PID_FILE" "$SUPERVISOR_PID_FILE"
}

trap cleanup INT TERM EXIT

echo "$$" >"$SUPERVISOR_PID_FILE"

echo "Supervisor PID: $$"
echo "Logs:"
echo "  supervisor: $SUPERVISOR_LOG"
echo "  backend:    $BACKEND_LOG"
echo "  frontend:   $FRONTEND_LOG"

while true; do
  start_backend
  start_frontend

  sleep 2

  if ! is_alive "$BACKEND_PID_FILE"; then
    echo "Backend stopped; restarting..."
    rm -f "$BACKEND_PID_FILE"
    sleep 1
    continue
  fi

  if ! is_alive "$FRONTEND_PID_FILE"; then
    echo "Frontend stopped; restarting..."
    rm -f "$FRONTEND_PID_FILE"
    sleep 1
  fi
done

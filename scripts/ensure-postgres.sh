#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  echo "Create .env from .env.example, or run 'make worktree-env' and use .env.worktree."
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

POSTGRES_DB="${POSTGRES_DB:-multica}"
POSTGRES_USER="${POSTGRES_USER:-multica}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-multica}"
DATABASE_URL="${DATABASE_URL:-}"
POSTGRES_MODE="${POSTGRES_MODE:-auto}"

export PGPASSWORD="$POSTGRES_PASSWORD"

db_host=""
db_port="${POSTGRES_PORT:-5432}"
db_name="$POSTGRES_DB"

parse_database_url() {
  local rest authority hostport path port_part

  rest="${DATABASE_URL#*://}"
  rest="${rest%%\?*}"
  authority="${rest%%/*}"
  path="${rest#*/}"

  if [ "$authority" = "$rest" ]; then
    path=""
  fi

  hostport="${authority##*@}"

  if [[ "$hostport" == \[* ]]; then
    db_host="${hostport#\[}"
    db_host="${db_host%%]*}"
    port_part="${hostport#*\]}"
    if [[ "$port_part" == :* ]] && [ -n "${port_part#:}" ]; then
      db_port="${port_part#:}"
    fi
  else
    db_host="${hostport%%:*}"
    if [[ "$hostport" == *:* ]] && [ -n "${hostport##*:}" ]; then
      db_port="${hostport##*:}"
    fi
  fi

  if [ -n "$path" ]; then
    db_name="${path%%/*}"
  fi
}

if [ -n "$DATABASE_URL" ]; then
  parse_database_url
fi

is_local() {
  [ -z "$DATABASE_URL" ] || [ "$db_host" = "localhost" ] || [ "$db_host" = "127.0.0.1" ] || [ "$db_host" = "::1" ]
}

wait_for_connection() {
  if command -v pg_isready > /dev/null 2>&1; then
    echo "==> Waiting for PostgreSQL at $db_host:$db_port to be ready..."
    until pg_isready -d "$DATABASE_URL" > /dev/null 2>&1; do
      sleep 1
    done
    echo "✓ PostgreSQL ready ($db_host:$db_port). Database: $db_name"
    return 0
  fi

  if command -v psql > /dev/null 2>&1; then
    echo "==> Waiting for PostgreSQL connection to succeed..."
    until psql "$DATABASE_URL" -Atqc "SELECT 1" > /dev/null 2>&1; do
      sleep 1
    done
    echo "✓ PostgreSQL ready ($db_host:$db_port). Database: $db_name"
    return 0
  fi

  echo "==> PostgreSQL client tools not found. Skipping connection preflight."
  echo "✓ PostgreSQL configured ($db_host:$db_port). Database: $db_name"
}

use_docker=false
if is_local && [ "$POSTGRES_MODE" != "external" ] && [ "$db_port" = "5432" ]; then
  use_docker=true
fi

if [ "$use_docker" = true ]; then
  compose_cmd() {
    if docker compose version >/dev/null 2>&1; then
      printf '%s\n' "docker compose"
      return 0
    fi
    if command -v docker-compose >/dev/null 2>&1; then
      printf '%s\n' "docker-compose"
      return 0
    fi
    echo "Missing Docker Compose: install 'docker compose' or 'docker-compose'"
    exit 1
  }

  COMPOSE_CMD="$(compose_cmd)"
  COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

  echo "==> Ensuring shared PostgreSQL container is running on localhost:${POSTGRES_PORT}..."
  $COMPOSE_CMD -f "$COMPOSE_FILE" up -d postgres

  echo "==> Waiting for PostgreSQL to be ready..."
  until $COMPOSE_CMD -f "$COMPOSE_FILE" exec -T postgres pg_isready -U "$POSTGRES_USER" -d postgres > /dev/null 2>&1; do
    sleep 1
  done

  echo "==> Ensuring database '$POSTGRES_DB' exists..."
  db_exists="$($COMPOSE_CMD -f "$COMPOSE_FILE" exec -T postgres \
    psql -U "$POSTGRES_USER" -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'")"

  if [ "$db_exists" != "1" ]; then
    $COMPOSE_CMD -f "$COMPOSE_FILE" exec -T postgres \
      psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
      -c "CREATE DATABASE \"$POSTGRES_DB\"" \
      > /dev/null
  fi

  echo "✓ PostgreSQL ready (local Docker). Database: $POSTGRES_DB"
else
  if is_local; then
    echo "==> Local PostgreSQL is managed outside Docker. Skipping container startup."
  else
    echo "==> Remote database detected (host: $db_host). Skipping Docker."
  fi
  wait_for_connection
fi

# Self-Hosting Setup (for AI Agents)

This document is designed for AI agents to execute. Follow these steps exactly to deploy a local AI分析师 instance and connect to it.

## Prerequisites

- Docker and Docker Compose installed
- Homebrew installed (for host CLI setup)
- At least one AI agent CLI on PATH for a host daemon, or use the optional Docker daemon with Claude Code and Codex preinstalled

## Install

```bash
# Install CLI + provision self-host server
curl -fsSL https://raw.githubusercontent.com/multica-ai/multica/main/scripts/install.sh | bash -s -- --with-server

# Configure CLI for localhost, authenticate, and start daemon
multica setup self-host
```

Wait for the server output `✓ AI分析师 server is running and CLI is ready!` before running `multica setup self-host`.

**Expected result:**
- Frontend at http://localhost:3000
- Backend at http://localhost:8080
- `multica` CLI installed and configured for localhost

## Alternative: Manual Setup

```bash
git clone https://github.com/multica-ai/multica.git
cd multica
make selfhost
brew install multica-ai/tap/multica
multica setup self-host
```

The `multica setup self-host` command will:
1. Configure CLI to connect to localhost:8080 / localhost:3000
2. Open a browser for login — use the emailed code, or the generated code printed in backend logs when Resend is unset
3. Discover workspaces automatically
4. Start the daemon in the background

## Verification

```bash
multica daemon status
```

Should show `running` with detected agents.

## Optional: Docker Agent Daemon

If the host does not have `claude` or `codex` on PATH, authenticate the CLI first, then run the daemon container. The backend image includes the `multica` CLI plus Claude Code and Codex preinstalled.

```bash
multica daemon stop

docker compose -f docker-compose.selfhost.yml --profile daemon up -d agent-daemon
```

The daemon container reads the AI分析师 token from `${MULTICA_CLI_CONFIG_DIR:-~/.multica}` and mounts `${CLAUDE_CONFIG_DIR:-~/.claude}` / `${CODEX_CONFIG_DIR:-~/.codex}` read-only for agent CLI auth. Override those paths in `.env` when the host config directories live elsewhere.

To verify the Docker daemon:

```bash
docker compose -f docker-compose.selfhost.yml --profile daemon logs -f agent-daemon
```

## Stopping

```bash
# Stop the daemon
multica daemon stop

# Stop all Docker services
cd multica
make selfhost-stop
```

## Custom Ports

If the default ports (8080/3000) are in use:

1. Edit `.env` and change `PORT` and `FRONTEND_PORT`
2. Run `make selfhost`
3. Run `multica setup self-host --port <PORT> --frontend-port <FRONTEND_PORT>`

## Troubleshooting

- **Backend not ready:** `docker compose -f docker-compose.selfhost.yml logs backend`
- **Frontend not ready:** `docker compose -f docker-compose.selfhost.yml logs frontend`
- **Daemon issues:** `multica daemon logs`
- **Health checks:** `curl http://localhost:8080/health` for liveness, `curl http://localhost:8080/readyz` for dependency-aware readiness

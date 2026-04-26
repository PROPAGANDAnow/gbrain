---
id: honcho-self-hosted-memory
name: Honcho Self-Hosted Memory
version: 0.10.1
description: Run Honcho on your own infrastructure and point Hermes at it for cross-session memory with local data ownership.
category: infra
requires: []
secrets:
  - name: HONCHO_BASE_URL
    description: Base URL of the self-hosted Honcho API
    where: Your Honcho deployment (for example http://localhost:8000 or https://honcho.example.com)
health_checks:
  - type: http
    url: "$HONCHO_BASE_URL/openapi.json"
    label: "Honcho OpenAPI"
  - type: command
    argv:
      - python3
      - -c
      - "from pathlib import Path; import sys; sys.exit(0 if (Path.home()/'.honcho/config.json').exists() else 1)"
    label: "Hermes Honcho config"
setup_time: 20 min
cost_estimate: "$0 infra if self-hosted already exists; otherwise server + model/API costs"
---

# Honcho Self-Hosted Memory

Hermes already has durable memory via Honcho. This recipe switches that memory layer
from Plastic Labs' hosted service to **your own Honcho deployment** so conversation
history, observations, and cross-session recall stay under your control.

## IMPORTANT: Instructions for the Agent

**You are the installer.** Verify the live Honcho API, wire Hermes to it, run a smoke
check, and explain the privacy implications clearly.

**Why this matters:** GBrain is the searchable knowledge layer for files, entities,
and timelines. Honcho is the conversational memory layer for user observations and
cross-session continuity. Running both gives the agent a long-term brain **and** a
separate user-memory system.

**Do not assume auth is enforced because OpenAPI says so.** Test runtime behavior.

## What this recipe sets up

1. A reachable self-hosted Honcho API (`/openapi.json` works)
2. Hermes config at `~/.honcho/config.json` pointing to that API
3. A smoke test confirming Hermes can use the instance
4. A clear note to the user about whether auth is actually enforced

## Prerequisites

1. Hermes Agent is already installed on this machine
2. A Honcho instance is running somewhere reachable from this machine
3. If the instance requires auth, the user has the bearer token ready
4. Docker access if you need to deploy Honcho locally as part of setup

## Setup Flow

### Step 1: Confirm the deployment path

Ask the user:

- Do you already have a self-hosted Honcho instance running?
- If yes, what is the base URL?
- If no, do you want me to deploy one locally on this machine with Docker?

If they already have one, capture:

```bash
export HONCHO_BASE_URL="http://localhost:8000"
# optional if their deployment enforces bearer auth
export HONCHO_AUTH_TOKEN="***"
```

If they do **not** have one yet, the fastest starting point is:

- Upstream Honcho: `https://github.com/plastic-labs/honcho`
- Example self-host recipe: `https://github.com/elkimek/honcho-self-hosted`

If deploying locally, prefer Docker Compose and keep all generated files outside the
`~/gbrain` repo.

### Step 2: Probe the live API before configuring Hermes

Run these checks in order:

```bash
curl -s "$HONCHO_BASE_URL/" || true
curl -s "$HONCHO_BASE_URL/docs" | head
curl -s "$HONCHO_BASE_URL/openapi.json" | head
curl -s "$HONCHO_BASE_URL/health" || true
```

Typical pattern:
- `/` may return 404
- `/docs` often works
- `/openapi.json` is the reliable source of truth
- `/health` may or may not exist

**STOP if `openapi.json` is not reachable.** Fix the deployment first.

### Step 3: Inspect auth and schema, then test auth empirically

Check whether bearer auth is documented:

```bash
curl -s "$HONCHO_BASE_URL/openapi.json" > /tmp/honcho-openapi.json
python3 - <<'PY'
import json
p=json.load(open('/tmp/honcho-openapi.json'))
print('securitySchemes:', list((p.get('components') or {}).get('securitySchemes', {}).keys()))
print('workspace paths:', [k for k in p.get('paths', {}) if 'workspace' in k][:10])
PY
```

Then compare:
1. unauthenticated request
2. same request with an obviously invalid bearer token

Example:

```bash
curl -s -X POST "$HONCHO_BASE_URL/v3/workspaces/list" -H 'Content-Type: application/json' -d '{}'
curl -s -X POST "$HONCHO_BASE_URL/v3/workspaces/list" -H 'Content-Type: application/json' -H 'Authorization: Bearer invalid-token' -d '{}'
```

If both succeed, tell the user plainly that auth appears **not** to be enforced at
runtime even if the docs advertise bearer auth.

### Step 4: Point Hermes at the self-hosted instance

Create `~/.honcho/config.json` with the self-hosted API base URL. Example shape:

```json
{
  "base_url": "http://localhost:8000",
  "api_key": "optional-if-auth-is-required"
}
```

Use the user's real base URL. If no auth token is required, omit `api_key`.

After writing the file, restart Hermes so the gateway reloads the config. On Hermes
installs that expose a restart command, use it. Otherwise restart the Hermes process
or service the deployment uses.

### Step 5: Smoke-test real usage with cleanup

Do not stop at docs. Validate behavior.

Recommended sequence:
1. create a temporary workspace
2. create a temporary peer
3. fetch peer context
4. delete the temporary workspace

Important schema note discovered in real Honcho deployments:
- workspace creation often expects `{\"id\": \"workspace-name\"}`
- **not** `{\"workspace_id\": \"...\"}`

Expected delete behavior may be:

```bash
DELETE /v3/workspaces/{id} -> 202 {"message":"Workspace deletion accepted"}
```

Always clean up the temporary workspace.

### Step 6: Record completion

```bash
mkdir -p ~/.gbrain/integrations/honcho-self-hosted-memory
printf '{"ts":"%s","event":"setup_complete","source_version":"0.10.1","status":"ok","details":{"base_url":"%s"}}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HONCHO_BASE_URL" \
  >> ~/.gbrain/integrations/honcho-self-hosted-memory/heartbeat.jsonl
```

Tell the user:

- whether the instance is reachable
- whether auth is documented
- whether auth is actually enforced at runtime
- whether Hermes is now configured to use the self-hosted endpoint

## Verification Checklist

1. `curl $HONCHO_BASE_URL/openapi.json` returns JSON
2. `~/.honcho/config.json` exists and points at the self-hosted URL
3. Hermes has been restarted after config changes
4. Temporary workspace create/read/delete smoke test succeeds
5. User understands whether the deployment is private-but-authenticated or private-but-open

## Pitfalls

1. **OpenAPI is not proof of auth enforcement.** Always compare live requests.
2. **Do not leave test workspaces behind.** Create, verify, delete.
3. **Do not put deployment files inside `~/gbrain`.** Keep GBrain the product repo, not the runtime data directory.
4. **Do not claim a token works unless you tested that exact token.**
5. **If the base URL is remote, confirm network reachability from the Hermes host, not from your laptop.**

---

*Part of the GBrain integrations catalog. Pairs well with GBrain for file/entity memory and Hermes for conversational recall.*

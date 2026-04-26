---
id: graphify-memory
name: Graphify Memory
version: 0.10.1
description: Add a persistent structural memory layer for code and docs with Graphify so agents can query repo structure through a durable graph.
category: infra
requires: []
secrets: []
health_checks:
  - type: command
    argv:
      - python3
      - -c
      - "import shutil, sys; sys.exit(0 if shutil.which('graphify') else 1)"
    label: "Graphify CLI"
  - type: command
    argv:
      - python3
      - -c
      - "from pathlib import Path; import sys; sys.exit(0 if (Path('graphify-out')/'GRAPH_REPORT.md').exists() else 1)"
    label: "Graphify report present"
setup_time: 15 min
cost_estimate: "$0 in AST mode; optional model/API cost for deeper semantic extraction"
---

# Graphify Memory

Graphify adds a **persistent structural memory layer** for repositories and document
corpora. Where GBrain tracks pages, entities, and timelines, Graphify tracks modules,
symbols, imports, call relationships, and cross-file structure so an agent does not
have to re-read the entire corpus on every session.

## IMPORTANT: Instructions for the Agent

**You are the installer.** Install or verify Graphify, build the graph for the target
repo, wire the project instructions so future sessions consult the graph first, and
verify the result with an actual query.

**Why this matters:** the new GBrain integration contract exposes recipes through the
same shared surface used by the CLI, `--tools-json`, and MCP. That means agents can:

- run `gbrain integrations-list`
- inspect this recipe with `gbrain integration-get graphify-memory`
- inspect setup state with `gbrain integration-status graphify-memory`
- discover the same integration over MCP without bespoke docs parsing

Use this when a deployment needs durable **repo understanding** in addition to
GBrain's broader knowledge-layer memory.

## What this recipe sets up

1. Graphify installed and runnable as `graphify`
2. A durable graph for the target repo or corpus
3. Project-level instructions so future sessions consult Graphify artifacts first
4. Optional automation to refresh the graph after changes
5. A heartbeat entry so GBrain can report integration status over the shared contract

## Prerequisites

1. Python 3.10+ on the target machine
2. Hermes Agent or another compatible coding agent already installed
3. A target repository or corpus directory to graphify
4. Write access to that repo or corpus

## Setup Flow

### Step 1: Install the official package

Prefer `uv` or `pipx`. The package name is **`graphifyy`** while the CLI command is
still `graphify`.

```bash
uv tool install graphifyy
# or
pipx install graphifyy
# or fallback
pip install graphifyy
```

Verify:

```bash
graphify --version
```

### Step 2: Choose the target corpus

Confirm which repository or folder should receive structural memory. Usually this is
the main application repo, not the GBrain repo itself.

```bash
cd /path/to/project
```

If graph artifacts should be version-controlled, confirm that with the user first.
Reasonable default:

- keep `graphify-out/graph.json`
- keep `graphify-out/GRAPH_REPORT.md`
- ignore `graphify-out/cache/`, `graphify-out/manifest.json`, and `graphify-out/cost.json`

### Step 3: Build the initial graph

Run the first pass in the target repo:

```bash
graphify .
```

Expected output shape:

```text
graphify-out/
├── graph.json
├── GRAPH_REPORT.md
├── graph.html
└── cache/
```

For later refreshes prefer:

```bash
graphify update .
```

### Step 4: Make the graph always-on for future agent sessions

Install project instructions so future sessions check Graphify artifacts before doing
broad raw-file scans:

```bash
graphify hermes install
```

This typically updates `AGENTS.md`-style project guidance so the repo itself teaches
future sessions to read `graphify-out/GRAPH_REPORT.md` early.

### Step 5: Verify the graph is actually usable

Do not stop at file existence. Run a real query.

```bash
graphify query "show the auth flow"
```

Also verify the durable artifacts exist:

```bash
test -f graphify-out/graph.json && echo PASS
test -f graphify-out/GRAPH_REPORT.md && echo PASS
```

### Step 6: Optional automation

If the user wants the graph to stay fresh automatically, offer:

```bash
graphify hook install
```

This can refresh the graph after commits or branch switches.

### Step 7: Record completion for shared integration status

```bash
mkdir -p ~/.gbrain/integrations/graphify-memory
printf '{"ts":"%s","event":"setup_complete","source_version":"0.10.1","status":"ok","details":{"target":"%s"}}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(pwd)" \
  >> ~/.gbrain/integrations/graphify-memory/heartbeat.jsonl
```

After this, agents can inspect status with:

```bash
gbrain integration-status graphify-memory
```

and MCP clients can retrieve the same state via `get_integration_status`.

## Verification Checklist

1. `graphify --version` succeeds
2. `graphify-out/graph.json` exists in the target repo
3. `graphify-out/GRAPH_REPORT.md` exists in the target repo
4. `graphify query ...` returns a useful answer
5. `~/.gbrain/integrations/graphify-memory/heartbeat.jsonl` has a completion event

## Pitfalls

1. **The package name is `graphifyy`, not `graphify`.**
2. **Do not graphify `graphify-out/` itself.** Use `.graphifyignore` if needed.
3. **Do not promise semantic extraction if you only ran AST mode.** Say what mode you used.
4. **Do not manually edit generated graph artifacts unless the user explicitly wants that.**
5. **Graphify complements GBrain; it does not replace the brain repo or conversational memory.**

---

*Part of the GBrain integrations catalog. Best for deployments that need durable repo understanding alongside the broader GBrain knowledge layer.*

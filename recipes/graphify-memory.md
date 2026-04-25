---
id: graphify-memory
name: Graphify Memory
version: 0.10.1
description: Add a persistent code and document knowledge-graph layer with Graphify so the agent can navigate structure without re-reading the whole corpus.
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
      - "from pathlib import Path; import sys; sys.exit(0 if (Path.home()/'.hermes/skills/graphify/SKILL.md').exists() else 1)"
    label: "Hermes Graphify skill"
setup_time: 15 min
cost_estimate: "$0 in AST mode; optional model/API cost for deep semantic extraction"
---

# Graphify Memory

Graphify adds a **persistent structural memory layer** for code, docs, screenshots,
and other project artifacts. Instead of re-reading an entire repo every session, the
agent can consult a durable knowledge graph (`graphify-out/graph.json` and
`GRAPH_REPORT.md`) and only open raw files when it needs to edit.

## IMPORTANT: Instructions for the Agent

**You are the installer.** Set up Graphify on the target repo, make the graph durable,
and ensure the assistant can keep using it on future sessions.

**Why this matters:** GBrain remembers pages, entities, and timelines across the brain.
Graphify remembers **structure** inside a project corpus: functions, modules, imports,
clusters, and cross-file relationships. Use both when the deployment needs memory for
knowledge work **and** repo understanding.

## What this recipe sets up

1. Install the official Graphify CLI (`graphifyy` package; command is `graphify`)
2. Install the Hermes Graphify skill/instructions
3. Build a first graph for the target repo or corpus
4. Add always-on project guidance so future sessions consult the graph first
5. Optionally install git hooks for automatic graph refreshes

## Prerequisites

1. Python 3.10+ on the target machine
2. Hermes Agent already installed
3. A target repo or corpus directory to graphify
4. Write access to that repo/corpus

## Setup Flow

### Step 1: Install the official package

Prefer `uv` or `pipx`. The official package name is **`graphifyy`** (double y), while
the CLI command is still `graphify`.

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

### Step 2: Install Graphify for Hermes

Install the Hermes-facing skill/instructions:

```bash
graphify install --platform hermes
```

This should populate the global Hermes skill path so the assistant can invoke the
workflow later.

### Step 3: Choose the target corpus

Ask the user which repo or folder should get structural memory. Usually this is their
main application repo, not `~/gbrain` itself.

Example:

```bash
cd /path/to/project
```

If the repo should keep generated graph artifacts under version control, confirm that
with the user. Recommended default:
- keep `graphify-out/graph.json`
- keep `graphify-out/GRAPH_REPORT.md`
- ignore `graphify-out/cache/`, `graphify-out/manifest.json`, and `graphify-out/cost.json`

### Step 4: Build the initial graph

Run the first pass on the target repo:

```bash
graphify .
```

This should create:

```text
graphify-out/
├── graph.json
├── GRAPH_REPORT.md
├── graph.html
└── cache/
```

For incremental refreshes later, prefer:

```bash
graphify update .
```

### Step 5: Make the graph always-on for Hermes

Inside the target repo, install the always-on project guidance:

```bash
graphify hermes install
```

This writes project instructions (typically via `AGENTS.md`) so future sessions check
`graphify-out/GRAPH_REPORT.md` before grepping raw files.

### Step 6: Verify the graph is actually usable

Run at least one direct query:

```bash
graphify query "show the auth flow"
```

Also verify the files exist:

```bash
test -f graphify-out/graph.json && echo PASS
test -f graphify-out/GRAPH_REPORT.md && echo PASS
```

### Step 7: Optional automation

If the user wants the graph to stay fresh automatically, offer:

```bash
graphify hook install
```

This rebuilds the graph after commits and branch switches.

### Step 8: Record completion

```bash
mkdir -p ~/.gbrain/integrations/graphify-memory
printf '{"ts":"%s","event":"setup_complete","source_version":"0.10.1","status":"ok","details":{"target":"%s"}}
'   "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(pwd)"   >> ~/.gbrain/integrations/graphify-memory/heartbeat.jsonl
```

Tell the user:
- which repo/folder was graphified
- whether `graphify-out/graph.json` was created
- whether always-on Hermes instructions were installed
- whether hooks were installed or skipped

## Verification Checklist

1. `graphify --version` succeeds
2. `~/.hermes/skills/graphify/SKILL.md` exists after install
3. `graphify-out/graph.json` exists in the target repo
4. `graphify-out/GRAPH_REPORT.md` exists in the target repo
5. `graphify query ...` returns a useful answer

## Pitfalls

1. **The package name is `graphifyy`, not `graphify`.**
2. **Do not graphify `graphify-out/` itself.** Use `.graphifyignore` if needed.
3. **Do not promise semantic/LLM extraction if you only ran AST mode.** Say what mode you used.
4. **Do not manually edit generated graph artifacts unless the user explicitly wants that.**
5. **Graphify complements GBrain; it does not replace the brain repo.** Keep entity memory and timeline memory in GBrain.

---

*Part of the GBrain integrations catalog. Best for deployments that need durable repo understanding alongside the broader GBrain knowledge layer.*

# GBrain

Open source personal knowledge brain. Postgres + pgvector + hybrid search that actually works.

```bash
gbrain query "who knows Jensen Huang?"
```

Returns ranked results with evidence chains from your compiled intelligence pages, cross-referenced across 7,000+ entity pages in under 50ms.

## Why this exists

You have a brain full of knowledge about people, companies, deals, projects. It lives in markdown files, meeting notes, CRM exports, Obsidian vaults, Notion databases. It's scattered, unsearchable, and going stale.

Search is the bottleneck. Keyword search misses semantic matches. Vector search misses exact names. Neither understands that the person you met at dinner last week works at the company you're evaluating for a deal.

GBrain fixes this with hybrid search that combines both approaches, plus a knowledge model that treats every page like an intelligence assessment: compiled truth on top (your current best understanding, rewritten when evidence changes), append-only timeline on the bottom (the evidence trail that never gets edited).

AI agents maintain the brain. You ingest a meeting and the agent updates every person and company mentioned, creates cross-reference links, and appends timeline entries. MCP clients query it. The intelligence lives in fat markdown skills, not application code.

## Install

### With OpenClaw (recommended)

If you're running OpenClaw, just tell it to set up your brain:

```
You: "Install gbrain and set up my knowledge brain"
```

OpenClaw will:
1. Install gbrain as a dependency (`bun add gbrain`)
2. Run the guided Supabase setup wizard
3. Import a demo corpus so you can try a query immediately
4. Register all 6 brain skills (ingest, query, maintain, enrich, briefing, migrate)

After setup, you talk to your brain through OpenClaw:

```
You: "What do we know about River AI?"
You: "Ingest my meeting notes from today"
You: "Who is connected to Jensen Huang?"
You: "Give me a briefing for my meetings tomorrow"
You: "Import my Obsidian vault into the brain"
```

OpenClaw reads the skill files, figures out which gbrain commands to run, and does the work. You never touch the CLI directly unless you want to.

### With ClawHub

```bash
clawhub install gbrain
```

This installs the npm package, copies the skill files, and runs `gbrain init --supabase` on first use.

### Standalone CLI

```bash
npm install -g gbrain
```

### As a library

```bash
bun add gbrain
```

```typescript
import { PostgresEngine } from 'gbrain';
```

All paths require a Postgres database with pgvector. Supabase Pro ($25/mo) is the recommended zero-ops option.

## Setup

After installing via CLI or library path, run the setup wizard:

```bash
# Guided wizard: auto-provisions Supabase or accepts a connection URL
gbrain init --supabase

# Or connect to any Postgres with pgvector
gbrain init --url postgresql://user:pass@host:5432/dbname
```

The init wizard:
1. Checks for Supabase CLI, offers auto-provisioning
2. Falls back to manual connection URL if CLI isn't available
3. Runs the full schema migration (tables, indexes, triggers, extensions)
4. Imports a kindling corpus (10 PG essays) as demo data
5. Verifies the connection and prints your first query to try

Config is saved to `~/.gbrain/config.json` with 0600 permissions.

OpenClaw users skip this step. The orchestrator runs the wizard for you during install.

## First import

```bash
# Import your markdown wiki (auto-chunks and auto-embeds)
gbrain import /path/to/brain/

# Skip embedding if you want to import fast and embed later
gbrain import /path/to/brain/ --no-embed

# Backfill embeddings for pages that don't have them
gbrain embed --stale
```

Import is idempotent. Re-running it skips unchanged files (compared by SHA-256 content hash). Progress bar shows status. ~30s for text import of 7,000 files, ~10-15 min for embedding.

## The knowledge model

Every page in the brain follows the compiled truth + timeline pattern:

```markdown
---
type: person
title: Pedro Franceschi
tags: [founder, fintech]
---

Co-founder and CEO of Brex. Previously built a payments company in Brazil
at age 16. Strong technical founder with deep fintech expertise.

---

- 2024-03-20: Brex announced Series D at $12B valuation
- 2024-01-15: Met at dinner, discussed expansion into expense management
- 2023-09-01: Brex hit $1B ARR
```

Above the `---` separator: **compiled truth**. Your current best understanding. Gets rewritten when new evidence changes the picture. Below: **timeline**. Append-only evidence trail. Never edited, only added to.

This is the Karpathy-style intelligence assessment model. The compiled truth is the answer. The timeline is the proof.

## How search works

```
Query: "who knows Jensen Huang?"
         |
    Multi-query expansion (Claude Haiku)
    "Jensen Huang connections", "people who know Jensen"
         |
    +----+----+
    |         |
  Vector    Keyword
  (HNSW     (tsvector +
  cosine)    ts_rank)
    |         |
    +----+----+
         |
    RRF Fusion: score = sum(1/(60 + rank))
         |
    4-Layer Dedup
    1. Best chunk per page
    2. Cosine similarity > 0.85
    3. Type diversity (60% cap)
    4. Per-page chunk cap
         |
    Stale alerts (compiled truth older than latest timeline)
         |
    Results
```

Keyword search alone misses "Jensen Huang" when the page says "CEO of NVIDIA." Vector search alone misses exact name matches when the embedding is diluted by surrounding text. RRF fusion gets both right. Multi-query expansion catches phrasings you didn't think of.

## Database schema

9 tables in Postgres + pgvector:

```
pages                    The core content table
  slug (UNIQUE)          e.g. "people/pedro-franceschi"
  type                   person, company, deal, yc, civic, project, concept, source, media
  title, compiled_truth, timeline
  frontmatter (JSONB)    Arbitrary metadata
  search_vector          Trigger-based tsvector (title + compiled_truth + timeline + timeline_entries)
  content_hash           SHA-256 for import idempotency

content_chunks           Chunked content with embeddings
  page_id (FK)           Links to pages
  chunk_text             The chunk content
  chunk_source           'compiled_truth' or 'timeline'
  embedding (vector)     1536-dim from text-embedding-3-large
  HNSW index             Cosine similarity search

links                    Cross-references between pages
  from_page_id, to_page_id
  link_type              knows, invested_in, works_at, founded, etc.

tags                     page_id + tag (many-to-many)

timeline_entries         Structured timeline events
  page_id, date, source, summary, detail (markdown)

page_versions            Snapshot history for compiled_truth
  compiled_truth, frontmatter, snapshot_at

raw_data                 Sidecar JSON from external APIs
  page_id, source, data (JSONB)

ingest_log               Audit trail of import/ingest operations

config                   Brain-level settings (embedding model, chunk strategy)
```

Indexes: B-tree on slug/type, GIN on frontmatter/search_vector, HNSW on embeddings, pg_trgm on title for fuzzy slug resolution.

## Chunking

Three strategies, dispatched by content type:

**Recursive** (timeline, bulk import): 5-level delimiter hierarchy (paragraphs, lines, sentences, clauses, words). 300-word chunks with 50-word sentence-aware overlap. Fast, predictable, lossless.

**Semantic** (compiled truth): Embeds each sentence, computes adjacent cosine similarities, applies Savitzky-Golay smoothing to find topic boundaries. Falls back to recursive on failure. Best quality for intelligence assessments.

**LLM-guided** (high-value content, on request): Pre-splits into 128-word candidates, asks Claude Haiku to identify topic shifts in sliding windows. 3 retries per window. Most expensive, best results.

## Commands

```
SETUP
  gbrain init [--supabase|--url <conn>]     Create brain (guided wizard)
  gbrain upgrade                            Self-update

PAGES
  gbrain get <slug>                         Read a page (supports fuzzy slug matching)
  gbrain put <slug> [< file.md]             Write/update a page (auto-versions)
  gbrain delete <slug>                      Delete a page
  gbrain list [--type T] [--tag T] [-n N]   List pages with filters

SEARCH
  gbrain search <query>                     Keyword search (tsvector)
  gbrain query <question>                   Hybrid search (vector + keyword + RRF + expansion)

IMPORT/EXPORT
  gbrain import <dir> [--no-embed]          Import markdown directory (idempotent)
  gbrain export [--dir ./out/]              Export to markdown (round-trip)

EMBEDDINGS
  gbrain embed [<slug>|--all|--stale]       Generate/refresh embeddings

LINKS + GRAPH
  gbrain link <from> <to> [--type T]        Create typed link
  gbrain unlink <from> <to>                 Remove link
  gbrain backlinks <slug>                   Incoming links
  gbrain graph <slug> [--depth N]           Traverse link graph (recursive CTE, default depth 5)

TAGS
  gbrain tags <slug>                        List tags
  gbrain tag <slug> <tag>                   Add tag
  gbrain untag <slug> <tag>                 Remove tag

TIMELINE
  gbrain timeline [<slug>]                  View timeline entries
  gbrain timeline-add <slug> <date> <text>  Add timeline entry

ADMIN
  gbrain stats                              Brain statistics
  gbrain health                             Health dashboard (embed coverage, stale, orphans)
  gbrain history <slug>                     Page version history
  gbrain revert <slug> <version-id>         Revert to previous version
  gbrain config [get|set] <key> [value]     Brain config
  gbrain serve                              MCP server (stdio)
  gbrain call <tool> '<json>'               Raw tool invocation
  gbrain --tools-json                       Tool discovery (JSON)
```

## Using as a library

GBrain is library-first. The CLI and MCP server are thin wrappers over the engine.

```typescript
import { PostgresEngine } from 'gbrain';

const engine = new PostgresEngine();
await engine.connect({ database_url: process.env.DATABASE_URL });
await engine.initSchema();

// Write a page
await engine.putPage('people/pedro', {
  type: 'person',
  title: 'Pedro Franceschi',
  compiled_truth: 'Co-founder and CEO of Brex...',
  timeline: '- 2024-01-15: Met at dinner...',
});

// Hybrid search
const results = await engine.searchKeyword('fintech founders');

// Typed links
await engine.addLink('people/pedro', 'companies/brex', '', 'founded');

// Graph traversal
const graph = await engine.traverseGraph('people/pedro', 3);

// Health check
const health = await engine.getHealth();
// { page_count: 7471, embed_coverage: 0.98, stale_pages: 12, orphan_pages: 34 }
```

The `BrainEngine` interface is pluggable. See `docs/ENGINES.md` for how to add backends.

## MCP server

Add to your Claude Code or Cursor MCP config:

```json
{
  "mcpServers": {
    "gbrain": {
      "command": "gbrain",
      "args": ["serve"]
    }
  }
}
```

20 tools: get_page, put_page, delete_page, list_pages, search, query, add_tag, remove_tag, get_tags, add_link, remove_link, get_links, get_backlinks, traverse_graph, add_timeline_entry, get_timeline, get_stats, get_health, get_versions, revert_version.

Every tool mirrors a CLI command. Drift tests verify identical behavior.

## Skills

Fat markdown files that tell AI agents HOW to use gbrain. No skill logic in the binary.

| Skill | What it does |
|-------|-------------|
| **ingest** | Ingest meetings, docs, articles. Updates compiled truth (rewrite, not append), appends timeline, creates cross-reference links across all mentioned entities. |
| **query** | 3-layer search (keyword + vector + structured) with synthesis and citations. Says "the brain doesn't have info on X" rather than hallucinating. |
| **maintain** | Periodic health: find contradictions, stale compiled truth, orphan pages, dead links, tag inconsistency, missing embeddings, overdue threads. |
| **enrich** | Enrich person/company pages from external APIs (Crustdata, Happenstance, Exa). Raw data stored separately, distilled highlights go to compiled truth. |
| **briefing** | Daily briefing: today's meetings with participant context, active deals with deadlines, time-sensitive threads, recent changes, people in play. |
| **migrate** | Universal migration from Obsidian (wikilinks to gbrain links), Notion (stripped UUIDs), Logseq (block refs), plain markdown, CSV, JSON, Roam. |

## Architecture

```
CLI / MCP Server
     (thin wrappers, identical operations)
              |
      BrainEngine interface
       (pluggable backend)
              |
     +--------+--------+
     |                  |
PostgresEngine     SQLiteEngine
  (ships v0)       (designed, community PRs welcome)
     |
Supabase Pro ($25/mo)
  Postgres + pgvector + pg_trgm
  connection pooling via Supavisor
```

Embedding, chunking, and search fusion are engine-agnostic. Only raw keyword search (`searchKeyword`) and raw vector search (`searchVector`) are engine-specific. RRF fusion, multi-query expansion, and 4-layer dedup run above the engine on `SearchResult[]` arrays.

## Storage estimates

For a brain with ~7,500 pages:

| Component | Size |
|-----------|------|
| Page text (compiled_truth + timeline) | ~150MB |
| JSONB frontmatter + indexes | ~70MB |
| Content chunks (~22K, text) | ~80MB |
| Embeddings (22K x 1536 floats) | ~134MB |
| HNSW index overhead | ~270MB |
| Links, tags, timeline, versions | ~50MB |
| **Total** | **~750MB** |

Supabase free tier (500MB) won't fit a large brain. Supabase Pro ($25/mo, 8GB) is the starting point.

Initial embedding cost: ~$4-5 for 7,500 pages via OpenAI text-embedding-3-large.

## Docs

- [GBRAIN_V0.md](docs/GBRAIN_V0.md) -- Full product spec, all architecture decisions, every option considered
- [ENGINES.md](docs/ENGINES.md) -- Pluggable engine interface, capability matrix, how to add backends
- [SQLITE_ENGINE.md](docs/SQLITE_ENGINE.md) -- Complete SQLite engine plan with schema, FTS5, vector search options

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Welcome PRs for:

- SQLite engine implementation
- Docker Compose for self-hosted Postgres
- Additional migration sources
- New enrichment API integrations

## License

MIT

/**
 * Search Quality Benchmark — measures impact of PR #64 changes.
 *
 * Seeds a PGLite brain with test pages, runs queries with and without
 * compiled truth boost, and outputs comparative metrics.
 *
 * Usage: bun run test/benchmark-search-quality.ts
 */

import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { rrfFusion } from '../src/core/search/hybrid.ts';
import { dedupResults } from '../src/core/search/dedup.ts';
import { precisionAtK, recallAtK, mrr, ndcgAtK } from '../src/core/search/eval.ts';
import type { SearchResult, ChunkInput } from '../src/core/types.ts';

// ─── Config ──────────────────────────────────────────────────────

const BOOST_FACTOR = 2.0;
const RRF_K = 60;

function basisEmbedding(idx: number, dim = 1536): Float32Array {
  const emb = new Float32Array(dim);
  emb[idx % dim] = 1.0;
  return emb;
}

// Blend two basis vectors to simulate partial relevance
function blendEmbedding(idx1: number, idx2: number, weight1 = 0.8, dim = 1536): Float32Array {
  const emb = new Float32Array(dim);
  emb[idx1 % dim] = weight1;
  emb[idx2 % dim] = 1 - weight1;
  return emb;
}

// ─── Test Data ───────────────────────────────────────────────────

interface TestPage {
  slug: string;
  type: 'person' | 'company' | 'concept';
  title: string;
  compiled_truth: string;
  timeline: string;
  chunks: ChunkInput[];
}

const PAGES: TestPage[] = [
  {
    slug: 'people/pedro',
    type: 'person',
    title: 'Pedro Franceschi',
    compiled_truth: 'Pedro is the co-founder of Brex. Expert in fintech payments infrastructure and AI security.',
    timeline: '2024-03-15: Met Pedro at YC dinner. Discussed Crab Trap AI security project.',
    chunks: [
      { chunk_index: 0, chunk_text: 'Pedro is the co-founder of Brex. Expert in fintech payments infrastructure and AI security.', chunk_source: 'compiled_truth', embedding: blendEmbedding(0, 10), token_count: 18 },
      { chunk_index: 1, chunk_text: '2024-03-15: Met Pedro at YC dinner. Discussed Crab Trap AI security project.', chunk_source: 'timeline', embedding: blendEmbedding(1, 10), token_count: 16 },
    ],
  },
  {
    slug: 'companies/variant',
    type: 'company',
    title: 'Variant Fund',
    compiled_truth: 'Variant is a crypto-native investment firm focused on web3 ownership economy. Led by Jesse Walden.',
    timeline: '2024-06-01: Variant announced new $450M fund. Jesse presented at token summit.',
    chunks: [
      { chunk_index: 0, chunk_text: 'Variant is a crypto-native investment firm focused on web3 ownership economy. Led by Jesse Walden.', chunk_source: 'compiled_truth', embedding: blendEmbedding(2, 11), token_count: 18 },
      { chunk_index: 1, chunk_text: '2024-06-01: Variant announced new $450M fund. Jesse presented at token summit.', chunk_source: 'timeline', embedding: blendEmbedding(3, 11), token_count: 15 },
    ],
  },
  {
    slug: 'concepts/ai-philosophy',
    type: 'concept',
    title: 'AI Changes Who Gets to Build',
    compiled_truth: 'AI democratizes building. The marginal cost of creation approaches zero. This is the most important shift in a generation.',
    timeline: '2024-01-10: First wrote about AI and building access. Shared on X. 50K impressions.',
    chunks: [
      { chunk_index: 0, chunk_text: 'AI democratizes building. The marginal cost of creation approaches zero. This is the most important shift in a generation.', chunk_source: 'compiled_truth', embedding: blendEmbedding(4, 12), token_count: 22 },
      { chunk_index: 1, chunk_text: '2024-01-10: First wrote about AI and building access. Shared on X. 50K impressions.', chunk_source: 'timeline', embedding: blendEmbedding(5, 12), token_count: 17 },
    ],
  },
  {
    slug: 'people/jesse',
    type: 'person',
    title: 'Jesse Walden',
    compiled_truth: 'Jesse Walden is the founder of Variant Fund. Previously at a16z crypto. Focuses on ownership economy and creator tokens.',
    timeline: '2024-04-20: Coffee with Jesse. Discussed token-gated communities and creator economy.',
    chunks: [
      { chunk_index: 0, chunk_text: 'Jesse Walden is the founder of Variant Fund. Previously at a16z crypto. Focuses on ownership economy and creator tokens.', chunk_source: 'compiled_truth', embedding: blendEmbedding(6, 13), token_count: 22 },
      { chunk_index: 1, chunk_text: '2024-04-20: Coffee with Jesse. Discussed token-gated communities and creator economy.', chunk_source: 'timeline', embedding: blendEmbedding(7, 13), token_count: 15 },
    ],
  },
  {
    slug: 'companies/brex',
    type: 'company',
    title: 'Brex',
    compiled_truth: 'Brex is a fintech company providing corporate cards and spend management. Founded by Pedro Franceschi and Henrique Dubugras. YC W17.',
    timeline: '2024-02-28: Brex announced AI-powered expense management. Revenue growth strong.',
    chunks: [
      { chunk_index: 0, chunk_text: 'Brex is a fintech company providing corporate cards and spend management. Founded by Pedro Franceschi and Henrique Dubugras. YC W17.', chunk_source: 'compiled_truth', embedding: blendEmbedding(8, 14), token_count: 24 },
      { chunk_index: 1, chunk_text: '2024-02-28: Brex announced AI-powered expense management. Revenue growth strong.', chunk_source: 'timeline', embedding: blendEmbedding(9, 14), token_count: 14 },
    ],
  },
];

interface BenchmarkQuery {
  id: string;
  query: string;
  queryEmbedding: Float32Array;
  relevant: string[];
  expectedSource: 'compiled_truth' | 'timeline';
  description: string;
}

const QUERIES: BenchmarkQuery[] = [
  {
    id: 'entity-lookup',
    query: 'What does Variant do?',
    queryEmbedding: blendEmbedding(2, 11, 0.9),
    relevant: ['companies/variant'],
    expectedSource: 'compiled_truth',
    description: 'Entity lookup should surface compiled truth',
  },
  {
    id: 'person-lookup',
    query: 'Who is Pedro?',
    queryEmbedding: blendEmbedding(0, 10, 0.9),
    relevant: ['people/pedro'],
    expectedSource: 'compiled_truth',
    description: 'Person lookup should surface compiled truth',
  },
  {
    id: 'meeting-query',
    query: 'When did we last meet Pedro?',
    queryEmbedding: blendEmbedding(1, 10, 0.9),
    relevant: ['people/pedro'],
    expectedSource: 'timeline',
    description: 'Temporal query should surface timeline',
  },
  {
    id: 'topic-query',
    query: 'AI changes who gets to build',
    queryEmbedding: blendEmbedding(4, 12, 0.9),
    relevant: ['concepts/ai-philosophy'],
    expectedSource: 'compiled_truth',
    description: 'Topic query should surface compiled truth',
  },
  {
    id: 'cross-entity',
    query: 'Jesse Walden Variant',
    queryEmbedding: blendEmbedding(6, 2, 0.5),
    relevant: ['people/jesse', 'companies/variant'],
    expectedSource: 'compiled_truth',
    description: 'Cross-entity query should surface compiled truth from both',
  },
  {
    id: 'event-query',
    query: 'Variant new fund announcement',
    queryEmbedding: blendEmbedding(3, 11, 0.9),
    relevant: ['companies/variant'],
    expectedSource: 'timeline',
    description: 'Event query should surface timeline',
  },
  {
    id: 'company-overview',
    query: 'Brex fintech corporate cards',
    queryEmbedding: blendEmbedding(8, 14, 0.9),
    relevant: ['companies/brex'],
    expectedSource: 'compiled_truth',
    description: 'Company overview should surface compiled truth',
  },
  {
    id: 'negative-control',
    query: 'quantum computing advances',
    queryEmbedding: basisEmbedding(500),
    relevant: [],
    expectedSource: 'compiled_truth',
    description: 'Irrelevant query should return no relevant results',
  },
];

// ─── Benchmark Runner ────────────────────────────────────────────

interface RunResult {
  queryId: string;
  hits: SearchResult[];
  topSource: 'compiled_truth' | 'timeline' | 'none';
  topSlug: string;
  precision1: number;
  mrr: number;
  ndcg5: number;
  sourceCorrect: boolean;
}

async function runBenchmark(
  engine: PGLiteEngine,
  queries: BenchmarkQuery[],
  withBoost: boolean,
): Promise<RunResult[]> {
  const results: RunResult[] = [];

  for (const q of queries) {
    // Get keyword results
    const keywordResults = await engine.searchKeyword(q.query, { limit: 20 });

    // Get vector results
    const vectorResults = await engine.searchVector(q.queryEmbedding, { limit: 20 });

    // Run RRF fusion (with or without boost via the exported function)
    let fused: SearchResult[];
    if (withBoost) {
      // rrfFusion includes normalization + boost
      fused = rrfFusion([vectorResults, keywordResults], RRF_K);
    } else {
      // Simulate old behavior: RRF without normalization/boost
      fused = rrfFusionBaseline([vectorResults, keywordResults]);
    }

    // Dedup
    const deduped = dedupResults(fused);
    const top5 = deduped.slice(0, 5);

    const relevantSet = new Set(q.relevant);
    const gradesMap = new Map(q.relevant.map(s => [s, 1]));
    const hitSlugs = top5.map(r => r.slug);

    results.push({
      queryId: q.id,
      hits: top5,
      topSource: top5.length > 0 ? top5[0].chunk_source : 'none',
      topSlug: top5.length > 0 ? top5[0].slug : '',
      precision1: precisionAtK(hitSlugs, relevantSet, 1),
      mrr: mrr(hitSlugs, relevantSet),
      ndcg5: ndcgAtK(hitSlugs, gradesMap, 5),
      sourceCorrect: top5.length > 0 ? top5[0].chunk_source === q.expectedSource : q.relevant.length === 0,
    });
  }

  return results;
}

// Baseline RRF without normalization or boost (simulates pre-PR#64 behavior)
function rrfFusionBaseline(lists: SearchResult[][]): SearchResult[] {
  const scores = new Map<string, { result: SearchResult; score: number }>();

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const r = list[rank];
      const key = `${r.slug}:${r.chunk_text.slice(0, 50)}`;
      const existing = scores.get(key);
      const rrfScore = 1 / (RRF_K + rank);

      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(key, { result: r, score: rrfScore });
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => ({ ...result, score }));
}

// ─── Output ──────────────────────────────────────────────────────

function formatResults(label: string, results: RunResult[]): string {
  const lines: string[] = [];
  lines.push(`### ${label}`);
  lines.push('');
  lines.push('| Query | P@1 | MRR | nDCG@5 | Top Source | Source Correct | Top Slug |');
  lines.push('|-------|-----|-----|--------|------------|----------------|----------|');

  for (const r of results) {
    const q = QUERIES.find(q => q.id === r.queryId)!;
    lines.push(
      `| ${q.description.slice(0, 50)} | ${r.precision1.toFixed(2)} | ${r.mrr.toFixed(2)} | ${r.ndcg5.toFixed(2)} | ${r.topSource} | ${r.sourceCorrect ? 'YES' : 'NO'} | ${r.topSlug || '(none)'} |`
    );
  }

  // Means
  const validResults = results.filter(r => QUERIES.find(q => q.id === r.queryId)!.relevant.length > 0);
  const meanP1 = validResults.reduce((s, r) => s + r.precision1, 0) / validResults.length;
  const meanMRR = validResults.reduce((s, r) => s + r.mrr, 0) / validResults.length;
  const meanNDCG = validResults.reduce((s, r) => s + r.ndcg5, 0) / validResults.length;
  const sourceAccuracy = validResults.filter(r => r.sourceCorrect).length / validResults.length;

  lines.push('');
  lines.push(`**Mean P@1:** ${meanP1.toFixed(3)} | **Mean MRR:** ${meanMRR.toFixed(3)} | **Mean nDCG@5:** ${meanNDCG.toFixed(3)} | **Source Accuracy:** ${(sourceAccuracy * 100).toFixed(1)}%`);

  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();

  // Seed pages
  for (const page of PAGES) {
    await engine.putPage(page.slug, {
      type: page.type,
      title: page.title,
      compiled_truth: page.compiled_truth,
      timeline: page.timeline,
    });
    await engine.upsertChunks(page.slug, page.chunks);
  }

  console.log(`Seeded ${PAGES.length} pages, ${PAGES.reduce((s, p) => s + p.chunks.length, 0)} chunks`);
  console.log(`Running ${QUERIES.length} queries...\n`);

  // Run baseline (no boost)
  const baseline = await runBenchmark(engine, QUERIES, false);

  // Run boosted (PR #64)
  const boosted = await runBenchmark(engine, QUERIES, true);

  // Generate markdown
  const date = new Date().toISOString().split('T')[0];
  const md: string[] = [];

  md.push(`# Search Quality Benchmark: ${date}`);
  md.push('');
  md.push('## PR #64 Impact Analysis');
  md.push('');
  md.push('Comparing search quality before and after the search quality boost (compiled truth');
  md.push('ranking, RRF normalization, source-aware dedup). Measured against 5 seeded brain');
  md.push('pages with 10 chunks total, using 8 benchmark queries with structured mock embeddings.');
  md.push('');
  md.push('Inspired by [Ramp Labs\' "Latent Briefing" paper](https://ramp.com) (April 2026).');
  md.push('');

  md.push('## Results');
  md.push('');
  md.push(formatResults('Baseline (pre-PR#64, no boost)', baseline));
  md.push('');
  md.push(formatResults('PR #64 (compiled truth boost + RRF normalization)', boosted));
  md.push('');

  // Delta analysis
  const baselineValid = baseline.filter(r => QUERIES.find(q => q.id === r.queryId)!.relevant.length > 0);
  const boostedValid = boosted.filter(r => QUERIES.find(q => q.id === r.queryId)!.relevant.length > 0);

  const bP1 = baselineValid.reduce((s, r) => s + r.precision1, 0) / baselineValid.length;
  const aP1 = boostedValid.reduce((s, r) => s + r.precision1, 0) / boostedValid.length;
  const bMRR = baselineValid.reduce((s, r) => s + r.mrr, 0) / baselineValid.length;
  const aMRR = boostedValid.reduce((s, r) => s + r.mrr, 0) / boostedValid.length;
  const bNDCG = baselineValid.reduce((s, r) => s + r.ndcg5, 0) / baselineValid.length;
  const aNDCG = boostedValid.reduce((s, r) => s + r.ndcg5, 0) / boostedValid.length;
  const bSrc = baselineValid.filter(r => r.sourceCorrect).length / baselineValid.length;
  const aSrc = boostedValid.filter(r => r.sourceCorrect).length / boostedValid.length;

  md.push('## Delta Analysis');
  md.push('');
  md.push('| Metric | Baseline | PR #64 | Delta | Change |');
  md.push('|--------|----------|--------|-------|--------|');
  md.push(`| Mean P@1 | ${bP1.toFixed(3)} | ${aP1.toFixed(3)} | ${(aP1 - bP1) >= 0 ? '+' : ''}${(aP1 - bP1).toFixed(3)} | ${((aP1 - bP1) / (bP1 || 1) * 100).toFixed(1)}% |`);
  md.push(`| Mean MRR | ${bMRR.toFixed(3)} | ${aMRR.toFixed(3)} | ${(aMRR - bMRR) >= 0 ? '+' : ''}${(aMRR - bMRR).toFixed(3)} | ${((aMRR - bMRR) / (bMRR || 1) * 100).toFixed(1)}% |`);
  md.push(`| Mean nDCG@5 | ${bNDCG.toFixed(3)} | ${aNDCG.toFixed(3)} | ${(aNDCG - bNDCG) >= 0 ? '+' : ''}${(aNDCG - bNDCG).toFixed(3)} | ${((aNDCG - bNDCG) / (bNDCG || 1) * 100).toFixed(1)}% |`);
  md.push(`| Source Accuracy | ${(bSrc * 100).toFixed(1)}% | ${(aSrc * 100).toFixed(1)}% | ${((aSrc - bSrc) * 100) >= 0 ? '+' : ''}${((aSrc - bSrc) * 100).toFixed(1)}pp | — |`);
  md.push('');

  // Per-query delta
  md.push('## Per-Query Comparison');
  md.push('');
  md.push('| Query | Baseline P@1 | PR#64 P@1 | Baseline Source | PR#64 Source | Improved? |');
  md.push('|-------|-------------|-----------|-----------------|-------------|-----------|');
  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i];
    if (q.relevant.length === 0) continue;
    const b = baseline[i];
    const a = boosted[i];
    const improved = a.precision1 > b.precision1 || (a.sourceCorrect && !b.sourceCorrect);
    md.push(`| ${q.description.slice(0, 45)} | ${b.precision1.toFixed(2)} | ${a.precision1.toFixed(2)} | ${b.topSource} | ${a.topSource} | ${improved ? 'YES' : a.precision1 === b.precision1 ? 'SAME' : 'NO'} |`);
  }
  md.push('');

  md.push('## Methodology');
  md.push('');
  md.push('- **Engine:** PGLite (in-memory, Postgres 17.5 via WASM)');
  md.push('- **Pages:** 5 test pages (2 person, 2 company, 1 concept) with 2 chunks each');
  md.push('- **Embeddings:** Structured basis vectors with blending (deterministic cosine distances)');
  md.push('- **Queries:** 7 with ground truth + 1 negative control');
  md.push('- **Baseline:** Standard RRF fusion (K=60), no normalization, no source boost');
  md.push('- **PR #64:** RRF normalized to 0-1, 2.0x compiled_truth boost, source-aware dedup');
  md.push('- **Metrics:** P@1 (precision at rank 1), MRR (mean reciprocal rank), nDCG@5, source accuracy');
  md.push('');
  md.push('## What Changed in PR #64');
  md.push('');
  md.push('1. **RRF normalization** — scores normalized to 0-1 before boosting');
  md.push('2. **Compiled truth boost** — 2.0x multiplier for compiled_truth chunks');
  md.push('3. **Source-aware dedup** — guarantees compiled truth chunk per page in results');
  md.push('4. **Cosine re-scoring** — blends RRF + cosine similarity (0.7/0.3) before dedup');
  md.push('5. **Detail parameter** — `--detail low/medium/high` controls timeline inclusion');
  md.push('6. **CJK word count** — fixes query expansion for Chinese/Japanese/Korean');
  md.push('7. **Eval harness** — `gbrain eval` with P@k, R@k, MRR, nDCG@k + A/B comparison');

  const output = md.join('\n');
  console.log(output);

  // Write to file
  const fs = require('fs');
  fs.mkdirSync('docs/benchmarks', { recursive: true });
  fs.writeFileSync(`docs/benchmarks/${date}.md`, output);
  console.log(`\nWritten to docs/benchmarks/${date}.md`);

  await engine.disconnect();
}

main().catch(console.error);

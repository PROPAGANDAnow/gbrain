import { loadConfig, saveConfig, type GBrainConfig } from '../src/core/config.ts';
import { createEngine } from '../src/core/engine-factory.ts';

const targetUrl = process.argv[2];
if (!targetUrl) throw new Error('Usage: bun tmp/manual_finish_pg_migration.ts <postgres-url>');

const sourceCfg = loadConfig();
if (!sourceCfg) throw new Error('No local GBrain config found');

const source = await createEngine({
  engine: sourceCfg.engine,
  database_path: sourceCfg.database_path,
  database_url: sourceCfg.database_url,
});
const target = await createEngine({ engine: 'postgres', database_url: targetUrl });

try {
  await source.connect({
    engine: sourceCfg.engine,
    database_path: sourceCfg.database_path,
    database_url: sourceCfg.database_url,
  });
  await target.connect({ engine: 'postgres', database_url: targetUrl });
  await target.initSchema();

  const sourceStats = await source.getStats();
  const targetStatsBefore = await target.getStats();

  const legacyLinks = await source.executeRaw<{
    from_slug: string;
    to_slug: string;
    link_type: string | null;
    context: string | null;
  }>(`
    SELECT p1.slug AS from_slug,
           p2.slug AS to_slug,
           l.link_type AS link_type,
           l.context AS context
    FROM links l
    JOIN pages p1 ON p1.id = l.from_page_id
    JOIN pages p2 ON p2.id = l.to_page_id
  `);

  let migratedLinks = 0;
  let skippedLinks = 0;
  for (const row of legacyLinks) {
    try {
      await target.addLink(
        row.from_slug,
        row.to_slug,
        row.context ?? '',
        row.link_type ?? '',
      );
      migratedLinks++;
    } catch {
      skippedLinks++;
    }
  }

  for (const key of ['embedding_model', 'embedding_dimensions', 'chunk_strategy']) {
    try {
      const val = await source.getConfig(key);
      if (val) await target.setConfig(key, val);
    } catch {
      // ignore config key copy failures
    }
  }

  const newConfig: GBrainConfig = {
    engine: 'postgres',
    database_url: targetUrl,
  };
  saveConfig(newConfig);

  const targetStatsAfter = await target.getStats();
  const targetHealth = await target.getHealth();
  const schemaVersion = await target.getConfig('version');

  console.log(JSON.stringify({
    source_engine: sourceCfg.engine,
    source_pages: sourceStats.page_count,
    target_pages_before: targetStatsBefore.page_count,
    target_pages_after: targetStatsAfter.page_count,
    target_schema_version: schemaVersion,
    links_seen_in_source: legacyLinks.length,
    links_migrated_attempts: migratedLinks,
    links_skipped: skippedLinks,
    embed_coverage: targetHealth.embed_coverage,
    missing_embeddings: targetHealth.missing_embeddings,
    config_switched_to: 'postgres',
  }, null, 2));
} finally {
  try { await source.disconnect(); } catch {}
  try { await target.disconnect(); } catch {}
}

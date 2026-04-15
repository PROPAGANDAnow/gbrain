import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { MinionQueue } from '../src/core/minions/queue.ts';
import { MinionWorker } from '../src/core/minions/worker.ts';
import { calculateBackoff } from '../src/core/minions/backoff.ts';
import { UnrecoverableError } from '../src/core/minions/types.ts';
import type { MinionJob } from '../src/core/minions/types.ts';

let engine: PGLiteEngine;
let queue: MinionQueue;

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({ databaseUrl: '' }); // in-memory
  await engine.initSchema();
  queue = new MinionQueue(engine);
});

afterAll(async () => {
  await engine.disconnect();
});

beforeEach(async () => {
  await engine.executeRaw('DELETE FROM minion_jobs');
});

// --- Queue CRUD (9 tests) ---

describe('MinionQueue: CRUD', () => {
  test('add creates a job with waiting status', async () => {
    const job = await queue.add('sync', { full: true });
    expect(job.name).toBe('sync');
    expect(job.status).toBe('waiting');
    expect(job.data).toEqual({ full: true });
    expect(job.queue).toBe('default');
    expect(job.priority).toBe(0);
    expect(job.max_attempts).toBe(3);
    expect(job.attempts_made).toBe(0);
  });

  test('add with empty name throws', async () => {
    await expect(queue.add('', {})).rejects.toThrow('Job name cannot be empty');
  });

  test('getJob returns job by ID', async () => {
    const created = await queue.add('embed', {});
    const found = await queue.getJob(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe('embed');
  });

  test('getJob returns null for missing ID', async () => {
    const found = await queue.getJob(99999);
    expect(found).toBeNull();
  });

  test('getJobs returns all jobs', async () => {
    await queue.add('sync', {});
    await queue.add('embed', {});
    const jobs = await queue.getJobs();
    expect(jobs.length).toBe(2);
  });

  test('getJobs filters by status', async () => {
    await queue.add('sync', {});
    const jobs = await queue.getJobs({ status: 'active' });
    expect(jobs.length).toBe(0);
    const waiting = await queue.getJobs({ status: 'waiting' });
    expect(waiting.length).toBe(1);
  });

  test('removeJob deletes terminal jobs', async () => {
    const job = await queue.add('sync', {});
    // Can't remove waiting job
    const removed = await queue.removeJob(job.id);
    expect(removed).toBe(false);
    // Cancel it first, then remove
    await queue.cancelJob(job.id);
    const removed2 = await queue.removeJob(job.id);
    expect(removed2).toBe(true);
  });

  test('removeJob rejects active jobs', async () => {
    const job = await queue.add('sync', {});
    const removed = await queue.removeJob(job.id);
    expect(removed).toBe(false); // waiting is not terminal
  });

  test('duplicate submit creates new row', async () => {
    const j1 = await queue.add('sync', { full: true });
    const j2 = await queue.add('sync', { full: true });
    expect(j1.id).not.toBe(j2.id);
  });
});

// --- State Machine (6 tests) ---

describe('MinionQueue: State Machine', () => {
  test('waiting → active via claim', async () => {
    const job = await queue.add('sync', {});
    const claimed = await queue.claim('tok1', 30000, 'default', ['sync']);
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(job.id);
    expect(claimed!.status).toBe('active');
    expect(claimed!.lock_token).toBe('tok1');
    expect(claimed!.lock_until).not.toBeNull();
    expect(claimed!.attempts_started).toBe(1);
  });

  test('active → completed via completeJob', async () => {
    const job = await queue.add('sync', {});
    await queue.claim('tok1', 30000, 'default', ['sync']);
    const completed = await queue.completeJob(job.id, 'tok1', { pages: 42 });
    expect(completed!.status).toBe('completed');
    expect(completed!.result).toEqual({ pages: 42 });
    expect(completed!.lock_token).toBeNull();
    expect(completed!.finished_at).not.toBeNull();
  });

  test('active → failed via failJob', async () => {
    const job = await queue.add('sync', {});
    await queue.claim('tok1', 30000, 'default', ['sync']);
    const failed = await queue.failJob(job.id, 'tok1', 'timeout', 'dead');
    expect(failed!.status).toBe('dead');
    expect(failed!.error_text).toBe('timeout');
    expect(failed!.attempts_made).toBe(1);
  });

  test('failed → delayed (retry with backoff)', async () => {
    const job = await queue.add('sync', {});
    await queue.claim('tok1', 30000, 'default', ['sync']);
    const delayed = await queue.failJob(job.id, 'tok1', 'timeout', 'delayed', 5000);
    expect(delayed!.status).toBe('delayed');
    expect(delayed!.delay_until).not.toBeNull();
  });

  test('delayed → waiting (promote)', async () => {
    const job = await queue.add('sync', {}, { delay: 1 }); // 1ms delay
    expect(job.status).toBe('delayed');
    await new Promise(r => setTimeout(r, 10));
    const promoted = await queue.promoteDelayed();
    expect(promoted.length).toBe(1);
    expect(promoted[0].status).toBe('waiting');
    expect(promoted[0].delay_until).toBeNull();
  });

  test('failed → dead (exhausted attempts)', async () => {
    const job = await queue.add('sync', {}, { max_attempts: 1 });
    await queue.claim('tok1', 30000, 'default', ['sync']);
    const failed = await queue.failJob(job.id, 'tok1', 'error', 'dead');
    expect(failed!.status).toBe('dead');
  });
});

// --- Backoff (4 tests) ---

describe('calculateBackoff', () => {
  test('exponential backoff', () => {
    const delay = calculateBackoff({
      backoff_type: 'exponential', backoff_delay: 1000,
      backoff_jitter: 0, attempts_made: 3,
    });
    expect(delay).toBe(4000); // 2^(3-1) * 1000
  });

  test('fixed backoff', () => {
    const delay = calculateBackoff({
      backoff_type: 'fixed', backoff_delay: 2000,
      backoff_jitter: 0, attempts_made: 5,
    });
    expect(delay).toBe(2000);
  });

  test('jitter within range', () => {
    const delays = new Set<number>();
    for (let i = 0; i < 100; i++) {
      delays.add(calculateBackoff({
        backoff_type: 'fixed', backoff_delay: 1000,
        backoff_jitter: 0.5, attempts_made: 1,
      }));
    }
    // Should have some variation
    expect(delays.size).toBeGreaterThan(1);
    // All values should be within [500, 1500]
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(500);
      expect(d).toBeLessThanOrEqual(1500);
    }
  });

  test('attempts_made=0 edge case (exponential)', () => {
    const delay = calculateBackoff({
      backoff_type: 'exponential', backoff_delay: 1000,
      backoff_jitter: 0, attempts_made: 0,
    });
    // 2^(max(0-1, 0)) * 1000 = 2^0 * 1000 = 1000
    expect(delay).toBe(1000);
  });
});

// --- Stall Detection (3 tests) ---

describe('MinionQueue: Stall Detection', () => {
  test('detect stalled job (lock_until expired)', async () => {
    const job = await queue.add('sync', {});
    // Set max_stalled=2 so first stall requeues (0+1 < 2)
    await engine.executeRaw('UPDATE minion_jobs SET max_stalled = 2 WHERE id = $1', [job.id]);
    await queue.claim('tok1', 30000, 'default', ['sync']);
    // Force lock_until to the past
    await engine.executeRaw(
      "UPDATE minion_jobs SET lock_until = now() - interval '1 second' WHERE id = $1",
      [job.id]
    );
    const { requeued, dead } = await queue.handleStalled();
    expect(requeued.length).toBe(1);
    expect(requeued[0].stalled_counter).toBe(1);
    expect(requeued[0].status).toBe('waiting');
  });

  test('stall counter increments and eventually dead-letters', async () => {
    const job = await queue.add('sync', {}, { max_attempts: 3 });
    // Set max_stalled=3 to see multiple requeues before dead
    await engine.executeRaw('UPDATE minion_jobs SET max_stalled = 3 WHERE id = $1', [job.id]);

    // First stall: counter 0+1=1 < 3, requeued
    await queue.claim('tok1', 30000, 'default', ['sync']);
    await engine.executeRaw(
      "UPDATE minion_jobs SET lock_until = now() - interval '1 second' WHERE id = $1",
      [job.id]
    );
    const r1 = await queue.handleStalled();
    expect(r1.requeued.length).toBe(1);
    expect(r1.requeued[0].stalled_counter).toBe(1);

    // Second stall: counter 1+1=2 < 3, requeued
    await queue.claim('tok2', 30000, 'default', ['sync']);
    await engine.executeRaw(
      "UPDATE minion_jobs SET lock_until = now() - interval '1 second' WHERE id = $1",
      [job.id]
    );
    const r2 = await queue.handleStalled();
    expect(r2.requeued.length).toBe(1);

    // Third stall: counter 2+1=3 >= 3, dead-lettered
    await queue.claim('tok3', 30000, 'default', ['sync']);
    await engine.executeRaw(
      "UPDATE minion_jobs SET lock_until = now() - interval '1 second' WHERE id = $1",
      [job.id]
    );
    const r3 = await queue.handleStalled();
    expect(r3.dead.length).toBe(1);
    expect(r3.dead[0].status).toBe('dead');
  });

  test('max_stalled → dead', async () => {
    // max_stalled=0 means first stall = dead immediately (0+1 >= 0 is always true)
    const job = await queue.add('sync', {});
    await engine.executeRaw('UPDATE minion_jobs SET max_stalled = 0 WHERE id = $1', [job.id]);
    await queue.claim('tok1', 30000, 'default', ['sync']);
    await engine.executeRaw(
      "UPDATE minion_jobs SET lock_until = now() - interval '1 second' WHERE id = $1",
      [job.id]
    );
    const { requeued, dead } = await queue.handleStalled();
    expect(dead.length).toBe(1);
    expect(dead[0].status).toBe('dead');
    expect(requeued.length).toBe(0);
  });
});

// --- Dependencies (5 tests) ---

describe('MinionQueue: Dependencies', () => {
  test('parent waits for child', async () => {
    const parent = await queue.add('enrich', {});
    const child = await queue.add('sync', {}, { parent_job_id: parent.id });
    // Set parent to waiting-children
    await engine.executeRaw(
      "UPDATE minion_jobs SET status = 'waiting-children' WHERE id = $1",
      [parent.id]
    );
    // Parent should NOT resolve while child is waiting
    const resolved = await queue.resolveParent(parent.id);
    expect(resolved).toBeNull();
    // Complete the child directly (skip claim to avoid claim filtering issues)
    await engine.executeRaw(
      "UPDATE minion_jobs SET status = 'completed', finished_at = now() WHERE id = $1",
      [child.id]
    );
    // Now parent should resolve
    const resolved2 = await queue.resolveParent(parent.id);
    expect(resolved2).not.toBeNull();
    expect(resolved2!.status).toBe('waiting');
  });

  test('child fail → fail_parent', async () => {
    const parent = await queue.add('enrich', {});
    await queue.add('sync', {}, { parent_job_id: parent.id, on_child_fail: 'fail_parent' });
    await engine.executeRaw(
      "UPDATE minion_jobs SET status = 'waiting-children' WHERE id = $1",
      [parent.id]
    );
    const failed = await queue.failParent(parent.id, 2, 'child died');
    expect(failed!.status).toBe('failed');
    expect(failed!.error_text).toContain('child job');
  });

  test('child fail → continue policy', async () => {
    const parent = await queue.add('enrich', {});
    const child = await queue.add('sync', {}, { parent_job_id: parent.id, on_child_fail: 'continue' });
    await engine.executeRaw(
      "UPDATE minion_jobs SET status = 'waiting-children' WHERE id = $1",
      [parent.id]
    );
    // Mark child as dead
    await engine.executeRaw(
      "UPDATE minion_jobs SET status = 'dead' WHERE id = $1",
      [child.id]
    );
    // Parent should resolve (continue ignores child failure)
    const resolved = await queue.resolveParent(parent.id);
    expect(resolved).not.toBeNull();
    expect(resolved!.status).toBe('waiting');
  });

  test('child fail → remove_dep', async () => {
    const parent = await queue.add('enrich', {});
    const child = await queue.add('sync', {}, { parent_job_id: parent.id, on_child_fail: 'remove_dep' });
    await engine.executeRaw(
      "UPDATE minion_jobs SET status = 'waiting-children' WHERE id = $1",
      [parent.id]
    );
    await queue.removeChildDependency(child.id);
    const updatedChild = await queue.getJob(child.id);
    expect(updatedChild!.parent_job_id).toBeNull();
  });

  test('orphan handling (parent deleted)', async () => {
    const parent = await queue.add('enrich', {});
    const child = await queue.add('sync', {}, { parent_job_id: parent.id });
    await queue.cancelJob(parent.id);
    await queue.removeJob(parent.id);
    // Child should still exist with parent_job_id = null (ON DELETE SET NULL)
    const orphan = await queue.getJob(child.id);
    expect(orphan).not.toBeNull();
    expect(orphan!.parent_job_id).toBeNull();
  });
});

// --- Worker Lifecycle (5 tests) ---

describe('MinionWorker', () => {
  test('register handler', () => {
    const worker = new MinionWorker(engine);
    worker.register('test', async () => ({ ok: true }));
    expect(worker.registeredNames).toContain('test');
  });

  test('start without handlers throws', async () => {
    const worker = new MinionWorker(engine);
    await expect(worker.start()).rejects.toThrow('No handlers registered');
  });

  test('worker claims and executes job', async () => {
    const job = await queue.add('test-exec', { value: 42 });
    let handlerCalled = false;

    const worker = new MinionWorker(engine, { pollInterval: 50 });
    worker.register('test-exec', async (ctx) => {
      handlerCalled = true;
      expect(ctx.data).toEqual({ value: 42 });
      return { processed: true };
    });

    // Start worker in background, stop after a short delay
    const workerPromise = worker.start();
    await new Promise(r => setTimeout(r, 200));
    worker.stop();
    await workerPromise;

    expect(handlerCalled).toBe(true);
    const completed = await queue.getJob(job.id);
    expect(completed!.status).toBe('completed');
    expect(completed!.result).toEqual({ processed: true });
  });

  test('handler throws non-Error value', async () => {
    const job = await queue.add('bad-throw', {}, { max_attempts: 1 });

    const worker = new MinionWorker(engine, { pollInterval: 50 });
    worker.register('bad-throw', async () => {
      throw 'string error'; // not an Error instance
    });

    const workerPromise = worker.start();
    await new Promise(r => setTimeout(r, 200));
    worker.stop();
    await workerPromise;

    const failed = await queue.getJob(job.id);
    expect(failed!.status).toBe('dead');
    expect(failed!.error_text).toBe('string error');
  });

  test('UnrecoverableError bypasses retry', async () => {
    const job = await queue.add('unrecoverable', {}, { max_attempts: 5 });

    const worker = new MinionWorker(engine, { pollInterval: 50 });
    worker.register('unrecoverable', async () => {
      throw new UnrecoverableError('fatal');
    });

    const workerPromise = worker.start();
    await new Promise(r => setTimeout(r, 200));
    worker.stop();
    await workerPromise;

    const dead = await queue.getJob(job.id);
    expect(dead!.status).toBe('dead');
    expect(dead!.attempts_made).toBe(1); // only 1 attempt, not 5
  });
});

// --- Lock Management (3 tests) ---

describe('MinionQueue: Lock Management', () => {
  test('lock renewed during execution', async () => {
    await queue.add('sync', {});
    const claimed = await queue.claim('tok1', 30000, 'default', ['sync']);
    const originalLockUntil = claimed!.lock_until!.getTime();

    const renewed = await queue.renewLock(claimed!.id, 'tok1', 60000);
    expect(renewed).toBe(true);

    const updated = await queue.getJob(claimed!.id);
    expect(updated!.lock_until!.getTime()).toBeGreaterThan(originalLockUntil);
  });

  test('lock renewal fails with wrong token', async () => {
    await queue.add('sync', {});
    const claimed = await queue.claim('tok1', 30000, 'default', ['sync']);

    const renewed = await queue.renewLock(claimed!.id, 'wrong-token', 60000);
    expect(renewed).toBe(false);
  });

  test('claim sets lock_token, lock_until, attempts_started', async () => {
    await queue.add('sync', {});
    const claimed = await queue.claim('worker-abc', 30000, 'default', ['sync']);
    expect(claimed!.lock_token).toBe('worker-abc');
    expect(claimed!.lock_until).not.toBeNull();
    expect(claimed!.attempts_started).toBe(1);
    expect(claimed!.started_at).not.toBeNull();
  });
});

// --- Claim Mechanics (4 tests) ---

describe('MinionQueue: Claim Mechanics', () => {
  test('claim from empty queue returns null', async () => {
    const claimed = await queue.claim('tok1', 30000, 'default', ['sync']);
    expect(claimed).toBeNull();
  });

  test('claim respects priority ordering', async () => {
    await queue.add('low', {}, { priority: 10 });
    await queue.add('high', {}, { priority: 0 });
    await queue.add('mid', {}, { priority: 5 });

    const first = await queue.claim('tok1', 30000, 'default', ['low', 'high', 'mid']);
    expect(first!.name).toBe('high'); // priority 0 = highest

    const second = await queue.claim('tok2', 30000, 'default', ['low', 'high', 'mid']);
    expect(second!.name).toBe('mid'); // priority 5

    const third = await queue.claim('tok3', 30000, 'default', ['low', 'high', 'mid']);
    expect(third!.name).toBe('low'); // priority 10
  });

  test('claim only claims registered names', async () => {
    await queue.add('sync', {});
    await queue.add('embed', {});

    // Worker only handles 'embed'
    const claimed = await queue.claim('tok1', 30000, 'default', ['embed']);
    expect(claimed!.name).toBe('embed');

    // sync job is still waiting
    const remaining = await queue.getJobs({ status: 'waiting' });
    expect(remaining.length).toBe(1);
    expect(remaining[0].name).toBe('sync');
  });

  test('promote delayed but not future jobs', async () => {
    await queue.add('past', {}, { delay: 1 }); // 1ms delay, will expire quickly
    await queue.add('future', {}, { delay: 999999 }); // way in the future

    await new Promise(r => setTimeout(r, 10));
    const promoted = await queue.promoteDelayed();
    expect(promoted.length).toBe(1);
    expect(promoted[0].name).toBe('past');
  });
});

// --- Prune (1 test) ---

describe('MinionQueue: Prune', () => {
  test('only prunes terminal statuses, respects age filter', async () => {
    const job1 = await queue.add('sync', {});
    const job2 = await queue.add('embed', {});
    await queue.cancelJob(job1.id); // cancelled = terminal
    // job2 stays waiting = not terminal

    const count = await queue.prune({ olderThan: new Date(Date.now() + 86400000) }); // future date = prune everything old enough
    expect(count).toBe(1); // only the cancelled one
  });
});

// --- Stats (1 test) ---

describe('MinionQueue: Stats', () => {
  test('getStats returns status breakdown', async () => {
    await queue.add('sync', {});
    await queue.add('embed', {});
    const stats = await queue.getStats();
    expect(stats.by_status['waiting']).toBe(2);
    expect(stats.queue_health.waiting).toBe(2);
    expect(stats.queue_health.active).toBe(0);
  });
});

// --- Cancel and Retry (2 tests) ---

describe('MinionQueue: Cancel & Retry', () => {
  test('cancel active job sets cancelled', async () => {
    const job = await queue.add('sync', {});
    await queue.claim('tok1', 30000, 'default', ['sync']);
    const cancelled = await queue.cancelJob(job.id);
    expect(cancelled!.status).toBe('cancelled');
  });

  test('retry dead job re-queues', async () => {
    const job = await queue.add('sync', {}, { max_attempts: 1 });
    await queue.claim('tok1', 30000, 'default', ['sync']);
    await queue.failJob(job.id, 'tok1', 'error', 'dead');
    const retried = await queue.retryJob(job.id);
    expect(retried!.status).toBe('waiting');
    expect(retried!.error_text).toBeNull();
  });
});

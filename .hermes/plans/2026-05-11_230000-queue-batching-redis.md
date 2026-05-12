# Queue & Batching Architecture for tg-knowledge-bot

## Goal

Replace the current in-process polling loop (`while(true) { processAllUnprocessed(); sleep(30s) }`) with a proper job queue system using Redis. Decouple ingestion from classification/embedding/KB-creation so they scale independently and don't block each other.

## Current Architecture (Problems)

```
Telegram ──→ ingestor (gramjs) ──→ SQLite INSERT ──→ [30s poll loop] ──→ classify → embed → dedup → quality → KB
                                          ↑                                                    ↑
                                   single process                                      single process, serial
                                   no backpressure                                     no retry on failure
                                   no prioritization                                   LLM calls are slow (1-3s each)
```

**Issues:**
- Ingestor and analyzer are tightly coupled in one `--mode=all` process
- 30-second polling adds unnecessary latency
- No retry on LLM failures — message just gets marked `processedAt` and skipped
- No batching — each message is classified individually (expensive, slow)
- No prioritization — noise gets the same treatment as answers
- No concurrency — can't parallelize embedding + classification

## Proposed Architecture

```
┌─────────────┐     ┌───────────┐     ┌──────────┐     ┌────────────────┐
│  INGESTOR   │────→│   REDIS   │────→│ WORKERS  │────→│    SQLITE      │
│  (gramjs)   │     │  (queue)  │     │ (N proc) │     │  (knowledge)   │
│  Process 1  │     │           │     │          │     │                │
│             │     │ Streams:  │     │ classify │     │ users          │
│ raw msg     │     │ ─ ingest  │     │ embed    │     │ messages       │
│ → SQLite    │     │ ─ classify│     │ quality  │     │ knowledge_*    │
│ → enqueue   │     │ ─ embed   │     │ kb-write │     │ user_activity  │
└─────────────┘     └───────────┘     └──────────┘     └────────────────┘
```

### Queue Streams (Redis Streams)

| Stream | Producer | Consumer | Payload | Batching |
|--------|----------|----------|---------|----------|
| `stream:ingest` | Ingestor | Ingest worker | `{ tgMessageId, text, userId, chatId, replyTo, timestamp }` | 1-at-a-time (real-time) |
| `stream:classify` | Ingest worker | Classify worker | `{ messageId, text }` | **Batch of 10** (LLM call) |
| `stream:embed` | Classify worker | Embed worker | `{ messageId, text, classification }` | **Batch of 20** (embedding API) |
| `stream:kb` | Embed worker | KB worker | `{ messageId, embedding, classification, userId, reactions }` | 1-at-a-time (dedup + quality) |

### Why Redis Streams over BullMQ

- **BullMQ** = BullMQ is a great Redis-based queue for Node.js, but it's designed for job queues (unique jobs, priorities, retries). It adds overhead we don't need.
- **Redis Streams** = Lightweight, built-in consumer groups, `XREADGROUP` for fan-out, `XPENDING` for dead-letter detection. Native to Redis 5+. No extra dependencies beyond `ioredis`.
- **Verdict: BullMQ** — it's the standard for TS job queues, gives us retries, priorities, rate limiting, dashboards (Bull Board) out of the box. Streams are lower-level; BullMQ is built on them anyway.

**Decision: Use BullMQ.** It's the right abstraction level for this.

## New Packages

```
pnpm add bullmq ioredis
```

Both are mature, well-typed, zero-dependency-friendly.

## Queue Definitions

### `src/queue/queues.ts` — Queue registry

```typescript
import { Queue, Worker, QueueScheduler } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

// Queues (producers push to these)
export const ingestQueue = new Queue('ingest', { connection });
export const classifyQueue = new Queue('classify', { connection });
export const embedQueue = new Queue('embed', { connection });
export const kbQueue = new Queue('kb', { connection });
```

### `src/queue/workers.ts` — Worker definitions

```typescript
// Classify worker — processes messages in batches of 10
const classifyWorker = new Worker('classify', async (job) => {
  // job.data = { messageId, text }
  const classification = await classifyMessage(job.data.text, config);
  await embedQueue.add('embed', {
    messageId: job.data.messageId,
    text: job.data.text,
    classification,
  });
}, { connection, concurrency: 3 });

// Embed worker — processes in batches of 20
const embedWorker = new Worker('embed', async (jobs) => {
  // Batch: collect embeddings for multiple texts at once
  const embedding = await generateEmbedding(job.data.text, config);
  await kbQueue.add('kb', {
    messageId: job.data.messageId,
    embedding,
    classification: job.data.classification,
    ...
  });
}, { connection, concurrency: 2 });

// KB worker — writes to knowledge base (serial, needs dedup)
const kbWorker = new Worker('kb', async (job) => {
  // dedup check → quality score → insert/update KB
}, { connection, concurrency: 1 });
```

## New Files

```
src/queue/
  queues.ts        — Queue instances (ingest, classify, embed, kb)
  workers.ts       — Worker definitions with concurrency + retry config
  jobs.ts          — Job type definitions (TypedJob<T> per queue)
  index.ts         — Start all workers, graceful shutdown
src/config.ts      — Add REDIS_URL (default: redis://localhost:6379)
docker-compose.yml — Add redis service
```

## Modified Files

| File | Change |
|------|--------|
| `src/config.ts` | Add `REDIS_URL` env var |
| `src/ingestor/index.ts` | After SQLite INSERT, push job to `classifyQueue` instead of waiting for poll |
| `src/analyzer/index.ts` | Split into separate worker functions: `classifyWorker`, `embedWorker`, `kbWorker` |
| `src/main.ts` | Remove DDL block. Call `migrate()` on startup. `--mode=all` starts workers instead of poll loop. New `--mode=worker` starts only workers. |
| `src/db/migrate.ts` | New: programmatic migration runner using `drizzle-orm/better-sqlite3/migrator` |
| `docker-compose.yml` | Add `redis:7-alpine` service |
| `.env.example` | Add `REDIS_URL` |
| `package.json` | Add `bullmq`, `ioredis` deps |

## Migrations (replacing manual DDL)

**Current problem:** `src/main.ts` has 60 lines of raw `CREATE TABLE IF NOT EXISTS` SQL that must stay in sync with `src/db/schema.ts`. They *will* drift.

**Solution: drizzle-kit migrations.** `drizzle.config.ts` already exists. The schema in `src/db/schema.ts` is the single source of truth.

### Migration workflow

```bash
# After changing src/db/schema.ts:
pnpm drizzle-kit generate    # → creates drizzle/0001_*.sql

# Apply to DB:
pnpm drizzle-kit migrate     # runs pending SQL files, tracks in __drizzle_migrations
```

### Programmatic migration on startup

`src/db/migrate.ts`:
```typescript
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

export function runMigrations(db: BetterSQLite3Database) {
  migrate(db, { migrationsFolder: './drizzle' });
}
```

`src/main.ts` replaces the 60-line DDL block with:
```typescript
const { db, sqlite, close } = createDB(config.DATABASE_PATH);
runMigrations(db);
```

### Initial migration

Generate the first migration from existing schema:
```bash
pnpm drizzle-kit generate    # produces drizzle/0000_initial.sql
pnpm drizzle-kit migrate     # applies it
```

### Future schema changes

1. Edit `src/db/schema.ts` (add column, table, index)
2. `pnpm drizzle-kit generate` — produces `drizzle/0001_add_whatever.sql`
3. `git add drizzle/` — migration SQL is version-controlled
4. On deploy: `pnpm drizzle-kit migrate` applies pending migrations

**No manual SQL. No drift. No `CREATE TABLE IF NOT EXISTS` blocks.**

## Pipeline Flow (After)

```
1. Ingestor receives TG message
2. INSERT into SQLite (users + messages tables) — synchronous, fast
3. classifyQueue.add({ messageId, text }) — fire-and-forget
4. Classify worker picks up (concurrency: 3)
   → LLM classify → update classification in DB
   → embedQueue.add({ messageId, text, classification })
5. Embed worker picks up (concurrency: 2)
   → Generate embedding → update embedding in DB
   → If classification=answer: kbQueue.add({ messageId, embedding, ... })
   → Else: mark processedAt, done
6. KB worker picks up (concurrency: 1 — dedup must be serial)
   → Find similar KB entry → quality score → insert/update KB
   → Mark processedAt
```

## Retries & Error Handling

| Queue | Retries | Backoff | Dead Letter |
|-------|---------|---------|-------------|
| classify | 3 | exponential (5s, 30s, 120s) | Log + mark message as `classification_error` |
| embed | 2 | 10s, 60s | Log + mark processed (embedding optional) |
| kb | 3 | 30s, 120s, 300s | Log + alert |

BullMQ config:
```typescript
new Worker('classify', processor, {
  connection,
  concurrency: 3,
  limiter: { max: 10, duration: 1000 }, // 10 jobs/sec max (rate limit for LLM API)
});
```

## Batching Strategy

**Embedding batch** (biggest win):
- Collect up to 20 messages in a Redis sorted set keyed by time
- Worker drains the set every 2 seconds or when it hits 20 items
- Send one API call with 20 texts → 20 embeddings
- **Cost reduction: ~10-20x** vs individual calls

**Classification batch**:
- Less beneficial since each message may need different context
- Keep at concurrency: 3 but individual jobs

**KB writes**:
- Must be serial (dedup requires reading existing entries)
- Concurrency: 1

## Redis Sizing

- 3K users × ~500 messages/day × ~500 bytes/job = ~250KB/day in Redis
- Jobs are processed and removed within seconds
- Redis memory: <50MB at steady state
- **redis:7-alpine** = 30MB RAM, perfect

## docker-compose.yml

```yaml
services:
  bot:
    build: .
    env_file: .env
    depends_on:
      - redis
    volumes:
      - ./data:/app/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes --maxmemory 64mb --maxmemory-policy allkeys-lru

volumes:
  redis-data:
```

## Migration Plan (Step by Step)

### Step 0: Replace DDL with drizzle-kit migrations
- `pnpm drizzle-kit generate` — creates initial migration from `src/db/schema.ts`
- Create `src/db/migrate.ts` — programmatic runner
- `src/main.ts` — remove 60-line `sqlite.exec(CREATE TABLE...)` block, call `runMigrations(db)` instead
- `pnpm drizzle-kit migrate` — verify it applies cleanly
- Add `drizzle/` dir to git (migration SQL files are version-controlled)

### Step 1: Add Redis + BullMQ deps
- `pnpm add bullmq ioredis`
- Add `REDIS_URL` to config + .env.example
- Update docker-compose with redis service

### Step 2: Create queue infrastructure
- `src/queue/queues.ts` — 4 queues (ingest, classify, embed, kb)
- `src/queue/jobs.ts` — typed job payloads per queue
- `src/queue/workers.ts` — worker definitions

### Step 3: Refactor ingestor
- After SQLite INSERT, push to `classifyQueue` instead of no-op
- Remove backfill from ingestor (or make backfill push to classify queue too)

### Step 4: Split analyzer into workers
- `classifyWorker` — picks from classify queue, runs LLM, pushes to embed queue
- `embedWorker` — picks from embed queue, generates embedding, pushes to kb queue (if answer)
- `kbWorker` — picks from kb queue, runs dedup + quality + KB write

### Step 5: Update main.ts
- `--mode=all` starts ingestor + all workers
- `--mode=ingest` starts only ingestor
- `--mode=worker` starts only workers (classify + embed + kb)
- `--mode=analyze` stays as-is for batch processing (no queue)
- Remove the 30-second poll loop entirely

### Step 6: Add embedding batch processor
- `embedWorker` collects jobs for 2 seconds or batch size of 20
- Sends batch embedding request
- Distributes results back to individual kb queue jobs

### Step 7: Graceful shutdown
- SIGTERM handler drains all workers
- Waits for in-flight jobs to complete
- Closes Redis connections

## Open Questions

1. **Embedding batch timing** — How long to wait before flushing a partial batch? 2s is a good start, but might need tuning based on message volume
2. **Worker process separation** — Run all workers in one process (simpler) or separate processes (isolated)? Start with one process, split later if needed
3. **Redis persistence** — `appendonly yes` is safe but not critical; if Redis loses data, unprocessed messages still exist in SQLite and can be re-enqueued via `--mode=analyze`
4. **Backfill** — Should backfill push 200 messages to the classify queue at once, or trickle them? Start with trickle (1/second rate limit) to avoid LLM API burst

## Validation

- `pnpm run seed` — unchanged (no queue needed)
- `pnpm run analyze` — unchanged (batch mode, no queue)
- `docker compose up` — starts bot + redis
- Ingestor receives message → classify queue → embed queue → kb queue → KB entry
- Watch queue depth: `redis-cli LLEN classify` (should stay near 0)
- Kill worker mid-processing → job retries on restart

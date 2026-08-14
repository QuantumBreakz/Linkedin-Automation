# 02 — System Architecture

## Shape

A **modular monolith** with a separate worker process. One deployable Next.js app, one worker,
one Postgres, one Redis. Microservices would buy us nothing at this stage and would cost us
transactional integrity across the pipeline.

```
┌──────────────────────────────────────────────────────────┐
│  Next.js (App Router, TypeScript)                        │
│  ├─ /app            dashboard, calendar, drafts, sources │
│  ├─ /app/api        REST route handlers                  │
│  └─ /app/api/auth   NextAuth: LinkedIn OIDC + email      │
└───────────────┬──────────────────────────────────────────┘
                │ imports directly (same process)
┌───────────────▼──────────────────────────────────────────┐
│  src/services/  — the application core                   │
│  ├─ linkedin/     OAuth, token lifecycle, publishing     │
│  ├─ sources/      connector registry + adapters          │
│  ├─ ingest/       normalisation, dedup, retraction gate  │
│  ├─ analysis/     extraction, provenance, verification   │
│  ├─ content/      format selection, drafting, brand      │
│  ├─ visual/       spec → SVG → PNG                       │
│  ├─ scheduling/   calendar, slot assignment              │
│  └─ llm/          provider abstraction, role routing     │
└───────────────┬──────────────────────────────────────────┘
                │ Prisma
┌───────────────▼──────────────┐   ┌──────────────────────┐
│  PostgreSQL                  │   │  Object storage (S3) │
└──────────────────────────────┘   │  rendered PNG/SVG    │
                                   └──────────────────────┘
┌──────────────────────────────────────────────────────────┐
│  Worker process (BullMQ on Redis)                        │
│  imports the SAME src/services/ modules                  │
└──────────────────────────────────────────────────────────┘
```

**Rule:** route handlers and job processors are both *thin*. They parse input, call a service,
serialise output. All logic lives in `src/services/`. This is what lets the same code path run
from an HTTP request ("Analyse now") and from a cron job, with no duplication.

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| App | Next.js 15 (App Router) + TypeScript | One deployable, RSC for the dashboard |
| DB | PostgreSQL 16 | JSONB for raw metadata + relational core |
| ORM | Prisma | Migrations, typed client |
| Queue | BullMQ + Redis | Retries, backoff, repeatable jobs, concurrency per queue |
| Auth | NextAuth (Auth.js) | LinkedIn OIDC provider + email magic link |
| Storage | S3-compatible (R2/MinIO local) | Rendered visuals |
| Rendering | Satori → `resvg` | Deterministic SVG→PNG, no headless browser |
| LLM | OpenRouter via our own adapter | Provider-independent (see D8) |
| Validation | Zod | One schema, used for API I/O *and* LLM structured output |

**On rendering:** Satori (JSX → SVG) plus `@resvg/resvg-js` (SVG → PNG) is chosen over Puppeteer
deliberately. No Chromium in the worker image, ~50ms renders instead of ~2s, and fully
deterministic output — the same `VisualSpec` always produces a byte-identical PNG, which makes
visuals cacheable and diffable.

## Queues

Separate queues, because their failure modes and concurrency needs differ sharply.

| Queue | Trigger | Concurrency | Retry | Notes |
| --- | --- | --- | --- | --- |
| `source.sync` | repeatable, per source cadence | 2 | 3×, exp backoff | Rate-limited per connector |
| `paper.ingest` | fan-out from sync | 5 | 3× | Normalise, dedup, retraction gate |
| `paper.analyse` | after ingest | 3 | 2× | LLM extraction + verification |
| `content.generate` | after analyse, or manual | 3 | 2× | Draft + visual spec |
| `visual.render` | after generate | 5 | 3× | Satori/resvg, CPU-bound |
| `post.publish` | scheduled, exact time | 1 | **manual only** | See below |
| `token.watch` | daily cron | 1 | 3× | Expiry warnings |
| `metrics.collect` | daily cron | 1 | 3× | No-op until partner approval |

**`post.publish` never auto-retries.** A retry after an ambiguous timeout is how you
double-post to someone's professional feed. Instead: every publish carries an
`idempotencyKey`; on failure the job moves to a dead-letter state and surfaces in the UI as
"Publish failed — retry?". Before any manual retry we query LinkedIn for a post matching the
key. Concurrency is 1 to make ordering deterministic.

## Cross-cutting

**Rate limiting.** A Redis token-bucket keyed per connector *and* per external host, enforcing
the budgets in [`01-decisions-and-constraints.md`](01-decisions-and-constraints.md) §D5 (arXiv 3s,
NCBI 3/s, etc.). Connectors call `await limiter.acquire(host)`; they do not sleep by hand.

**Idempotency.** Every pipeline stage is keyed so a replay is a no-op:
`paper.ingest` on `canonicalKey`, `paper.analyse` on `(paperId, analysisVersion)`,
`visual.render` on `sha256(VisualSpec)`, `post.publish` on `draftId`.

**Observability.** Every LLM call writes an `LlmRequest` row (role, model, tokens, cost, latency,
outcome). Every pipeline stage writes a `PipelineRun` row. Without this we cannot answer "why did
this post say that?" three weeks later — which for this product is the question that matters most.

**Secrets.** LinkedIn access/refresh tokens are encrypted at rest with AES-256-GCM using a key
from the environment, never logged, and never returned by any API route. See
[`07-api-contract.md`](07-api-contract.md) §Security.

## Environments

- **Local** — Docker Compose: Postgres, Redis, MinIO. LinkedIn publishing behind a
  `LINKEDIN_DRY_RUN=true` flag that logs the exact payload instead of sending it.
- **Staging** — real LinkedIn app, one real test account, publishing to `CONNECTIONS` visibility.
- **Production** — separate LinkedIn app, separate credentials.

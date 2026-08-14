# 08 — MVP Milestone Plan

The MVP proves **one complete vertical loop** for **one real researcher**:

```
sign up → connect LinkedIn → add ORCID → paper discovered → analysed → drafted
→ verified → visual rendered → approved → published to LinkedIn
```

Breadth of source support is explicitly *not* an MVP goal. One connector that never lies is worth
more than seven that sometimes do.

---

## M0 — Spike (before any product code)

Settle the three open questions in
[`01-decisions-and-constraints.md`](01-decisions-and-constraints.md).

- Register the LinkedIn app; add **Sign In with LinkedIn using OpenID Connect** + **Share on
  LinkedIn**.
- Throwaway script: OAuth → person URN → publish a text post → publish an image post.
- Record which surface worked (`/rest/posts` vs `/v2/ugcPosts`) with the exact payload.
- Record whether `refresh_token` came back.

**Exit:** a real post on a real test account, and a written answer to all three questions.
**Why first:** every downstream estimate depends on these answers, and they cost a day to get.

## M1 — Foundation

Next.js + TypeScript scaffold, Docker Compose (Postgres/Redis/MinIO), Prisma schema from
[`03-data-model.md`](03-data-model.md), NextAuth, BullMQ worker, encrypted-token helper,
health checks, `LINKEDIN_DRY_RUN`.

**Exit:** sign up, complete profile, connect LinkedIn, see the connection with its expiry date.

## M2 — Ingestion (ORCID + OpenAlex only)

`SourceAdapter` interface, registry, rate limiter. `ORCID` and `OPENALEX_AUTHOR` adapters.
`source.sync` + `paper.ingest` queues. Canonical-key dedup, `pg_trgm` fuzzy pass, retraction gate,
author attribution. Research Inbox UI.

**Exit:** paste an ORCID → papers appear, correctly deduped, retractions flagged. Verified
against a real researcher's profile with a known publication count.

## M3 — Analysis

Full-text acquisition chain. Extraction with provenance. The **deterministic evidence-containment
check**. Computed confidence. `PaperAnalysis` versioning. OpenRouter provider with role-based
fallback chains and `LlmRequest` logging.

**Exit:** an abstract-only paper correctly returns `ABSENT` for methodology instead of inventing
one. This is the milestone that decides whether the product is trustworthy — treat a failure here
as blocking, not as a tuning problem.

## M4 — Content

Format eligibility gating, drafting with brand + few-shot, verification pass with deterministic
number/causal checks, draft lifecycle, draft review UI showing the verification report inline.

**Exit:** three formats generate from one paper; a deliberately overstated draft is caught and
flagged.

## M5 — Visuals

`VisualSpec` schema, Satori + resvg pipeline, 4 templates (`STAT_CARD`, `KEY_FINDINGS`,
`QUOTE_CARD`, `COMPARISON`), `specHash` caching, S3 upload, preview endpoint.

**Exit:** a draft renders a correct, legible 1200×1200 PNG whose numbers match the extraction
exactly.

## M6 — Schedule & publish

Weekly slots in the user's timezone, slot assignment, approval modes, `post.publish` with
idempotency and no auto-retry, pre-publish retraction re-check, image upload, permalink capture.
Token-expiry watcher + reminder emails + reconnect flow.

**Exit:** the full loop runs end to end, unattended, for one real user across two weeks.

## M7 — Hardening

Remaining Tier-A connectors (arXiv, PubMed, Crossref, RSS, manual DOI), remaining templates and
formats, per-user rate limits, error surfaces, onboarding polish, `PostMetric` manual entry.

---

## Deliberately out of MVP

| Deferred | Why |
| --- | --- |
| Analytics + engagement-based format selection | Partner-gated (D2); cannot collect the data |
| Google Scholar / ResearchGate connectors | ToS-prohibited (D4); manual paste only |
| Generative image models | Cannot be trusted with numbers or text (see [`06-visual-engine.md`](06-visual-engine.md)) |
| Multi-platform (X, Threads) | Adapter seam exists; no second platform until LinkedIn is solid |
| Team / lab accounts | Needs an org model; single-tenant-per-user is enough to validate |
| Carousels, video | Different LinkedIn media path; after the core loop |

## The risks that actually threaten this product

1. **Silent inaccuracy.** A confident, well-written, wrong post is worse than no product. This is
   why M3's exit criterion is a *negative* result — correctly refusing to answer.
2. **Abstract-only ceiling.** If most of a user's papers are paywalled, content quality is capped.
   Measure the `fullTextStatus` distribution on real users early; it may reshape which fields we
   even attempt.
3. **60-day re-auth friction** (D3). Mitigated by reminders, but it is a real retention risk and
   the marketing copy must not overpromise.
4. **LinkedIn policy drift.** Everything LinkedIn-facing sits behind one adapter for exactly this
   reason.
5. **Free-model instability.** Fallback chains absorb it; budget for paid `verify` before launch.

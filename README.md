# Research-to-LinkedIn Automation Platform

> **Transform published scientific breakthroughs into authentic, factual, and verified LinkedIn content.**

An enterprise-grade, privacy-first automation platform built for researchers, scientists, and academics. Connect your research identity once (via ORCID, OpenAlex, arXiv, PubMed, or Crossref), and the platform continuously discovers new papers, extracts verified findings, generates voice-aligned drafts, verifies every claim against source evidence, renders deterministic visual cards, and publishes on your LinkedIn schedule.

---

## 🏗️ Architecture & Core Components

```
┌──────────────────────────────────────────────┐
│  Research Sources (5 Connectors)             │
│  • OpenAlex (Polite Pool Author API)         │
│  • ORCID (Public Works API + DOI Enrichment) │
│  • arXiv (Atom XML with Politeness Budget)   │
│  • PubMed (NCBI E-Utilities: ESearch+ESummary│
│  • Crossref (REST Works Query & Manual DOI)  │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│  3-Pass Deduplication & Retraction Gate      │
│  • Pass 1: Canonical Key Exact Match         │
│  • Pass 2: Fuzzy-to-DOI Key Promotion        │
│  • Pass 3: PostgreSQL pg_trgm Title Matching │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│  Stage 1: AI Extraction with Provenance      │
│  • Abstract-only schema gating (ABSENT rule) │
│  • Verbatim evidence containment audit       │
│  • Hallucinated number discard               │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│  Stage 2: Deterministic Format Gate          │
│  • Matches findings to 6 content formats:    │
│    Breakdown, One-Insight, Story, Myth-      │
│    vs-Reality, Visual Explainer, Deep Dive   │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│  Stage 3: LLM Drafting Engine                │
│  • Extraction-isolated prompt boundaries     │
│  • Few-shot personal brand style exemplars   │
│  • First-author / co-author attribution      │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│  Stage 4: Dual-Pass Fact-Checking Audit      │
│  • LLM claim-by-claim support audit          │
│  • Deterministic numeral tracing             │
│  • Causal language & overstatement guard     │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│  Stage 5: Deterministic Visual Engine        │
│  • Satori JSX-to-SVG + resvg-js PNG render   │
│  • 4 templates: Stat Card, Findings, Quote,  │
│    Comparison • Zero AI hallucinations       │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│  M6 Background Engine & Publishing           │
│  • BullMQ workers & cron queue pollers       │
│  • Weekly slot allocation in user timezone   │
│  • Dual-surface: /rest/posts & /v2/ugcPosts  │
│  • 60-day token expiry watcher (T-14, 3, 0)  │
└──────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: `>= 20.11.0`
- **Docker & Docker Compose**: For PostgreSQL (with `pg_trgm`), Redis, and MinIO (S3)

### 2. Start Infrastructure
```bash
docker compose up -d
```

### 3. Install Dependencies & Setup Environment
```bash
npm install
cp .env.example .env
```

Generate secure encryption and auth secrets:
```bash
openssl rand -base64 32
```

Fill in `.env` variables:
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/research_linkedin"
REDIS_URL="redis://localhost:6379"
ENCRYPTION_KEY="<base64-32-byte-key>"
NEXTAUTH_SECRET="<base64-32-byte-key>"
NEXTAUTH_URL="http://localhost:3000"
OPENROUTER_API_KEY="sk-or-v1-..."
LINKEDIN_CLIENT_ID="<your-linkedin-app-id>"
LINKEDIN_CLIENT_SECRET="<your-linkedin-app-secret>"
LINKEDIN_REDIRECT_URI="http://localhost:3000/api/linkedin/callback"
CONTACT_EMAIL="you@university.edu"
```

### 4. Database Setup & Seeding
```bash
make db-migrate
make db-seed
```

### 5. Start the Web App & Background Worker
In Terminal 1 (Next.js Dashboard):
```bash
make dev
```

In Terminal 2 (BullMQ Worker Engine):
```bash
make worker
```

Open [http://localhost:3000](http://localhost:3000) and **create an account** at `/signup`. The seed
script also provisions a demo login:

```
demo@university.edu / researchly-demo
```

---

## 🔐 Accounts & data isolation

Sign-up and sign-in are email + password. Passwords are hashed with **scrypt** (memory-hard, no
native dependency) in `src/lib/password.ts`; the envelope stores its own cost parameters so they can
be raised later without invalidating existing hashes.

Every workspace is private to one account, enforced in three places:

1. **`src/middleware.ts`** — default-deny routing. Anything not on the short public list (`/login`,
   `/signup`, `/api/auth/*`) requires a session; pages redirect to `/login?next=…`, API routes get a
   401. Adding a new page makes it private automatically.
2. **`src/lib/session.ts`** — `withUser()` / `requireSessionUser()`. Every handler and page runs with
   a user id taken from the signed JWT, never from a request body or query string.
3. **The queries themselves** — no read or write without an owner. Single-record lookups use
   `findFirst({ where: { id, userId } })` and updates use `updateMany`/`deleteMany` with the owner in
   the filter, so another account's id affects **zero rows** and reads back as `404`, not `403`.

`ChatMessage` carries `userId` as well as `conversationId` — redundant on purpose, so a message can
never be reached through a mis-scoped join.

---

## 💬 Chat workspace

`/chat` is a per-account writing room: a conversation sidebar, a strip of open tabs, and one thread
at a time. New chats start from the **+ New** button or by typing into an empty workspace; open tabs
persist across reloads under a **user-namespaced** storage key, so a shared browser never shows the
previous person's thread titles.

Replies are backed by the same LLM provider as the pipeline, prompted with your saved voice profile.
Any assistant reply can be saved as a post draft — it lands in `NEEDS_REVIEW` and goes through the
same approval screen as pipeline drafts. Chat is a faster way to write a post, never a way around
the approval gate.

---

## ✅ Approval before publishing

Nothing reaches a LinkedIn feed without passing `POST /api/drafts/:id/approve`.

The review screen (`/drafts/:id`) renders **the exact text that will be posted** — hashtags appended
the same way the publisher appends them, the rendered image attached, LinkedIn's “…see more” fold
marked in grey. Edits made in the preview are sent *with* the approval in one request, so what was on
screen when the button was pressed is what goes out.

Three modes:

| Mode | Behaviour |
|---|---|
| `publish` | Approve and post immediately. Awaited, not queued, so a LinkedIn rejection surfaces on the button that caused it. |
| `schedule` | Approve and enqueue for a chosen time on the BullMQ `post.publish` queue. |
| `approve` | Approve only; publish later or let the schedule pick it up. |

`src/services/linkedin/publish.ts` is the single implementation behind both the API route and the
background worker, so the two cannot drift. It re-checks ownership and refuses to post a draft that
has not been approved.

> **`LINKEDIN_DRY_RUN=true`** (the default) blocks every real write. The UI says so explicitly rather
> than reporting a post as live when nothing was sent.

---

## 🧪 Testing & Verification

Run the full test suite (**348 tests across 16 test suites** covering password hashing, cryptography,
rate limiting, ID normalization, LLM fallback chains, format gating, claim verification, chat post
parsing, and source adapters):
```bash
make test
# or: npm test
```

Perform static type checking:
```bash
make typecheck
# or: npm run typecheck
```

---

## 📋 Comprehensive Feature Matrix (Milestones M0 – M7)

| Layer | Component | Status | Description |
|---|---|---|---|
| **M0** | **LinkedIn Engine** | ✅ **Done** | PKCE OAuth flow, dual-surface publishing (`/rest/posts` with automatic `/v2/ugcPosts` fallback), multipart image uploads, idempotency keys, and 60-day token expiry watchers. |
| **M1/M2** | **Source Ingestion & Dedup** | ✅ **Done** | OpenAlex & ORCID connectors, retraction gate, and 3-pass deduplication (exact canonical key, fuzzy-to-DOI upgrade, `pg_trgm` title similarity). |
| **M3** | **AI Extraction Engine** | ✅ **Done** | Stage 1 extraction with abstract-only gating (`ABSENT` methodology enforcement), verbatim evidence containment, and number discard. |
| **M4** | **Content Generation** | ✅ **Done** | Stage 2 deterministic format eligibility, Stage 3 few-shot brand voice drafting, and Stage 4 dual-pass claim & numeral verification. |
| **M4** | **Next.js Web UI** | ✅ **Done** | Warm-paper design system (cream surfaces, ink nav, terracotta actions), dashboard, Research Inbox, review-and-approve screen with claim audit cards, weekly slot grid, Sources manager, and profile/voice settings. |
| **M8** | **Accounts & Isolation** | ✅ **Done** | scrypt email/password auth, `/signup`, default-deny middleware, `withUser()` guards, and owner-scoped queries on every read and write. |
| **M8** | **Chat Workspace** | ✅ **Done** | Per-account conversations with tabs, LLM replies in your saved voice, and one-click "save as post draft" into the approval queue. |
| **M8** | **Approval Gate** | ✅ **Done** | True-to-LinkedIn post preview, approve-now / schedule / approve-only modes, and a shared publisher used by both the API and the worker. |
| **M5** | **Visual Engine** | ✅ **Done** | Satori + `@resvg/resvg-js` visual generation, 4 verified templates, hash-based S3 caching, and live `/api/visuals/preview` endpoint. |
| **M6** | **Background Queues & Scheduling** | ✅ **Done** | BullMQ workers, weekly timezone slot engine (`src/services/scheduling/slots.ts`), repeatable cron polling, and graceful shutdown handlers. |
| **M7** | **Tier-A Adapters & Hardening** | ✅ **Done** | arXiv, PubMed, Crossref query & Manual DOI adapters, Unpaywall full-text resolver (`fulltext.ts`), and Prisma seed script (`prisma/seed.ts`). |
| **User** | **Live Credentials Setup** | ⏳ *User Step* | Supply live `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and `OPENROUTER_API_KEY` in `.env`. |
| **User** | **Live M0 Spike Test** | ⏳ *User Step* | Run `make spike` with real credentials to verify person URNs on the LinkedIn developer console. |

---

## 🛠️ Makefile Reference

```bash
make dev         # Start Next.js development server
make worker      # Start BullMQ background worker engine
make build       # Compile production bundle
make test        # Run Vitest unit tests (328 tests across 14 suites)
make typecheck   # Run TypeScript compiler check
make db-migrate  # Apply Prisma migrations
make db-seed     # Populate demo database with realistic academic data
make spike       # Run standalone LinkedIn API spike test
make clean       # Remove build artifacts and caches
```

---

## 📄 License
MIT © 2026 Ali Ahmed.

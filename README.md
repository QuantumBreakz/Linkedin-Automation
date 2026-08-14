# Research-to-LinkedIn Automation Platform

> **Transform published scientific breakthroughs into authentic, factual, and verified LinkedIn content.**

An enterprise-grade, privacy-first automation platform built for researchers, scientists, and academics. Connect your research identity once (via ORCID or OpenAlex), and the platform continuously discovers new papers, extracts verified findings, generates voice-aligned drafts, verifies every claim against source evidence, renders deterministic visual cards, and publishes on your LinkedIn schedule.

---

## 🏗️ Architecture & Core Components

```
┌─────────────────┐       ┌───────────────────────┐       ┌────────────────────────┐
│ Research Sources│ ----> │ 3-Pass Deduplication  │ ----> │ Stage 1: AI Extraction │
│ (OpenAlex/ORCID)│       │ (Canonical/DOI/Trigram│       │ (Evidence Containment) │
└─────────────────┘       └───────────────────────┘       └───────────┬────────────┘
                                                                      │
┌─────────────────────────┐       ┌───────────────────────┐           │
│ Stage 4: Claim Audit    │ <---- │ Stage 3: LLM Drafting │ <─────────┴── Stage 2: Format Gate
│ (Deterministic + LLM)   │       │ (Extraction Grounded) │               (Eligibility Rules)
└───────────┬─────────────┘       └───────────────────────┘
            │
            ▼
┌─────────────────────────┐       ┌───────────────────────┐       ┌────────────────────────┐
│ Stage 5: Visual Engine  │ ----> │ Draft Review & Editor │ ----> │ M6 Publish / LinkedIn │
│ (Satori + resvg-js PNG) │       │ (Interactive Dashboard│       │ (/rest/posts + ugcPost)│
└─────────────────────────┘       └───────────────────────┘       └────────────────────────┘
```

### Verified Pipeline Stages
- **M0 LinkedIn Engine (`src/services/linkedin/`):** PKCE authorization code flow, token encryption with AES-256-GCM, dual-surface publishing (`/rest/posts` with automatic `/v2/ugcPosts` fallback), multipart image uploads, idempotency keys, and 60-day token expiry watchers.
- **M1/M2 Sources & Ingestion (`src/services/sources/`, `src/services/ingest/`):** OpenAlex and ORCID polite-pool adapters, retraction gate, and 3-pass deduplication (exact canonical key, fuzzy-to-DOI upgrade, and `pg_trgm` title similarity matching).
- **M3 Extraction & AI Pipeline (`src/services/analysis/`, `src/services/content/`):**
  - **Stage 1 (Extraction):** Abstract-only schema gating, verbatim evidence containment, and hallucinated number discard.
  - **Stage 2 (Format Gate):** Deterministic eligibility rules matching findings to content formats (`RESEARCH_BREAKDOWN`, `ONE_INSIGHT`, `RESEARCH_STORY`, `MYTH_VS_REALITY`, `VISUAL_EXPLAINER`, `TECHNICAL_DEEP_DIVE`).
  - **Stage 3 (Drafting):** Extraction-grounded prompt isolation, author attribution checks, and few-shot brand voice styling.
  - **Stage 4 (Verification):** Dual-pass audit combining LLM reasoning with deterministic numeral tracing and causal verb overstatement guards.
- **M4 App Router Web UI (`src/app/`):** Dark-mode responsive dashboard, Research Inbox, Draft Review & Fact-Check Editor, Scheduling Queue, and Brand Settings.
- **M5 Deterministic Visual Engine (`src/services/visual/`):** Satori + `@resvg/resvg-js` rendering pipeline generating high-resolution PNGs from verified metrics with hash-based S3 caching (zero generative image hallucinations).
- **M6 Background Queue & Scheduling (`src/worker/`):** BullMQ workers for asynchronous analysis, draft generation, scheduled publishing, and repeatable cron jobs.

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

Fill in your `.env` variables (generate keys with `openssl rand -base64 32`):
- `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/research_linkedin"`
- `REDIS_URL="redis://localhost:6379"`
- `ENCRYPTION_KEY="<base64-32-byte-key>"`
- `NEXTAUTH_SECRET="<base64-32-byte-key>"`
- `OPENROUTER_API_KEY="sk-or-v1-..."`
- `LINKEDIN_CLIENT_ID="<your-linkedin-app-id>"`
- `LINKEDIN_CLIENT_SECRET="<your-linkedin-app-secret>"`
- `LINKEDIN_REDIRECT_URI="http://localhost:3000/api/linkedin/callback"`

### 4. Database Initialization
```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 5. Run Web App & Worker
In terminal 1 (Web Dashboard):
```bash
make dev
# or: npm run dev
```

In terminal 2 (Background Worker Engine):
```bash
make worker
# or: npm run worker
```

Open [http://localhost:3000](http://localhost:3000) to access the dashboard.

---

## 🧪 Testing & Verification

Run the test suite (10 test suites covering crypto, ratelimiting, IDs, LLM chains, format gating, and verification):
```bash
make test
# or: npm test
```

Check TypeScript types:
```bash
make typecheck
```

---

## 📋 What is Implemented vs. Remaining Production Steps

| Component | Status | Description |
|---|---|---|
| **M0 LinkedIn OAuth & Posting** | ✅ **Done** | PKCE flow, dual-surface client, image upload, token monitor, test suite. |
| **M1/M2 Research Adapters & Dedup** | ✅ **Done** | OpenAlex, ORCID, retraction gate, 3-pass dedup, ingest worker. |
| **M3 AI Extraction & Verification** | ✅ **Done** | Stage 1 extraction, Stage 2 format gate, Stage 3 draft, Stage 4 fact check. |
| **M4 Web UI & Dashboard** | ✅ **Done** | Next.js App Router, inbox, draft editor, schedule, sources, settings. |
| **M5 Deterministic Visual Engine** | ✅ **Done** | Satori + resvg-js, 4 visual templates, S3 object storage caching. |
| **M6 Queue Engine & Workers** | ✅ **Done** | BullMQ workers, repeatable cron polling, graceful shutdown. |
| **Live Credentials Configuration** | ⏳ *User Step* | Supply real `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and `OPENROUTER_API_KEY` in `.env`. |
| **M0 Live LinkedIn Spike Test** | ⏳ *User Step* | Run `make spike` with real credentials to verify person URNs on LinkedIn developer console. |
| **Transactional Email Provider** | ⏳ *Optional* | Connect Resend/Postmark to `token-watcher.ts` for automated T-14d/T-3d email delivery. |

---

## 🛠️ Makefile Commands

```bash
make dev         # Start Next.js development server
make worker      # Start BullMQ background worker engine
make build       # Compile production build
make test        # Run Vitest unit tests (320 tests)
make typecheck   # Run TypeScript compiler check
make db-migrate  # Apply Prisma migrations
make spike       # Run standalone LinkedIn API spike test
```

---

## 📄 License
MIT © 2026 Ali Ahmed.

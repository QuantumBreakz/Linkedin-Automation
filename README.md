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

Open [http://localhost:3000](http://localhost:3000) to access the command center.

---

## 🧪 Testing & Verification

Run the full test suite (**328 tests across 14 test suites** covering cryptography, rate limiting, ID normalization, LLM fallback chains, format gating, claim verification, and source adapters):
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
| **M4** | **Next.js Web UI** | ✅ **Done** | Responsive dark dashboard, Research Inbox, interactive Draft Editor with claim audit cards, Publishing Schedule, Sources manager, and Brand Settings. |
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

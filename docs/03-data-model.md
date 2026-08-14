# 03 — Data Model

Postgres + Prisma. This is the schema we implement in Phase 1; it is written to accommodate the
later phases (analytics, multi-platform) without migration churn.

Design notes worth stating up front:

- **`ResearchPaper` is per-user, not global.** Two users can co-author the same paper and each
  needs their own analysis, drafts, and schedule. A future `CanonicalWork` table can dedup across
  tenants; premature now.
- **`PaperAnalysis` is versioned and immutable.** Re-running extraction with a better prompt
  creates version N+1. Drafts point at the exact analysis that produced them, so we can always
  answer "what did the model see when it wrote this?".
- **Tokens are encrypted columns**, not plaintext.

```prisma
// prisma/schema.prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

// ─────────────────────────────  Identity  ─────────────────────────────

model User {
  id             String   @id @default(cuid())
  email          String   @unique
  name           String
  title          String?          // "PhD Researcher in Computational Biology"
  fieldOfStudy   String?
  bio            String?
  researchAreas  String[]
  targetAudience String[]         // RESEARCHERS | INDUSTRY | GENERAL_PUBLIC | CLINICIANS
  language       String   @default("en")
  timezone       String   @default("UTC")
  orcid          String?  @unique
  orcidVerified  Boolean  @default(false)
  approvalMode   ApprovalMode @default(APPROVAL_REQUIRED)
  createdAt      DateTime @default(now())

  brandProfile   BrandProfile?
  linkedinAccount LinkedInAccount?
  sources        ResearchSource[]
  papers         ResearchPaper[]
  drafts         ContentDraft[]
  scheduleSlots  ScheduleSlot[]
  llmRequests    LlmRequest[]
}

enum ApprovalMode { AUTOMATIC APPROVAL_REQUIRED DRAFT_ONLY }

model BrandProfile {
  id                 String   @id @default(cuid())
  userId             String   @unique
  user               User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  tone               Tone     @default(PROFESSIONAL)
  technicality       Technicality @default(INTERMEDIATE)
  postLength         PostLength   @default(MEDIUM)
  emojiUsage         EmojiUsage   @default(LOW)
  ctaEnabled         Boolean  @default(true)
  hashtagsEnabled    Boolean  @default(true)
  firstPerson        Boolean  @default(true)
  customInstructions String?
  /** Few-shot exemplars: the user's own approved/published posts. */
  styleSamples       Json     @default("[]")
  updatedAt          DateTime @updatedAt
}

enum Tone { PROFESSIONAL CONVERSATIONAL ACADEMIC ENTHUSIASTIC }
enum Technicality { BEGINNER INTERMEDIATE EXPERT }
enum PostLength { SHORT MEDIUM LONG }
enum EmojiUsage { NONE LOW MODERATE }

// ─────────────────────────────  LinkedIn  ─────────────────────────────

model LinkedInAccount {
  id                 String   @id @default(cuid())
  userId             String   @unique
  user               User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  personUrn          String   @unique   // urn:li:person:{sub}
  displayName        String?
  avatarUrl          String?

  accessTokenEnc     Bytes              // AES-256-GCM
  accessTokenExpires DateTime
  refreshTokenEnc    Bytes?             // partner-only; see D3
  refreshTokenExpires DateTime?
  scopes             String[]

  status             ConnectionStatus @default(ACTIVE)
  lastVerifiedAt     DateTime?
  expiryNoticesSent  Int      @default(0)

  publishedPosts     PublishedPost[]

  @@index([accessTokenExpires])
}

enum ConnectionStatus { ACTIVE EXPIRING EXPIRED REVOKED }

// ─────────────────────────  Sources & papers  ─────────────────────────

model ResearchSource {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  kind          SourceKind
  identifier    String             // ORCID id, author id, feed URL, query string
  config        Json     @default("{}")
  label         String?

  syncStatus    SyncStatus @default(PENDING)
  syncCadence   Int      @default(21600)   // seconds; default 6h
  lastCheckedAt DateTime?
  lastSuccessAt DateTime?
  cursor        String?
  lastError     String?
  consecutiveFailures Int @default(0)

  createdAt     DateTime @default(now())
  links         PaperSourceLink[]

  @@unique([userId, kind, identifier])
  @@index([syncStatus, lastCheckedAt])
}

enum SourceKind {
  ORCID OPENALEX_AUTHOR ARXIV_AUTHOR PUBMED_QUERY
  CROSSREF_QUERY RSS MANUAL_DOI MANUAL_URL
}
enum SyncStatus { PENDING OK FAILING DISABLED }

model ResearchPaper {
  id             String   @id @default(cuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  canonicalKey   String             // see 04-research-sources.md §Dedup
  doi            String?
  openalexId     String?
  arxivId        String?
  pmid           String?
  pmcid          String?

  title          String
  abstract       String?
  publicationDate DateTime?
  datePrecision  DatePrecision @default(DAY)
  venue          String?
  landingUrl     String?
  oaPdfUrl       String?
  topics         String[]
  citedByCount   Int?

  isRetracted    Boolean  @default(false)
  retractionCheckedAt DateTime?
  fullTextStatus FullTextStatus @default(UNKNOWN)
  fullTextKey    String?           // object-storage key

  needsAttribution Boolean @default(false)
  dismissed      Boolean  @default(false)

  raw            Json
  discoveredAt   DateTime @default(now())

  authors        PaperAuthor[]
  analyses       PaperAnalysis[]
  drafts         ContentDraft[]
  sourceLinks    PaperSourceLink[]

  @@unique([userId, canonicalKey])
  @@index([userId, discoveredAt])
  @@index([userId, isRetracted, dismissed])
}

enum DatePrecision { DAY MONTH YEAR }
enum FullTextStatus { UNKNOWN ABSTRACT_ONLY OA_PDF OA_XML FETCH_FAILED }

model PaperAuthor {
  id       String @id @default(cuid())
  paperId  String
  paper    ResearchPaper @relation(fields: [paperId], references: [id], onDelete: Cascade)
  name     String
  orcid    String?
  position Int
  isUser   Boolean @default(false)

  @@index([paperId])
}

model PaperSourceLink {
  id         String @id @default(cuid())
  paperId    String
  paper      ResearchPaper @relation(fields: [paperId], references: [id], onDelete: Cascade)
  sourceId   String
  source     ResearchSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  externalId String?
  firstSeenAt DateTime @default(now())

  @@unique([paperId, sourceId])
}

// ──────────────────────────  AI artefacts  ────────────────────────────

model PaperAnalysis {
  id         String @id @default(cuid())
  paperId    String
  paper      ResearchPaper @relation(fields: [paperId], references: [id], onDelete: Cascade)

  version    Int
  /** ResearchExtraction — see 05-ai-pipeline.md */
  extraction Json
  /** Per-field STATED | INFERRED | ABSENT + verbatim evidence spans. */
  provenance Json
  basedOn    FullTextStatus
  confidence Float
  modelId    String
  promptHash String
  status     AnalysisStatus @default(OK)
  createdAt  DateTime @default(now())

  drafts     ContentDraft[]

  @@unique([paperId, version])
}

enum AnalysisStatus { OK LOW_CONFIDENCE FAILED }

model ContentDraft {
  id         String @id @default(cuid())
  userId     String
  user       User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  paperId    String
  paper      ResearchPaper @relation(fields: [paperId], references: [id])
  analysisId String
  analysis   PaperAnalysis @relation(fields: [analysisId], references: [id])

  format     ContentFormat
  body       String
  hashtags   String[]
  linkUrl    String?

  /** VerificationReport — claim-by-claim. See 05-ai-pipeline.md */
  verification Json?
  verificationStatus VerificationStatus @default(PENDING)

  status       DraftStatus @default(GENERATED)
  scheduledFor DateTime?
  approvedAt   DateTime?
  editedByUser Boolean @default(false)
  createdAt    DateTime @default(now())

  visuals      VisualAsset[]
  published    PublishedPost?

  @@index([userId, status, scheduledFor])
}

enum ContentFormat {
  RESEARCH_BREAKDOWN ONE_INSIGHT RESEARCH_STORY
  MYTH_VS_REALITY VISUAL_EXPLAINER TECHNICAL_DEEP_DIVE
}
enum VerificationStatus { PENDING PASSED FLAGGED FAILED }
enum DraftStatus {
  GENERATED NEEDS_REVIEW APPROVED SCHEDULED
  PUBLISHING PUBLISHED FAILED CANCELLED
}

model VisualAsset {
  id        String @id @default(cuid())
  draftId   String
  draft     ContentDraft @relation(fields: [draftId], references: [id], onDelete: Cascade)

  template  String
  spec      Json               // VisualSpec — see 06-visual-engine.md
  specHash  String             // sha256(spec) — render cache key
  storageKey String?
  width     Int
  height    Int
  altText   String
  isPrimary Boolean @default(true)
  createdAt DateTime @default(now())

  @@index([specHash])
}

// ─────────────────────  Scheduling & publishing  ──────────────────────

model ScheduleSlot {
  id        String @id @default(cuid())
  userId    String
  user      User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  dayOfWeek Int                // 0=Sunday
  timeOfDay String             // "09:00", interpreted in User.timezone
  active    Boolean @default(true)

  @@unique([userId, dayOfWeek, timeOfDay])
}

model PublishedPost {
  id             String @id @default(cuid())
  draftId        String @unique
  draft          ContentDraft @relation(fields: [draftId], references: [id])
  accountId      String
  account        LinkedInAccount @relation(fields: [accountId], references: [id])

  idempotencyKey String @unique
  linkedinUrn    String?          // urn:li:share:… from X-RestLi-Id
  permalink      String?
  publishedAt    DateTime?
  apiSurface     String?          // "rest/posts" | "v2/ugcPosts"
  response       Json?

  metrics        PostMetric[]
}

model PostMetric {
  id          String @id @default(cuid())
  postId      String
  post        PublishedPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  capturedAt  DateTime @default(now())
  source      MetricSource      // MANUAL until partner approval (see D2)
  impressions Int?
  reactions   Int?
  comments    Int?
  shares      Int?
  clicks      Int?

  @@index([postId, capturedAt])
}

enum MetricSource { MANUAL API }

// ──────────────────────────  Observability  ───────────────────────────

model LlmRequest {
  id          String @id @default(cuid())
  userId      String?
  user        User?  @relation(fields: [userId], references: [id], onDelete: SetNull)
  role        String            // cheap | standard | verify
  provider    String
  modelId     String
  purpose     String            // extraction | drafting | verification | …
  refType     String?
  refId       String?
  promptTokens     Int?
  completionTokens Int?
  costUsd     Decimal? @db.Decimal(10, 6)
  latencyMs   Int?
  status      String
  error       String?
  createdAt   DateTime @default(now())

  @@index([userId, createdAt])
  @@index([modelId, createdAt])
}

model PipelineRun {
  id        String @id @default(cuid())
  stage     String
  refType   String
  refId     String
  status    String
  startedAt DateTime @default(now())
  finishedAt DateTime?
  error     String?

  @@index([refType, refId])
}
```

## Lifecycle of a draft

```
GENERATED ─┬─ verification PASSED ─┬─ mode AUTOMATIC ────────→ SCHEDULED
           │                       └─ mode APPROVAL_REQUIRED → NEEDS_REVIEW
           └─ verification FLAGGED/FAILED ────────────────────→ NEEDS_REVIEW

NEEDS_REVIEW ── user approves ──→ APPROVED ──→ SCHEDULED
SCHEDULED ──→ PUBLISHING ──→ PUBLISHED
                         └──→ FAILED (no auto-retry; manual only)
any state ── paper retracted ──→ CANCELLED
```

A `FLAGGED` verification can **never** reach `SCHEDULED` without a human, regardless of the user's
approval mode. Automatic mode automates the happy path, not the risky one.

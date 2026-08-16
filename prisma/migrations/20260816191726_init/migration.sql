-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "ApprovalMode" AS ENUM ('AUTOMATIC', 'APPROVAL_REQUIRED', 'DRAFT_ONLY');

-- CreateEnum
CREATE TYPE "Tone" AS ENUM ('PROFESSIONAL', 'CONVERSATIONAL', 'ACADEMIC', 'ENTHUSIASTIC');

-- CreateEnum
CREATE TYPE "Technicality" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'EXPERT');

-- CreateEnum
CREATE TYPE "PostLength" AS ENUM ('SHORT', 'MEDIUM', 'LONG');

-- CreateEnum
CREATE TYPE "EmojiUsage" AS ENUM ('NONE', 'LOW', 'MODERATE');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'EXPIRING', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('ORCID', 'OPENALEX_AUTHOR', 'ARXIV_AUTHOR', 'PUBMED_QUERY', 'CROSSREF_QUERY', 'RSS', 'MANUAL_DOI', 'MANUAL_URL');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'OK', 'FAILING', 'DISABLED');

-- CreateEnum
CREATE TYPE "DatePrecision" AS ENUM ('DAY', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "FullTextStatus" AS ENUM ('UNKNOWN', 'ABSTRACT_ONLY', 'OA_PDF', 'OA_XML', 'FETCH_FAILED');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('OK', 'LOW_CONFIDENCE', 'FAILED');

-- CreateEnum
CREATE TYPE "ContentFormat" AS ENUM ('RESEARCH_BREAKDOWN', 'ONE_INSIGHT', 'RESEARCH_STORY', 'MYTH_VS_REALITY', 'VISUAL_EXPLAINER', 'TECHNICAL_DEEP_DIVE');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'PASSED', 'FLAGGED', 'FAILED');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('GENERATED', 'NEEDS_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MetricSource" AS ENUM ('MANUAL', 'API');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "fieldOfStudy" TEXT,
    "bio" TEXT,
    "researchAreas" TEXT[],
    "targetAudience" TEXT[],
    "language" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "orcid" TEXT,
    "orcidVerified" BOOLEAN NOT NULL DEFAULT false,
    "approvalMode" "ApprovalMode" NOT NULL DEFAULT 'APPROVAL_REQUIRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tone" "Tone" NOT NULL DEFAULT 'PROFESSIONAL',
    "technicality" "Technicality" NOT NULL DEFAULT 'INTERMEDIATE',
    "postLength" "PostLength" NOT NULL DEFAULT 'MEDIUM',
    "emojiUsage" "EmojiUsage" NOT NULL DEFAULT 'LOW',
    "ctaEnabled" BOOLEAN NOT NULL DEFAULT true,
    "hashtagsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "firstPerson" BOOLEAN NOT NULL DEFAULT true,
    "customInstructions" TEXT,
    "styleSamples" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedInAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personUrn" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "accessTokenEnc" BYTEA NOT NULL,
    "accessTokenExpires" TIMESTAMP(3) NOT NULL,
    "refreshTokenEnc" BYTEA,
    "refreshTokenExpires" TIMESTAMP(3),
    "scopes" TEXT[],
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastVerifiedAt" TIMESTAMP(3),
    "expiryNoticesSent" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LinkedInAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "identifier" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "label" TEXT,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "syncCadence" INTEGER NOT NULL DEFAULT 21600,
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "cursor" TEXT,
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchPaper" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "doi" TEXT,
    "openalexId" TEXT,
    "arxivId" TEXT,
    "pmid" TEXT,
    "pmcid" TEXT,
    "title" TEXT NOT NULL,
    "abstract" TEXT,
    "publicationDate" TIMESTAMP(3),
    "datePrecision" "DatePrecision" NOT NULL DEFAULT 'DAY',
    "venue" TEXT,
    "landingUrl" TEXT,
    "oaPdfUrl" TEXT,
    "topics" TEXT[],
    "citedByCount" INTEGER,
    "isRetracted" BOOLEAN NOT NULL DEFAULT false,
    "retractionCheckedAt" TIMESTAMP(3),
    "fullTextStatus" "FullTextStatus" NOT NULL DEFAULT 'UNKNOWN',
    "fullTextKey" TEXT,
    "needsAttribution" BOOLEAN NOT NULL DEFAULT false,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchPaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperAuthor" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orcid" TEXT,
    "position" INTEGER NOT NULL,
    "isUser" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PaperAuthor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperSourceLink" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperSourceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperAnalysis" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "extraction" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,
    "basedOn" "FullTextStatus" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "modelId" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'OK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "format" "ContentFormat" NOT NULL,
    "body" TEXT NOT NULL,
    "hashtags" TEXT[],
    "linkUrl" TEXT,
    "verification" JSONB,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "status" "DraftStatus" NOT NULL DEFAULT 'GENERATED',
    "scheduledFor" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualAsset" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "specHash" TEXT NOT NULL,
    "storageKey" TEXT,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "altText" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleSlot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "timeOfDay" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ScheduleSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishedPost" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "linkedinUrn" TEXT,
    "permalink" TEXT,
    "publishedAt" TIMESTAMP(3),
    "apiSurface" TEXT,
    "response" JSONB,

    CONSTRAINT "PublishedPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostMetric" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "MetricSource" NOT NULL,
    "impressions" INTEGER,
    "reactions" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "clicks" INTEGER,

    CONSTRAINT "PostMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "costUsd" DECIMAL(10,6),
    "latencyMs" INTEGER,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_orcid_key" ON "User"("orcid");

-- CreateIndex
CREATE UNIQUE INDEX "BrandProfile_userId_key" ON "BrandProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedInAccount_userId_key" ON "LinkedInAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedInAccount_personUrn_key" ON "LinkedInAccount"("personUrn");

-- CreateIndex
CREATE INDEX "LinkedInAccount_accessTokenExpires_idx" ON "LinkedInAccount"("accessTokenExpires");

-- CreateIndex
CREATE INDEX "ResearchSource_syncStatus_lastCheckedAt_idx" ON "ResearchSource"("syncStatus", "lastCheckedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSource_userId_kind_identifier_key" ON "ResearchSource"("userId", "kind", "identifier");

-- CreateIndex
CREATE INDEX "ResearchPaper_userId_discoveredAt_idx" ON "ResearchPaper"("userId", "discoveredAt");

-- CreateIndex
CREATE INDEX "ResearchPaper_userId_isRetracted_dismissed_idx" ON "ResearchPaper"("userId", "isRetracted", "dismissed");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchPaper_userId_canonicalKey_key" ON "ResearchPaper"("userId", "canonicalKey");

-- CreateIndex
CREATE INDEX "PaperAuthor_paperId_idx" ON "PaperAuthor"("paperId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperSourceLink_paperId_sourceId_key" ON "PaperSourceLink"("paperId", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperAnalysis_paperId_version_key" ON "PaperAnalysis"("paperId", "version");

-- CreateIndex
CREATE INDEX "ContentDraft_userId_status_scheduledFor_idx" ON "ContentDraft"("userId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "VisualAsset_specHash_idx" ON "VisualAsset"("specHash");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleSlot_userId_dayOfWeek_timeOfDay_key" ON "ScheduleSlot"("userId", "dayOfWeek", "timeOfDay");

-- CreateIndex
CREATE UNIQUE INDEX "PublishedPost_draftId_key" ON "PublishedPost"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishedPost_idempotencyKey_key" ON "PublishedPost"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PostMetric_postId_capturedAt_idx" ON "PostMetric"("postId", "capturedAt");

-- CreateIndex
CREATE INDEX "LlmRequest_userId_createdAt_idx" ON "LlmRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LlmRequest_modelId_createdAt_idx" ON "LlmRequest"("modelId", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineRun_refType_refId_idx" ON "PipelineRun"("refType", "refId");

-- AddForeignKey
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedInAccount" ADD CONSTRAINT "LinkedInAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSource" ADD CONSTRAINT "ResearchSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchPaper" ADD CONSTRAINT "ResearchPaper_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperAuthor" ADD CONSTRAINT "PaperAuthor_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ResearchPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperSourceLink" ADD CONSTRAINT "PaperSourceLink_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ResearchPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperSourceLink" ADD CONSTRAINT "PaperSourceLink_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ResearchSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperAnalysis" ADD CONSTRAINT "PaperAnalysis_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ResearchPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentDraft" ADD CONSTRAINT "ContentDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentDraft" ADD CONSTRAINT "ContentDraft_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ResearchPaper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentDraft" ADD CONSTRAINT "ContentDraft_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "PaperAnalysis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualAsset" ADD CONSTRAINT "VisualAsset_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ContentDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishedPost" ADD CONSTRAINT "PublishedPost_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ContentDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishedPost" ADD CONSTRAINT "PublishedPost_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LinkedInAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMetric" ADD CONSTRAINT "PostMetric_postId_fkey" FOREIGN KEY ("postId") REFERENCES "PublishedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmRequest" ADD CONSTRAINT "LlmRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

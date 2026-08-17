-- AlterTable
-- Server-side chat workspace tab state, moved off browser localStorage.
ALTER TABLE "User" ADD COLUMN "chatTabs" JSONB NOT NULL DEFAULT '{}';

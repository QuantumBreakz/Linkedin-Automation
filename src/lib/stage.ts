/**
 * Pipeline stage observability.
 *
 * Every pipeline stage runs through here so that:
 *   1. a `pipeline.<stage>.start` / `.ok` / `.fail` line is logged (with a
 *      duration), giving a live trace in the worker / dev console; and
 *   2. a `PipelineRun` row is persisted — a durable, queryable record of every
 *      stage that ran and every one that failed (and, because it is a table, it
 *      also mirrors to MongoDB).
 *
 * Recording is best-effort: a failure to write the audit row never changes the
 * stage's own result, and `runStage` rethrows, so wrapping a stage does not
 * alter control flow.
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface StageRef {
  refType: string;
  refId: string;
}

async function startRun(stage: string, ref: StageRef, startedAt: Date): Promise<string | null> {
  try {
    const run = await db.pipelineRun.create({
      data: { stage, refType: ref.refType, refId: ref.refId, status: 'running', startedAt },
      select: { id: true },
    });
    return run.id;
  } catch (err) {
    logger.warn('Could not record pipeline run start', { stage, ...ref, err });
    return null;
  }
}

async function finishRun(
  runId: string | null,
  status: 'ok' | 'failed',
  finishedAt: Date,
  error?: string,
): Promise<void> {
  if (!runId) return;
  try {
    await db.pipelineRun.update({
      where: { id: runId },
      data: { status, finishedAt, error: error ?? null },
    });
  } catch (err) {
    logger.warn('Could not record pipeline run finish', { runId, stage: status, err });
  }
}

/**
 * Runs a throwing stage with start/ok/fail logging + a PipelineRun record.
 * Rethrows on failure so the caller's control flow is unchanged.
 */
export async function runStage<T>(stage: string, ref: StageRef, fn: () => Promise<T>): Promise<T> {
  const startedAt = new Date();
  logger.info(`pipeline.${stage}.start`, { stage, ...ref });
  const runId = await startRun(stage, ref, startedAt);
  try {
    const result = await fn();
    const finishedAt = new Date();
    logger.info(`pipeline.${stage}.ok`, {
      stage,
      ...ref,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    });
    await finishRun(runId, 'ok', finishedAt);
    return result;
  } catch (err) {
    const finishedAt = new Date();
    logger.error(`pipeline.${stage}.fail`, {
      stage,
      ...ref,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      err,
    });
    await finishRun(runId, 'failed', finishedAt, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * One-shot record for stages that report an outcome instead of throwing (e.g.
 * publishing, which returns an ok/reason result). Logs and persists a single
 * PipelineRun row; never throws.
 */
export async function recordStage(
  stage: string,
  ref: StageRef,
  outcome: { ok: boolean; detail?: string },
): Promise<void> {
  const now = new Date();
  if (outcome.ok) {
    logger.info(`pipeline.${stage}.ok`, { stage, ...ref, detail: outcome.detail });
  } else {
    logger.warn(`pipeline.${stage}.fail`, { stage, ...ref, detail: outcome.detail });
  }
  try {
    await db.pipelineRun.create({
      data: {
        stage,
        refType: ref.refType,
        refId: ref.refId,
        status: outcome.ok ? 'ok' : 'failed',
        startedAt: now,
        finishedAt: now,
        error: outcome.ok ? null : (outcome.detail ?? null),
      },
    });
  } catch (err) {
    logger.warn('Could not record pipeline stage outcome', { stage, ...ref, err });
  }
}

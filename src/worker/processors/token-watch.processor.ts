/**
 * Token watch processor — checks LinkedIn tokens for impending expiry.
 */

import type { Job } from 'bullmq';
import { runTokenExpiryWatch } from '@/services/linkedin/token-watcher';
import { logger } from '@/lib/logger';

export async function processTokenWatchJob(_job: Job): Promise<void> {
  logger.info('Running LinkedIn token expiry check');
  const result = await runTokenExpiryWatch();
  logger.info('LinkedIn token expiry check finished', result);
}

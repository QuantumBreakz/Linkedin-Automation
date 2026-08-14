/**
 * S3-compatible object storage — rendered visuals and cached full-text PDFs.
 *
 * MinIO locally, R2/S3 in production; the only difference is `forcePathStyle`
 * and the endpoint, both from config.
 *
 * The client is constructed lazily. Rule: no network, and no config read, at
 * import time.
 */

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import { env } from './env';
import { UpstreamError, ValidationError } from './errors';

export interface PutObjectOptions {
  /** `Cache-Control` header. Rendered visuals are immutable — key them by hash. */
  cacheControl?: string;
  /** Small, non-secret metadata stored alongside the object. */
  metadata?: Record<string, string>;
}

export interface ObjectStorage {
  putObject(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType: string,
    options?: PutObjectOptions,
  ): Promise<{ key: string }>;
  getSignedUrl(key: string, ttlSeconds: number): Promise<string>;
  objectExists(key: string): Promise<boolean>;
  readonly bucket: string;
}

const MAX_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60; // AWS SigV4 hard ceiling.

/**
 * Object keys are built from user-controlled fragments (paper ids, spec
 * hashes). Reject traversal and absolute keys rather than trusting callers.
 */
export function assertValidKey(key: string): void {
  if (key.length === 0 || key.length > 1024) {
    throw new ValidationError('Object key must be between 1 and 1024 characters.');
  }
  if (key.startsWith('/') || key.includes('..') || key.includes('\\')) {
    throw new ValidationError(`Unsafe object key: '${key}'.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(key)) {
    throw new ValidationError('Object key contains control characters.');
  }
}

export interface CreateStorageArgs {
  client?: S3Client;
  bucket?: string;
}

export function createStorage(args: CreateStorageArgs = {}): ObjectStorage {
  const bucket = args.bucket ?? env.S3_BUCKET;
  const client = args.client ?? buildClient();

  return {
    bucket,

    async putObject(key, body, contentType, options = {}) {
      assertValidKey(key);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            CacheControl: options.cacheControl,
            Metadata: options.metadata,
          }),
        );
        return { key };
      } catch (cause) {
        throw new UpstreamError('s3', `failed to write '${key}'`, {
          status: statusOf(cause),
          cause,
        });
      }
    },

    async getSignedUrl(key, ttlSeconds) {
      assertValidKey(key);
      if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
        throw new ValidationError('Signed URL TTL must be a positive number of seconds.');
      }
      if (ttlSeconds > MAX_SIGNED_URL_TTL_SECONDS) {
        throw new ValidationError(
          `Signed URL TTL must not exceed ${MAX_SIGNED_URL_TTL_SECONDS} seconds (7 days).`,
        );
      }
      try {
        return await presign(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
          expiresIn: Math.floor(ttlSeconds),
        });
      } catch (cause) {
        throw new UpstreamError('s3', `failed to sign a URL for '${key}'`, {
          status: statusOf(cause),
          cause,
        });
      }
    },

    async objectExists(key) {
      assertValidKey(key);
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (cause) {
        const status = statusOf(cause);
        if (status === 404 || isNotFound(cause)) return false;
        // 403 on a HEAD usually means "exists but no permission" — surfacing it
        // as `false` would send the render pipeline into an infinite re-upload.
        throw new UpstreamError('s3', `failed to stat '${key}'`, { status, cause });
      }
    },
  };
}

function buildClient(): S3Client {
  const config: S3ClientConfig = {
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  };
  return new S3Client(config);
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return metadata?.httpStatusCode;
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: string }).name;
  return name === 'NotFound' || name === 'NoSuchKey';
}

let shared: ObjectStorage | undefined;

/** Process-wide storage handle. Constructed on first use. */
export function getStorage(): ObjectStorage {
  shared ??= createStorage();
  return shared;
}

/** Test hook: drop the memoised client. */
export function resetStorageCache(): void {
  shared = undefined;
}

// ────────────────────────────  key helpers  ────────────────────────────

/** `visuals/{userId}/{specHash}.png` — content-addressed, so renders are cacheable. */
export function visualObjectKey(userId: string, specHash: string, extension = 'png'): string {
  return `visuals/${userId}/${specHash}.${extension}`;
}

/** `fulltext/{userId}/{paperId}.pdf` — cached OA full text (docs/04 §Full-text acquisition). */
export function fullTextObjectKey(userId: string, paperId: string, extension = 'pdf'): string {
  return `fulltext/${userId}/${paperId}.${extension}`;
}

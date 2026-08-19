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
  getObject(key: string): Promise<Buffer>;
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

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function createStorage(args: CreateStorageArgs = {}): ObjectStorage {
  const bucket = args.bucket ?? env.S3_BUCKET;
  const client = args.client ?? buildClient();
  const localDir = join(process.cwd(), '.storage');

  async function putLocal(key: string, body: Buffer | Uint8Array | string) {
    const filePath = join(localDir, key);
    await mkdir(dirname(filePath), { recursive: true });
    const buffer = typeof body === 'string' ? Buffer.from(body, 'utf-8') : Buffer.from(body);
    await writeFile(filePath, buffer);
  }

  async function getLocal(key: string): Promise<Buffer> {
    const filePath = join(localDir, key);
    return await readFile(filePath);
  }

  async function localExists(key: string): Promise<boolean> {
    try {
      const s = await stat(join(localDir, key));
      return s.isFile();
    } catch {
      return false;
    }
  }

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
        // If S3/MinIO is unreachable (e.g. ECONNREFUSED in dev), save to local storage
        if (
          isConnectionRefused(cause) ||
          env.NODE_ENV === 'development'
        ) {
          try {
            await putLocal(key, body);
            return { key };
          } catch {
            // fall through to upstream error
          }
        }
        throw new UpstreamError('s3', `failed to write '${key}'`, {
          status: statusOf(cause),
          cause,
        });
      }
    },

    async getObject(key) {
      assertValidKey(key);
      try {
        const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const byteArray = await resp.Body?.transformToByteArray();
        if (!byteArray) throw new Error('Empty response body');
        return Buffer.from(byteArray);
      } catch (cause) {
        if (await localExists(key)) {
          return await getLocal(key);
        }
        throw new UpstreamError('s3', `failed to get '${key}'`, {
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

      // If stored locally (e.g. MinIO is down in dev), serve immediately via /api/storage/
      if (await localExists(key)) {
        return `/api/storage/${key}`;
      }

      try {
        return await presign(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
          expiresIn: Math.floor(ttlSeconds),
        });
      } catch (cause) {
        if (await localExists(key)) {
          return `/api/storage/${key}`;
        }
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
        if (status === 404 || isNotFound(cause)) {
          return await localExists(key);
        }
        if (await localExists(key)) {
          return true;
        }
        throw new UpstreamError('s3', `failed to stat '${key}'`, { status, cause });
      }
    },
  };
}

function isConnectionRefused(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: string }).code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') return true;
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const causeCode = (cause as { code?: string }).code;
    if (causeCode === 'ECONNREFUSED' || causeCode === 'ENOTFOUND') return true;
  }
  return false;
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

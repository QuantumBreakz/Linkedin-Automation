/**
 * LinkedIn posting client.
 *
 * Implements docs/02 §Posting. Key properties:
 *  - Tries /rest/posts (LinkedIn versioned API) first; falls back to /v2/ugcPosts.
 *  - Uses idempotency key on every write so a retry cannot double-post.
 *  - LINKEDIN_DRY_RUN=true skips the network call and returns a synthetic URN.
 *  - Never auto-retries on failure — the caller (job) decides (docs/02 §No auto-retry).
 */

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { UpstreamError } from '@/lib/errors';
import { decryptToken } from '@/lib/crypto';

const REST_BASE = 'https://api.linkedin.com/rest';
const V2_BASE = 'https://api.linkedin.com/v2';

// ─────────────────────  token helper  ─────────────────────────────

/** Decrypts an access token from a Bytes DB column for use in API calls. */
export function decryptAccessToken(enc: Buffer | Uint8Array): string {
  return decryptToken(enc);
}

// ─────────────────────  post request shapes  ──────────────────────

export interface PostTextRequest {
  /** urn:li:person:{sub} */
  authorUrn: string;
  accessToken: string;
  text: string;
  /** Optional link to include in the post. */
  linkUrl?: string;
  idempotencyKey: string;
}

export interface PostImageRequest extends PostTextRequest {
  /** Rendered image as a Buffer (PNG/JPEG). */
  imageBuffer: Buffer;
  imageMimeType: 'image/png' | 'image/jpeg';
  altText: string;
}

export type PostRequest = PostTextRequest | PostImageRequest;

export function isImageRequest(r: PostRequest): r is PostImageRequest {
  return 'imageBuffer' in r;
}

// ─────────────────────  post result  ─────────────────────────────

export interface PostResult {
  /** LinkedIn URN of the created share, e.g. urn:li:share:1234567890. */
  urn: string;
  permalink: string | null;
  /** Which API surface actually published the post. */
  surface: 'rest/posts' | 'v2/ugcPosts' | 'dry-run';
  rawResponse: unknown;
}

// ─────────────────────  client  ──────────────────────────────────

/**
 * Posts text (with optional link) to LinkedIn.
 * Tries /rest/posts first; falls back to /v2/ugcPosts on 40x/50x.
 */
export async function postText(req: PostTextRequest): Promise<PostResult> {
  if (env.LINKEDIN_DRY_RUN) {
    logger.info('LinkedIn dry-run: skipping text post', { draftId: req.idempotencyKey });
    return {
      urn: `urn:li:share:dry-run-${req.idempotencyKey}`,
      permalink: null,
      surface: 'dry-run',
      rawResponse: null,
    };
  }

  // Try versioned REST API
  try {
    return await _postViaRest(req);
  } catch (err) {
    logger.warn('LinkedIn /rest/posts failed, falling back to /v2/ugcPosts', { err });
  }

  return _postViaUgc(req);
}

/**
 * Uploads an image then posts with the image attached.
 */
export async function postWithImage(req: PostImageRequest): Promise<PostResult> {
  if (env.LINKEDIN_DRY_RUN) {
    logger.info('LinkedIn dry-run: skipping image post', { draftId: req.idempotencyKey });
    return {
      urn: `urn:li:share:dry-run-${req.idempotencyKey}`,
      permalink: null,
      surface: 'dry-run',
      rawResponse: null,
    };
  }

  let imageAsset: string;
  try {
    imageAsset = await _uploadImage(req);
  } catch (err) {
    logger.warn('LinkedIn image upload failed, falling back to text-only post', { err });
    return postText(req);
  }

  try {
    return await _postViaRestWithImage(req, imageAsset);
  } catch (err) {
    logger.warn('LinkedIn image post via /rest/posts failed', { err });
  }

  return _postViaUgcWithImage(req, imageAsset);
}

// ─────────────────────  REST API (/rest/posts)  ───────────────────

async function _postViaRest(req: PostTextRequest): Promise<PostResult> {
  const body: Record<string, unknown> = {
    author: req.authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: req.text },
        shareMediaCategory: req.linkUrl ? 'ARTICLE' : 'NONE',
        ...(req.linkUrl
          ? {
              media: [
                {
                  status: 'READY',
                  originalUrl: req.linkUrl,
                },
              ],
            }
          : {}),
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  const response = await _restFetch('POST', `${REST_BASE}/posts`, req.accessToken, body, req.idempotencyKey);
  const urn = response.headers.get('x-restli-id') ?? response.headers.get('X-RestLi-Id') ?? '';

  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch { /* 201 responses often have no body */ }

  if (!urn && !parsed['id']) {
    throw new UpstreamError('LinkedIn', '/rest/posts: no URN in response', { status: response.status, details: parsed });
  }

  const finalUrn = urn || String(parsed['id'] ?? '');
  return { urn: finalUrn, permalink: _permalink(finalUrn), surface: 'rest/posts', rawResponse: parsed };
}

async function _postViaRestWithImage(req: PostImageRequest, imageAsset: string): Promise<PostResult> {
  const body: Record<string, unknown> = {
    author: req.authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: req.text },
        shareMediaCategory: 'IMAGE',
        media: [
          {
            status: 'READY',
            media: imageAsset,
            description: { text: req.altText },
          },
        ],
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  const response = await _restFetch('POST', `${REST_BASE}/posts`, req.accessToken, body, req.idempotencyKey);
  const urn = response.headers.get('x-restli-id') ?? response.headers.get('X-RestLi-Id') ?? '';
  let parsed: Record<string, unknown> = {};
  try { parsed = (await response.json()) as Record<string, unknown>; } catch { /* ok */ }
  const finalUrn = urn || String(parsed['id'] ?? '');
  return { urn: finalUrn, permalink: _permalink(finalUrn), surface: 'rest/posts', rawResponse: parsed };
}

// ─────────────────────  UGC API (/v2/ugcPosts)  ──────────────────

async function _postViaUgc(req: PostTextRequest): Promise<PostResult> {
  const body: Record<string, unknown> = {
    author: req.authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: req.text },
        shareMediaCategory: req.linkUrl ? 'ARTICLE' : 'NONE',
        ...(req.linkUrl
          ? {
              media: [{ status: 'READY', originalUrl: req.linkUrl }],
            }
          : {}),
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };

  const response = await _v2Fetch('POST', `${V2_BASE}/ugcPosts`, req.accessToken, body, req.idempotencyKey);
  let parsed: Record<string, unknown> = {};
  try { parsed = (await response.json()) as Record<string, unknown>; } catch { /* ok */ }
  const urn = String(parsed['id'] ?? response.headers.get('x-restli-id') ?? '');
  return { urn, permalink: _permalink(urn), surface: 'v2/ugcPosts', rawResponse: parsed };
}

async function _postViaUgcWithImage(req: PostImageRequest, imageAsset: string): Promise<PostResult> {
  const body: Record<string, unknown> = {
    author: req.authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: req.text },
        shareMediaCategory: 'IMAGE',
        media: [{ status: 'READY', media: imageAsset }],
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };

  const response = await _v2Fetch('POST', `${V2_BASE}/ugcPosts`, req.accessToken, body, req.idempotencyKey);
  let parsed: Record<string, unknown> = {};
  try { parsed = (await response.json()) as Record<string, unknown>; } catch { /* ok */ }
  const urn = String(parsed['id'] ?? response.headers.get('x-restli-id') ?? '');
  return { urn, permalink: _permalink(urn), surface: 'v2/ugcPosts', rawResponse: parsed };
}

// ─────────────────────  image upload  ────────────────────────────

/**
 * LinkedIn image upload recipe (member posts):
 *  1. Register upload → get uploadUrl + asset URN
 *  2. Binary PUT to uploadUrl
 *  3. Asset URN goes into the post body
 */
async function _uploadImage(req: PostImageRequest): Promise<string> {
  // Step 1: register
  const registerBody = {
    registerUploadRequest: {
      owner: req.authorUrn,
      recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
      serviceRelationships: [
        {
          identifier: 'urn:li:userGeneratedContent',
          relationshipType: 'OWNER',
        },
      ],
    },
  };

  const regResp = await _restFetch(
    'POST',
    `${REST_BASE}/assets?action=registerUpload`,
    req.accessToken,
    registerBody,
    undefined,
  );

  const regData = (await regResp.json()) as {
    value?: {
      asset?: string;
      uploadMechanism?: {
        'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'?: {
          uploadUrl?: string;
        };
      };
    };
  };

  const asset = regData.value?.asset;
  const uploadUrl =
    regData.value?.uploadMechanism?.[
      'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
    ]?.uploadUrl;

  if (!asset || !uploadUrl) {
    throw new UpstreamError('LinkedIn', 'Image registration failed — missing asset or uploadUrl', {
      details: regData,
    });
  }

  // Step 2: binary upload
  let uploadResp: Response;
  try {
    uploadResp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${req.accessToken}`,
        'Content-Type': req.imageMimeType,
      },
      body: new Uint8Array(req.imageBuffer),
    });
  } catch (cause) {
    throw new UpstreamError('LinkedIn', 'Image upload PUT failed', { cause, retryable: true });
  }

  if (!uploadResp.ok) {
    throw new UpstreamError('LinkedIn', `Image upload PUT returned HTTP ${uploadResp.status}`, {
      status: uploadResp.status,
    });
  }

  return asset;
}

// ─────────────────────  fetch helpers  ───────────────────────────

async function _restFetch(
  method: string,
  url: string,
  accessToken: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'LinkedIn-Version': env.LINKEDIN_API_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  };
  if (idempotencyKey) headers['X-RestLi-Id'] = idempotencyKey;

  let resp: Response;
  try {
    resp = await fetch(url, { method, headers, body: JSON.stringify(body) });
  } catch (cause) {
    throw new UpstreamError('LinkedIn', `${method} ${url} network failure`, { cause, retryable: true });
  }

  if (!resp.ok && resp.status !== 201) {
    const text = await resp.text().catch(() => '');
    throw new UpstreamError('LinkedIn', `${method} ${url} returned HTTP ${resp.status}`, {
      status: resp.status,
      details: text.slice(0, 500),
      retryable: resp.status >= 500,
    });
  }

  return resp;
}

async function _v2Fetch(
  method: string,
  url: string,
  accessToken: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
  };
  if (idempotencyKey) headers['X-RestLi-Id'] = idempotencyKey;

  let resp: Response;
  try {
    resp = await fetch(url, { method, headers, body: JSON.stringify(body) });
  } catch (cause) {
    throw new UpstreamError('LinkedIn', `${method} ${url} network failure`, { cause, retryable: true });
  }

  if (!resp.ok && resp.status !== 201) {
    const text = await resp.text().catch(() => '');
    throw new UpstreamError('LinkedIn', `${method} ${url} returned HTTP ${resp.status}`, {
      status: resp.status,
      details: text.slice(0, 500),
      retryable: resp.status >= 500,
    });
  }

  return resp;
}

function _permalink(urn: string): string | null {
  const match = /urn:li:(?:share|ugcPost):(\d+)/.exec(urn);
  return match ? `https://www.linkedin.com/feed/update/${urn}/` : null;
}

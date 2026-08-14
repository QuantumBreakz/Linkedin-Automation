#!/usr/bin/env tsx
/**
 * M0 Spike — LinkedIn API verification script.
 *
 * docs/08-mvp-plan.md §M0
 *
 * Run this ONCE with real credentials to answer the three open questions:
 *   Q1: Does /rest/posts accept a person URN under w_member_social?
 *   Q2: Does a refresh_token come back from the token exchange?
 *   Q3: What is the exact image-upload recipe for member posts?
 *
 * Prerequisites:
 *   1. Register a LinkedIn app at https://developer.linkedin.com
 *   2. Add products: "Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn"
 *   3. Set REDIRECT_URI to http://localhost:3001/callback
 *   4. Fill in the env vars below (or export them)
 *   5. Run: npx tsx scripts/spike-linkedin.ts
 *
 * The script starts a local HTTP server, opens the OAuth URL, captures
 * the callback, exchanges the code, then posts text + image to LinkedIn.
 * Results are written to scripts/spike-results.json.
 */

import * as http from 'node:http';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

// ─── Configure these ─────────────────────────────────────────────────────────

const CLIENT_ID = process.env.SPIKE_LINKEDIN_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.SPIKE_LINKEDIN_CLIENT_SECRET ?? '';
const REDIRECT_URI = 'http://localhost:3001/callback';
const PORT = 3001;

// ─────────────────────────────────────────────────────────────────────────────

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    'Missing credentials. Set SPIKE_LINKEDIN_CLIENT_ID and SPIKE_LINKEDIN_CLIENT_SECRET.',
  );
  process.exit(1);
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function main() {
  const { verifier, challenge } = generatePkce();
  const state = randomBytes(16).toString('hex');

  const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', 'openid profile email w_member_social');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  console.log('\n=== M0 LinkedIn Spike ===\n');
  console.log('Open this URL in a browser:\n');
  console.log(authUrl.toString());
  console.log('\nWaiting for callback on http://localhost:3001/callback ...\n');

  // Start local callback server
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '', `http://localhost:${PORT}`);
      const callbackCode = url.searchParams.get('code');
      const callbackState = url.searchParams.get('callbackState') ?? url.searchParams.get('state');

      if (!callbackCode) {
        res.writeHead(400);
        res.end('No code in callback');
        reject(new Error('No code received'));
        server.close();
        return;
      }

      if (callbackState !== state) {
        res.writeHead(400);
        res.end('State mismatch');
        reject(new Error('State mismatch'));
        server.close();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>✓ Authorised. You can close this tab.</h1></body></html>');
      server.close();
      resolve(callbackCode);
    });
    server.listen(PORT);
  });

  console.log('✓ Got authorisation code\n');

  // ── Q1 & Q2: Token exchange ───────────────────────────────────────────────

  console.log('Exchanging code for tokens...');
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code_verifier: verifier,
  });

  const tokenResp = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });

  const tokenData = (await tokenResp.json()) as Record<string, unknown>;
  console.log('\nToken response:');
  console.log(JSON.stringify(tokenData, null, 2));

  const accessToken = String(tokenData['access_token'] ?? '');
  const refreshToken = tokenData['refresh_token'] ? String(tokenData['refresh_token']) : null;
  const expiresIn = tokenData['expires_in'];

  console.log(`\n→ Q2 ANSWER: refresh_token = ${refreshToken ? 'YES (partner token!)' : 'null (expected for self-serve)'}`);
  console.log(`→ Access token expires in: ${expiresIn}s (~${Math.round(Number(expiresIn) / 86400)} days)`);

  // ── Fetch person URN ──────────────────────────────────────────────────────

  const userInfoResp = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const userInfo = (await userInfoResp.json()) as { sub?: string; name?: string };
  const sub = userInfo.sub ?? '';
  const personUrn = `urn:li:person:${sub}`;
  console.log(`\n→ Person URN: ${personUrn}`);
  console.log(`→ Name: ${userInfo.name}`);

  // ── Q1: Text post via /rest/posts ─────────────────────────────────────────

  console.log('\n--- Testing /rest/posts (text) ---');
  const idempotencyKey = randomBytes(16).toString('hex');
  const postBody = {
    author: personUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text: `[M0 SPIKE TEST] LinkedIn automation spike — ${new Date().toISOString()}. This post was created by a test script. You can delete it.`,
        },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };

  const restResp = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': '202601',
      'X-Restli-Protocol-Version': '2.0.0',
      'X-RestLi-Id': idempotencyKey,
    },
    body: JSON.stringify(postBody),
  });

  const restUrn = restResp.headers.get('x-restli-id') ?? restResp.headers.get('X-RestLi-Id') ?? '';
  let restBody: unknown = null;
  try { restBody = await restResp.json(); } catch { /* 201 may have no body */ }

  console.log(`→ /rest/posts status: ${restResp.status}`);
  console.log(`→ URN from header: ${restUrn}`);
  console.log(`→ Body: ${JSON.stringify(restBody)}`);
  console.log(`\n→ Q1 ANSWER: /rest/posts with person URN = ${restResp.ok || restResp.status === 201 ? 'WORKS ✓' : `FAILED (${restResp.status}) → need v2/ugcPosts`}`);

  // ── Q3: Image upload ──────────────────────────────────────────────────────

  console.log('\n--- Testing image upload ---');

  // Register upload
  const regBody = {
    registerUploadRequest: {
      owner: personUrn,
      recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
      serviceRelationships: [
        { identifier: 'urn:li:userGeneratedContent', relationshipType: 'OWNER' },
      ],
    },
  };

  const regResp = await fetch('https://api.linkedin.com/rest/assets?action=registerUpload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': '202601',
    },
    body: JSON.stringify(regBody),
  });

  console.log(`→ registerUpload status: ${regResp.status}`);
  const regData = (await regResp.json()) as {
    value?: {
      asset?: string;
      uploadMechanism?: {
        'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'?: { uploadUrl?: string };
      };
    };
  };

  const asset = regData.value?.asset;
  const uploadUrl =
    regData.value?.uploadMechanism?.[
      'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
    ]?.uploadUrl;

  console.log(`→ asset: ${asset}`);
  console.log(`→ uploadUrl: ${uploadUrl ? 'received ✓' : 'MISSING'}`);

  let imagePostWorked = false;
  if (uploadUrl && asset) {
    // Create a minimal 1×1 white PNG for the test
    const minimalPng = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489000000' +
        '0a49444154789c6260000000000200e221bc3300000000049454e44ae426082',
      'hex',
    );

    const uploadResp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'image/png',
      },
      body: minimalPng,
    });
    console.log(`→ image PUT status: ${uploadResp.status}`);

    if (uploadResp.ok || uploadResp.status === 201) {
      // Post with image
      const imgPostBody = {
        author: personUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: '[M0 SPIKE] Image post test — delete me.' },
            shareMediaCategory: 'IMAGE',
            media: [{ status: 'READY', media: asset }],
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      };

      const imgPostResp = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'LinkedIn-Version': '202601',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(imgPostBody),
      });

      console.log(`→ image post status: ${imgPostResp.status}`);
      imagePostWorked = imgPostResp.ok || imgPostResp.status === 201;
    }
  }

  console.log(`\n→ Q3 ANSWER: image upload recipe = ${imagePostWorked ? 'WORKS ✓' : 'FAILED — check output above'}`);

  // ── Write results ─────────────────────────────────────────────────────────

  const results = {
    timestamp: new Date().toISOString(),
    personUrn,
    answers: {
      Q1_rest_posts_person_urn: restResp.ok || restResp.status === 201 ? 'WORKS' : `FAILED_${restResp.status}`,
      Q2_refresh_token: refreshToken ? 'YES_PARTNER_ONLY' : 'null_as_expected',
      Q3_image_upload: imagePostWorked ? 'WORKS' : 'FAILED',
    },
    tokenDetails: {
      expiresIn,
      hasRefreshToken: !!refreshToken,
      scopes: String(tokenData['scope'] ?? ''),
    },
    rawTokenResponse: tokenData,
  };

  const outPath = path.join(process.cwd(), 'scripts', 'spike-results.json');
  await fs.writeFile(outPath, JSON.stringify(results, null, 2));
  console.log(`\n✓ Results written to scripts/spike-results.json`);
  console.log('\nSummary:');
  console.log(JSON.stringify(results.answers, null, 2));
}

main().catch((err) => {
  console.error('\n✗ Spike failed:', err);
  process.exit(1);
});

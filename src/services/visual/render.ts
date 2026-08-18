/**
 * Visual render pipeline — Stage 5.
 *
 * docs/06-visual-engine.md
 *
 * Architecture: Satori (JSX → SVG) → resvg-js (SVG → PNG) → S3.
 *   - Numbers in the spec come from importantNumbers, which survived
 *     evidence checking in Stage 1.
 *   - specHash (sha256 of canonical JSON + template version) is the render
 *     cache key — identical specs always produce an identical PNG.
 *   - No generative image models (docs/08 — cannot be trusted with numbers).
 */

import type { VisualSpec } from './visual-types';
import { specHashFor } from '@/lib/ids';
import { getStorage } from '@/lib/storage';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';

// ────────────────────────────  template version  ─────────────────────

/**
 * Bump this whenever any template's visual output changes. Together with
 * specHashFor(), this invalidates the cache for existing specs automatically.
 */
export const TEMPLATE_VERSION = 1;

// ─────────────────────────────  canvas sizes  ────────────────────────

export const CANVAS = {
  WIDTH: 1200,
  HEIGHT: 1200,
} as const;

// ─────────────────────────────  result  ──────────────────────────────

export interface RenderResult {
  png: Buffer;
  specHash: string;
  /** S3 key if uploaded, or null if storage is unavailable. */
  storageKey: string | null;
  /** Public URL if a CDN is configured, else the raw S3 URL. */
  publicUrl: string | null;
  width: number;
  height: number;
}

// ────────────────────────────  renderer  ─────────────────────────────

/**
 * Renders a VisualSpec to a PNG and uploads it to S3.
 * Returns a cached result if the specHash already exists in storage.
 */
export async function renderVisual(spec: VisualSpec): Promise<RenderResult> {
  const specHash = specHashFor(spec, TEMPLATE_VERSION);
  const storageKey = `visuals/${specHash}.png`;

  // Cache check — same spec always produces same PNG, so we can skip render
  try {
    const existing = await getStorage().objectExists(storageKey);
    if (existing) {
      logger.debug('Visual cache hit', { specHash });
      const publicUrl = toPublicUrl(storageKey);
      return {
        png: Buffer.alloc(0), // caller gets the URL, not the bytes
        specHash,
        storageKey,
        publicUrl,
        width: CANVAS.WIDTH,
        height: CANVAS.HEIGHT,
      };
    }
  } catch {
    // Storage check failure → proceed with render
  }

  // Dynamic imports — satori and resvg are large; lazy-load to avoid cold-start overhead
  const [{ default: satori }, { Resvg }] = await Promise.all([
    import('satori'),
    import('@resvg/resvg-js'),
  ]);

  // Load fonts (bundled with the service)
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const fontsDir = join(process.cwd(), 'src/services/visual/fonts');

  const [fontRegular, fontSemiBold, fontBold] = await Promise.all([
    readFile(join(fontsDir, 'Inter-Regular.ttf')),
    readFile(join(fontsDir, 'Inter-SemiBold.ttf')),
    readFile(join(fontsDir, 'Inter-Bold.ttf')),
  ]);

  // Select template
  const element = await buildTemplate(spec);

  // Satori: JSX → SVG
  const svg = await satori(element, {
    width: CANVAS.WIDTH,
    height: CANVAS.HEIGHT,
    fonts: [
      { name: 'Inter', data: fontRegular, weight: 400, style: 'normal' },
      { name: 'Inter', data: fontSemiBold, weight: 600, style: 'normal' },
      { name: 'Inter', data: fontBold, weight: 700, style: 'normal' },
    ],
  });

  // resvg: SVG → PNG
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: CANVAS.WIDTH },
  });
  const png = Buffer.from(resvg.render().asPng());

  // Upload to S3
  let uploadedKey: string | null = null;
  try {
    await getStorage().putObject(storageKey, png, 'image/png');
    uploadedKey = storageKey;
    logger.debug('Visual uploaded', { specHash, bytes: png.length });
  } catch (err) {
    logger.warn('Visual upload failed — returning bytes only', { err, specHash });
  }

  return {
    png,
    specHash,
    storageKey: uploadedKey,
    publicUrl: uploadedKey ? toPublicUrl(uploadedKey) : null,
    width: CANVAS.WIDTH,
    height: CANVAS.HEIGHT,
  };
}

function toPublicUrl(key: string): string {
  if (env.S3_PUBLIC_URL) return `${env.S3_PUBLIC_URL}/${key}`;
  return `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`;
}

// ────────────────────────────  templates  ────────────────────────────

/**
 * Builds the Satori-compatible React element tree for the spec's template.
 * All templates use only inline styles (Satori doesn't support CSS classes).
 */
async function buildTemplate(spec: VisualSpec) {
  // We import templates lazily to avoid loading all JSX at startup
  switch (spec.template) {
    case 'STAT_CARD': {
      const { StatCard } = await import('./templates/stat-card');
      return StatCard(spec);
    }
    case 'KEY_FINDINGS': {
      const { KeyFindings } = await import('./templates/key-findings');
      return KeyFindings(spec);
    }
    case 'QUOTE_CARD': {
      const { QuoteCard } = await import('./templates/quote-card');
      return QuoteCard(spec);
    }
    case 'COMPARISON': {
      const { Comparison } = await import('./templates/comparison');
      return Comparison(spec);
    }
    case 'PROBLEM_SOLUTION': {
      const { ProblemSolution } = await import('./templates/problem-solution');
      return ProblemSolution(spec);
    }
    case 'CONCEPT_EXPLAINER': {
      const { ConceptExplainer } = await import('./templates/concept-explainer');
      return ConceptExplainer(spec);
    }
    default:
      throw new Error(`Unknown visual template: ${(spec as { template: string }).template}`);
  }
}

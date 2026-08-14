# 06 — Visual Engine

## Principle

The LLM decides **what to say and which template**. It never draws. A deterministic renderer turns
a validated `VisualSpec` into an image.

```
extraction ──LLM──→ VisualSpec (JSON, Zod-validated)
                          │
                    template registry
                          │
                    Satori (JSX → SVG)
                          │
                    resvg (SVG → PNG 1200×1200)
                          │
                    S3 + specHash cache
```

Why not generative image models for v1: they cannot render text reliably, they cannot be trusted
with a number, and they are not reproducible. A research statistic rendered as "37%" must be
exactly "37%" — every time, byte-identical. Generative models remain a *later, optional* path for
decorative backgrounds only, never for anything load-bearing.

## VisualSpec schema

```ts
const VisualSpec = z.object({
  template: z.enum([
    'STAT_CARD',          // one dominant number
    'KEY_FINDINGS',       // 2–4 bullets
    'BEFORE_AFTER',       // two-column contrast
    'PROBLEM_SOLUTION',   // two-panel
    'PROCESS_FLOW',       // 3–5 chevron steps
    'COMPARISON',         // labelled bar comparison
    'CONCEPT_EXPLAINER',  // term + plain-language definition
    'QUOTE_CARD',         // a stated finding, verbatim
  ]),
  eyebrow: z.string().max(40),          // "RESEARCH INSIGHT"
  headline: z.string().max(90),
  subhead: z.string().max(140).nullable(),

  stat: z.object({
    value: z.string().max(12),          // "37%", "1.4×", "p<0.001"
    label: z.string().max(60),
    /** Index into PaperAnalysis.extraction.importantNumbers. Required. */
    sourceRef: z.number().int(),
  }).nullable(),

  items: z.array(z.object({
    label: z.string().max(70),
    detail: z.string().max(120).nullable(),
    emphasis: z.boolean().default(false),
  })).max(5),

  comparison: z.object({
    leftLabel: z.string().max(30),  leftValue: z.string().max(12),
    rightLabel: z.string().max(30), rightValue: z.string().max(12),
  }).nullable(),

  footer: z.object({
    attribution: z.string().max(80),    // "Khan et al., Nature Methods 2026"
    showDoi: z.boolean().default(true),
  }),

  theme: z.enum(['LIGHT', 'DARK', 'ACCENT']).default('LIGHT'),
  altText: z.string().min(20).max(400), // accessibility: required, never generated as filler
});
```

### Constraints that are enforced, not requested

- **`stat.sourceRef` is mandatory.** A number can only appear in a visual if it points at a
  surviving `importantNumbers` entry. The renderer re-reads the value from the extraction rather
  than trusting `stat.value` — so a model that "improves" 37% to 40% between stages is overridden
  by the source of truth.
- **Length caps are hard.** Overflowing text is truncated at render with an ellipsis and the
  draft is flagged, rather than silently producing an unreadable image. A caption that does not
  fit is a content bug worth surfacing.
- **`altText` is required and non-trivial.** It is published to LinkedIn as the image alt text.
  Our users are academics posting to a professional audience; inaccessible images are not
  acceptable output.

## Rendering

- **Output:** 1200×1200 PNG (LinkedIn square feed). 1200×627 landscape variant available per
  template.
- **Determinism:** fonts embedded in the worker image, no network fetches at render time, fixed
  layout maths. `specHash = sha256(canonicalJson(spec) + templateVersion)` is the cache key —
  identical specs never re-render.
- **Templates** live in `src/services/visual/templates/*.tsx` as Satori-compatible JSX. Each
  exports `{ id, version, render(spec, brand), requiredFields }`. `templateVersion` participates
  in the cache key so a template edit invalidates cleanly.
- **Theming** derives from the user's brand settings — accent colour, font pairing — so a lab's
  posts look consistent without per-post design work.

## Template → data requirements

| Template | Needs | Falls back to |
| --- | --- | --- |
| `STAT_CARD` | ≥1 `importantNumbers` | `QUOTE_CARD` |
| `KEY_FINDINGS` | ≥2 `STATED` findings | `QUOTE_CARD` |
| `BEFORE_AFTER` | comparison pair | `STAT_CARD` |
| `PROBLEM_SOLUTION` | `problem` + `novelty` both `STATED` | `KEY_FINDINGS` |
| `PROCESS_FLOW` | `methodology` `STATED` (needs full text) | `KEY_FINDINGS` |
| `COMPARISON` | two comparable numbers | `STAT_CARD` |
| `CONCEPT_EXPLAINER` | ≥1 `technicalTerms` | `QUOTE_CARD` |
| `QUOTE_CARD` | ≥1 `STATED` finding | — (universal fallback) |

The fallback chain guarantees every paper with at least one stated finding gets a usable visual.
A paper with *no* stated findings does not get a post at all — it stays in the inbox for the user
to handle manually.

## Publishing path

Rendered PNG → S3 → LinkedIn image upload (`registerUpload` / `initializeUpload`, per the surface
resolved in the Phase-1 spike) → attach asset URN to the post with `altText`.

If the image upload fails, the post is **not** silently downgraded to text-only — a
`VISUAL_EXPLAINER` without its visual is a different post. The publish fails and surfaces for
retry.

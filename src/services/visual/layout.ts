/**
 * Layout maths for the card templates.
 *
 * Satori lays out a fixed 1200×1200 canvas with no scrolling and no automatic
 * shrink-to-fit: content taller than the canvas does not clip politely, it
 * collides with whatever sits above it. A paper whose fields all arrive at
 * their schema maximum (five 200-character findings under a 120-character
 * headline) rendered an unreadable card with the headline overlapping the
 * first bullet — and that image would have gone out on a real post.
 *
 * So type size is derived from the content rather than fixed: each template
 * asks for the largest size on a ladder whose estimated height fits the space
 * it has. Short content keeps the large, confident type; maximal content steps
 * down until it fits. The card is legible either way.
 *
 * Estimation is deliberately conservative — erring toward "this is taller than
 * it will really be" costs a step of font size, while erring the other way
 * costs a broken image.
 */

/** The rendered canvas, mirroring CANVAS in render.ts. */
export const CARD = {
  WIDTH: 1200,
  HEIGHT: 1200,
  /** Horizontal padding used by every template. */
  PADDING: 80,
} as const;

/** Usable width inside the standard horizontal padding. */
export const CONTENT_WIDTH = CARD.WIDTH - CARD.PADDING * 2;

/**
 * Mean glyph advance as a fraction of font size, measured from rendered Inter
 * output: ~0.52 for the semibold/bold display sizes, ~0.55 for regular body
 * text. Body is the default because under-estimating width is the dangerous
 * direction.
 */
export const CHAR_WIDTH_RATIO = {
  DISPLAY: 0.52,
  BODY: 0.55,
} as const;

/**
 * Lines `text` needs at `fontSize` within `widthPx`, by simulating the greedy
 * word wrap Satori performs. Counting `length / charsPerLine` would under-count
 * (words do not break mid-word), which is precisely the direction that breaks
 * a card.
 */
export function estimateLineCount(
  text: string,
  fontSize: number,
  widthPx: number,
  charWidthRatio: number = CHAR_WIDTH_RATIO.BODY,
): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;

  const charsPerLine = Math.max(1, Math.floor(widthPx / (fontSize * charWidthRatio)));

  let lines = 1;
  let column = 0;
  for (const word of trimmed.split(/\s+/)) {
    if (column === 0) {
      column = word.length;
    } else if (column + 1 + word.length <= charsPerLine) {
      column += 1 + word.length;
    } else {
      lines += 1;
      column = word.length;
    }
    // A single word longer than the line wraps onto further lines.
    while (column > charsPerLine) {
      lines += 1;
      column -= charsPerLine;
    }
  }
  return lines;
}

/** Estimated rendered height of `text` in pixels. */
export function estimateHeight(
  text: string,
  fontSize: number,
  widthPx: number,
  lineHeight: number,
  charWidthRatio: number = CHAR_WIDTH_RATIO.BODY,
): number {
  return estimateLineCount(text, fontSize, widthPx, charWidthRatio) * fontSize * lineHeight;
}

/**
 * The largest size in `ladder` (descending) at which `text` fits `maxHeightPx`.
 * Falls back to the smallest rung when nothing fits — a slightly cramped card
 * still beats an overlapping one.
 */
export function fitFontSize(
  text: string,
  widthPx: number,
  maxHeightPx: number,
  ladder: readonly number[],
  lineHeight: number,
  charWidthRatio: number = CHAR_WIDTH_RATIO.BODY,
): number {
  for (const size of ladder) {
    if (estimateHeight(text, size, widthPx, lineHeight, charWidthRatio) <= maxHeightPx) {
      return size;
    }
  }
  return ladder[ladder.length - 1]!;
}

/**
 * The largest size at which `text` stays on a single line.
 *
 * For hero figures: a stat is "37%" most of the time, but nothing stops it
 * being "37.5 percentage points", which at a fixed display size wrapped onto
 * three lines and swallowed the whole card. A hero that shrinks to fit reads as
 * designed; one that wraps reads as broken.
 */
export function fitSingleLine(
  text: string,
  widthPx: number,
  ladder: readonly number[],
  charWidthRatio: number = CHAR_WIDTH_RATIO.DISPLAY,
): number {
  for (const size of ladder) {
    if (estimateLineCount(text, size, widthPx, charWidthRatio) <= 1) return size;
  }
  return ladder[ladder.length - 1]!;
}

/**
 * The largest size at which *every* item fits a shared height budget, counting
 * the gaps between them. Used for bullet lists, where the constraint is the
 * total rather than any single item.
 */
export function fitFontSizeForItems(
  items: readonly string[],
  widthPx: number,
  maxHeightPx: number,
  ladder: readonly number[],
  lineHeight: number,
  gapRatio: number,
  charWidthRatio: number = CHAR_WIDTH_RATIO.BODY,
): number {
  for (const size of ladder) {
    const text = items.reduce(
      (sum, item) => sum + estimateHeight(item, size, widthPx, lineHeight, charWidthRatio),
      0,
    );
    const gaps = size * gapRatio * Math.max(0, items.length - 1);
    if (text + gaps <= maxHeightPx) return size;
  }
  return ladder[ladder.length - 1]!;
}

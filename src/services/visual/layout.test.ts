import { describe, it, expect } from 'vitest';
import {
  CONTENT_WIDTH,
  CHAR_WIDTH_RATIO,
  estimateLineCount,
  estimateHeight,
  fitFontSize,
  fitSingleLine,
  fitFontSizeForItems,
} from './layout';

describe('visual/layout', () => {
  it('counts a single short line as one line', () => {
    expect(estimateLineCount('Recall improved', 30, CONTENT_WIDTH)).toBe(1);
    expect(estimateLineCount('', 30, CONTENT_WIDTH)).toBe(0);
  });

  it('wraps on word boundaries rather than mid-word', () => {
    // 20 eight-letter words cannot fit a 100px column at 30px type; a naive
    // length/charsPerLine count would under-count and let the card overflow.
    const text = Array.from({ length: 20 }, () => 'abcdefgh').join(' ');
    const lines = estimateLineCount(text, 30, 200);
    const charsPerLine = Math.floor(200 / (30 * CHAR_WIDTH_RATIO.BODY));
    expect(lines).toBeGreaterThanOrEqual(Math.ceil(text.length / charsPerLine));
  });

  it('breaks a single word longer than the line', () => {
    expect(estimateLineCount('x'.repeat(400), 30, 200)).toBeGreaterThan(1);
  });

  it('scales estimated height with line count and line height', () => {
    const one = estimateHeight('short', 30, CONTENT_WIDTH, 1.4);
    expect(one).toBeCloseTo(30 * 1.4);
    expect(estimateHeight('word '.repeat(200), 30, CONTENT_WIDTH, 1.4)).toBeGreaterThan(one);
  });

  it('picks the largest size that fits, and the smallest when nothing does', () => {
    const ladder = [40, 30, 20] as const;
    expect(fitFontSize('short', CONTENT_WIDTH, 1000, ladder, 1.4)).toBe(40);
    // A budget too small for even the smallest rung still returns a size —
    // a cramped card beats a crashed render.
    expect(fitFontSize('word '.repeat(500), 200, 10, ladder, 1.4)).toBe(20);
  });

  it('keeps a hero figure on one line by shrinking it', () => {
    const ladder = [160, 132, 108, 88, 72, 58, 48] as const;
    expect(fitSingleLine('37%', CONTENT_WIDTH, ladder)).toBe(160);
    // The real regression: a wordy stat wrapped to three lines at 160px.
    const wordy = fitSingleLine('37.5 percentage points', CONTENT_WIDTH, ladder);
    expect(wordy).toBeLessThan(160);
    expect(estimateLineCount('37.5 percentage points', wordy, CONTENT_WIDTH, CHAR_WIDTH_RATIO.DISPLAY)).toBe(1);
  });

  it('sizes a list so every item plus the gaps fits the budget', () => {
    const items = Array.from({ length: 5 }, () => 'a'.repeat(200));
    const ladder = [30, 27, 24, 22, 20, 18] as const;
    const budget = 700;
    const size = fitFontSizeForItems(items, CONTENT_WIDTH, budget, ladder, 1.4, 0.9);

    const total =
      items.reduce((sum, item) => sum + estimateHeight(item, size, CONTENT_WIDTH, 1.4), 0) +
      size * 0.9 * (items.length - 1);
    expect(total).toBeLessThanOrEqual(budget);
    // Five maximal findings must not still be asking for the largest rung.
    expect(size).toBeLessThan(30);
  });

  it('leaves short content at the largest rung', () => {
    const size = fitFontSizeForItems(['Recall held', 'Latency flat'], CONTENT_WIDTH, 700, [30, 24], 1.4, 0.9);
    expect(size).toBe(30);
  });
});

/**
 * Card colour palettes.
 *
 * Every card used to render in the same indigo-on-midnight scheme, so a feed of
 * them looked like one repeated image. These are eight distinct schemes, picked
 * per paper.
 *
 * The pick is deliberately *deterministic*, not random. `specHashFor` derives
 * the render cache key from the spec, and render.ts guarantees that "identical
 * specs always produce an identical PNG". A `Math.random()` palette would leave
 * the spec unchanged while changing the image, so the cache would serve the
 * wrong PNG and a card would change colour every time it re-rendered. Seeding
 * from the paper instead gives variety across a feed and stability within one
 * paper: the same paper always looks the same, two papers rarely match.
 */

/**
 * A colour scheme. All schemes are light-text-on-dark by construction.
 *
 * `accent` is *the* colour of a card: one hue carries every highlighted
 * element on it. An earlier version cycled a `series` of five hues within a
 * single card, which put purple, pink and blue bullets on the same image — a
 * card should read as one colour, and the variety belongs between cards.
 * `primary` survives only for the 6px header rule.
 */
export interface Palette {
  readonly name: string;
  /** Gradient start. */
  readonly background: string;
  /** Gradient end — the lifted corner of the card. */
  readonly surface: string;
  /** Used only for the header rule's gradient. */
  readonly primary: string;
  /** The card's single content colour. */
  readonly accent: string;
  readonly text: string;
}

/** Eight schemes, each with a clearly distinct accent hue. */
export const PALETTES: readonly Palette[] = [
  {
    name: 'midnight', // cyan
    background: '#0A0F1E',
    surface: '#111827',
    primary: '#6366F1',
    accent: '#22D3EE',
    text: '#F1F5F9',
  },
  {
    name: 'forest', // lime
    background: '#05140F',
    surface: '#0C2018',
    primary: '#10B981',
    accent: '#A3E635',
    text: '#ECFDF5',
  },
  {
    name: 'plum', // pink
    background: '#14091E',
    surface: '#1E1030',
    primary: '#A855F7',
    accent: '#F472B6',
    text: '#FAF5FF',
  },
  {
    name: 'ember', // amber
    background: '#1A0C05',
    surface: '#2A1409',
    primary: '#F97316',
    accent: '#FBBF24',
    text: '#FFF7ED',
  },
  {
    name: 'ocean', // blue
    background: '#04121F',
    surface: '#082438',
    primary: '#0EA5E9',
    accent: '#60A5FA',
    text: '#F0F9FF',
  },
  {
    name: 'crimson', // rose
    background: '#1A0710',
    surface: '#2A0C1A',
    primary: '#FB923C',
    accent: '#F43F5E',
    text: '#FFF1F2',
  },
  {
    name: 'graphite', // slate
    background: '#0E1117',
    surface: '#1A1F2B',
    primary: '#64748B',
    accent: '#94A3B8',
    text: '#F8FAFC',
  },
  {
    name: 'aurora', // violet
    background: '#071414',
    surface: '#0E2226',
    primary: '#2DD4BF',
    accent: '#C084FC',
    text: '#F0FDFA',
  },
];

/**
 * The scheme a template falls back to when a spec carries no theme — which is
 * the case for every card rendered before palettes existed, so those keep
 * rendering exactly as they did.
 */
export const DEFAULT_THEME = {
  background: PALETTES[0]!.background,
  surface: PALETTES[0]!.surface,
  primary: PALETTES[0]!.primary,
  accent: PALETTES[0]!.accent,
  text: PALETTES[0]!.text,
};

/** FNV-1a. Small, stable across runs, and good enough to spread short strings. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The palette for a seed — pass something stable per paper (its title). The
 * same seed always yields the same palette; different seeds spread across the
 * set.
 */
export function paletteFor(seed: string): Palette {
  return PALETTES[hashString(seed) % PALETTES.length]!;
}

/** Looks a palette up by name, falling back to the default scheme. */
export function paletteByName(name: string): Palette {
  return PALETTES.find((palette) => palette.name === name) ?? PALETTES[0]!;
}

/**
 * `#RRGGBB` → `rgba(r, g, b, alpha)`, so panels and rules can be tinted from
 * the active palette instead of hard-coding a colour per template.
 */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return hex;
  const int = parseInt(match[1]!, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

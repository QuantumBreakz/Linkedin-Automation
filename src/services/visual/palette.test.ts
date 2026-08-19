import { describe, it, expect } from 'vitest';
import { PALETTES, DEFAULT_THEME, paletteFor, paletteByName, withAlpha } from './palette';
import { selectVisualSpec, type VisualPaperContext } from './select';

const HEX = /^#[0-9a-fA-F]{6}$/;

describe('visual/palette', () => {
  it('defines well-formed palettes with unique names', () => {
    expect(PALETTES.length).toBeGreaterThanOrEqual(4);
    for (const palette of PALETTES) {
      for (const colour of [palette.background, palette.surface, palette.primary, palette.accent, palette.text]) {
        expect(colour).toMatch(HEX);
      }
    }
    expect(new Set(PALETTES.map((p) => p.name)).size).toBe(PALETTES.length);
  });

  it('gives each palette a distinct accent, since accent is the card colour', () => {
    // One hue carries a whole card, so two palettes sharing an accent would
    // make two papers look identical.
    const accents = PALETTES.map((p) => p.accent);
    expect(new Set(accents).size).toBe(accents.length);
  });

  it('is deterministic — the same seed always yields the same palette', () => {
    // Load-bearing: specHashFor derives the render cache key from the spec, so a
    // palette that changed between renders would make the cache serve a PNG
    // that no longer matches its key.
    for (const seed of ['Sparse attention in clinical notes', 'Another paper entirely', '']) {
      expect(paletteFor(seed)).toBe(paletteFor(seed));
    }
  });

  it('spreads different seeds across the available palettes', () => {
    const seen = new Set(
      Array.from({ length: 200 }, (_, i) => paletteFor(`A paper about topic number ${i}`).name),
    );
    // Not a uniformity proof — just that it is not collapsing onto one scheme.
    expect(seen.size).toBeGreaterThan(PALETTES.length / 2);
  });

  it('looks palettes up by name and falls back to the default', () => {
    expect(paletteByName('forest').name).toBe('forest');
    expect(paletteByName('does-not-exist')).toBe(PALETTES[0]);
  });

  it('exposes the first palette as the no-theme fallback', () => {
    // Cards rendered before palettes existed carry no theme and must be unchanged.
    expect(DEFAULT_THEME.background).toBe(PALETTES[0]!.background);
    expect(DEFAULT_THEME.primary).toBe(PALETTES[0]!.primary);
  });

  it('converts hex to rgba and passes through anything else', () => {
    expect(withAlpha('#6366F1', 0.12)).toBe('rgba(99, 102, 241, 0.12)');
    expect(withAlpha('#000000', 1)).toBe('rgba(0, 0, 0, 1)');
    expect(withAlpha('rgba(1,2,3,0.5)', 0.2)).toBe('rgba(1,2,3,0.5)');
  });
});

describe('visual/select — theming', () => {
  const paper = (title: string): VisualPaperContext => ({
    title,
    venue: 'NeurIPS 2025',
    authors: [{ name: 'Dr. Elena Rostova', isUser: true, position: 1 }],
  });
  const extraction = {
    importantNumbers: [{ metric: 'Recall', value: '37%', context: 'over baseline', evidence: '37%' }],
  };

  it('attaches a theme to the spec, so it is part of the render cache key', () => {
    const spec = selectVisualSpec(extraction, paper('Sparse attention'));
    expect(spec?.theme).toBeDefined();
    expect(spec?.theme?.background).toMatch(HEX);
    expect(spec?.theme?.accent).toMatch(HEX);
  });

  it('gives one paper a stable theme and different papers different ones', () => {
    const a1 = selectVisualSpec(extraction, paper('Sparse attention in clinical notes'));
    const a2 = selectVisualSpec(extraction, paper('Sparse attention in clinical notes'));
    expect(a1?.theme).toEqual(a2?.theme);

    const backgrounds = new Set(
      Array.from({ length: 40 }, (_, i) => selectVisualSpec(extraction, paper(`Paper ${i}`))?.theme?.background),
    );
    expect(backgrounds.size).toBeGreaterThan(1);
  });
});

/**
 * STAT_CARD template — a single statistic, large and prominent.
 *
 * Layout: dark gradient background, large centred stat, headline above,
 * context and source below.
 */

import type { VisualSpec } from '../visual-types';
import React from 'react';
import { CONTENT_WIDTH, CHAR_WIDTH_RATIO, fitFontSize, fitSingleLine } from '../layout';
import { DEFAULT_THEME, withAlpha } from '../palette';

type StatCardSpec = Extract<VisualSpec, { template: 'STAT_CARD' }>;


/** The hero figure shrinks rather than wrapping — see fitSingleLine. */
const STAT_LADDER = [160, 132, 108, 88, 72, 58, 48] as const;
const HEADLINE_LADDER = [42, 38, 34, 30] as const;
const LABEL_LADDER = [36, 32, 28, 25] as const;
const CONTEXT_LADDER = [28, 26, 23, 21] as const;

export function StatCard(spec: StatCardSpec) {
  const theme = { ...DEFAULT_THEME, ...spec.theme };

  const statSize = fitSingleLine(spec.stat, CONTENT_WIDTH, STAT_LADDER);
  const headlineSize = fitFontSize(
    spec.headline,
    CONTENT_WIDTH,
    190,
    HEADLINE_LADDER,
    1.3,
    CHAR_WIDTH_RATIO.DISPLAY,
  );
  const labelSize = fitFontSize(spec.statLabel, CONTENT_WIDTH, 100, LABEL_LADDER, 1.25);
  const contextSize = fitFontSize(spec.context, CONTENT_WIDTH, 190, CONTEXT_LADDER, 1.5);

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: `linear-gradient(135deg, ${theme.background} 0%, ${theme.surface} 100%)`,
        padding: '80px',
        fontFamily: 'Inter',
        position: 'relative',
      },
    },
    // Top accent bar
    React.createElement('div', {
      style: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '6px',
        background: `linear-gradient(90deg, ${theme.primary}, ${theme.accent})`,
      },
    }),
    // Headline
    React.createElement(
      'div',
      {
        style: {
          fontSize: `${headlineSize}px`,
          fontWeight: 600,
          color: theme.text,
          opacity: 0.9,
          marginTop: '40px',
          lineHeight: 1.3,
        },
      },
      spec.headline,
    ),
    // Spacer
    React.createElement('div', { style: { flex: 1 } }),
    // Stat — the hero element
    React.createElement(
      'div',
      {
        style: {
          fontSize: `${statSize}px`,
          fontWeight: 700,
          color: theme.accent,
          lineHeight: 1,
          letterSpacing: `${Math.round(statSize * -0.025)}px`,
        },
      },
      spec.stat,
    ),
    // Stat label
    React.createElement(
      'div',
      {
        style: {
          fontSize: `${labelSize}px`,
          fontWeight: 600,
          color: theme.primary,
          marginTop: '16px',
          lineHeight: 1.25,
        },
      },
      spec.statLabel,
    ),
    // Context
    React.createElement(
      'div',
      {
        style: {
          fontSize: `${contextSize}px`,
          color: theme.text,
          opacity: 0.7,
          marginTop: '24px',
          lineHeight: 1.5,
        },
      },
      spec.context,
    ),
    // Spacer
    React.createElement('div', { style: { flex: 1 } }),
    // Source
    React.createElement(
      'div',
      {
        style: {
          fontSize: '22px',
          color: theme.text,
          opacity: 0.4,
          borderTop: `1px solid ${withAlpha(theme.text, 0.12)}`,
          paddingTop: '20px',
          marginTop: '20px',
        },
      },
      spec.source,
    ),
  );
}

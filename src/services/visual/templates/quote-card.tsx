/**
 * QUOTE_CARD template — a single highlighted quote from the paper.
 */

import type { VisualSpec } from '../visual-types';
import React from 'react';
import { CONTENT_WIDTH, CHAR_WIDTH_RATIO, fitFontSize } from '../layout';
import { DEFAULT_THEME, withAlpha } from '../palette';

type QuoteCardSpec = Extract<VisualSpec, { template: 'QUOTE_CARD' }>;


const QUOTE_LADDER = [44, 40, 36, 33, 30, 27] as const;
/** Height left for the quote once the mark, rule, attribution and source are placed. */
const QUOTE_BUDGET = 560;

export function QuoteCard(spec: QuoteCardSpec) {
  const theme = { ...DEFAULT_THEME, ...spec.theme };

  const quoteSize = fitFontSize(
    spec.quote,
    CONTENT_WIDTH,
    QUOTE_BUDGET,
    QUOTE_LADDER,
    1.4,
    CHAR_WIDTH_RATIO.DISPLAY,
  );

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        background: `linear-gradient(135deg, ${theme.background} 0%, ${theme.surface} 100%)`,
        padding: '100px 80px',
        fontFamily: 'Inter',
        position: 'relative',
      },
    },
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
    // Large quote mark
    React.createElement(
      'div',
      {
        style: {
          fontSize: '160px',
          fontWeight: 700,
          color: theme.accent,
          opacity: 0.3,
          lineHeight: 0.8,
          marginBottom: '-20px',
        },
      },
      '\u201C',
    ),
    // Quote text
    React.createElement(
      'div',
      {
        style: {
          fontSize: `${quoteSize}px`,
          fontWeight: 600,
          color: theme.text,
          lineHeight: 1.4,
          marginBottom: '40px',
        },
      },
      spec.quote,
    ),
    // Accent line + attribution
    React.createElement('div', {
      style: {
        width: '60px',
        height: '4px',
        background: theme.accent,
        marginBottom: '20px',
      },
    }),
    React.createElement(
      'div',
      {
        style: {
          fontSize: '26px',
          color: theme.accent,
          fontWeight: 600,
          marginBottom: '12px',
        },
      },
      spec.attribution,
    ),
    React.createElement(
      'div',
      {
        style: {
          fontSize: '24px',
          color: theme.text,
          opacity: 0.6,
          marginBottom: '60px',
        },
      },
      spec.context,
    ),
    React.createElement(
      'div',
      {
        style: {
          fontSize: '20px',
          color: theme.text,
          opacity: 0.35,
          position: 'absolute',
          bottom: '50px',
          left: '80px',
          right: '80px',
          borderTop: `1px solid ${withAlpha(theme.text, 0.12)}`,
          paddingTop: '20px',
        },
      },
      spec.source,
    ),
  );
}

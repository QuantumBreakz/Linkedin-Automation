/**
 * QUOTE_CARD template — a single highlighted quote from the paper.
 */

import type { VisualSpec } from '../visual-types';
import React from 'react';

type QuoteCardSpec = Extract<VisualSpec, { template: 'QUOTE_CARD' }>;

const DEFAULTS = {
  background: '#0A0F1E',
  primary: '#6366F1',
  text: '#F1F5F9',
  accent: '#22D3EE',
};

export function QuoteCard(spec: QuoteCardSpec) {
  const theme = { ...DEFAULTS, ...spec.theme };

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        background: `linear-gradient(135deg, ${theme.background} 0%, #1e1b4b 100%)`,
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
          color: theme.primary,
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
          fontSize: '44px',
          fontWeight: 600,
          color: theme.text,
          lineHeight: 1.4,
          maxWidth: '960px',
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
          borderTop: `1px solid rgba(255,255,255,0.1)`,
          paddingTop: '20px',
        },
      },
      spec.source,
    ),
  );
}

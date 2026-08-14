/**
 * STAT_CARD template — a single statistic, large and prominent.
 *
 * Layout: dark gradient background, large centred stat, headline above,
 * context and source below.
 */

import type { VisualSpec } from '../visual-types';
import React from 'react';

type StatCardSpec = Extract<VisualSpec, { template: 'STAT_CARD' }>;

const DEFAULTS = {
  background: '#0A0F1E',
  primary: '#6366F1',
  text: '#F1F5F9',
  accent: '#22D3EE',
};

export function StatCard(spec: StatCardSpec) {
  const theme = { ...DEFAULTS, ...spec.theme };

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: `linear-gradient(135deg, ${theme.background} 0%, #1a1f3a 100%)`,
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
          fontSize: '42px',
          fontWeight: 600,
          color: theme.text,
          opacity: 0.9,
          marginTop: '40px',
          lineHeight: 1.3,
          maxWidth: '900px',
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
          fontSize: '160px',
          fontWeight: 700,
          color: theme.accent,
          lineHeight: 1,
          letterSpacing: '-4px',
        },
      },
      spec.stat,
    ),
    // Stat label
    React.createElement(
      'div',
      {
        style: {
          fontSize: '36px',
          fontWeight: 600,
          color: theme.primary,
          marginTop: '16px',
        },
      },
      spec.statLabel,
    ),
    // Context
    React.createElement(
      'div',
      {
        style: {
          fontSize: '28px',
          color: theme.text,
          opacity: 0.7,
          marginTop: '24px',
          lineHeight: 1.5,
          maxWidth: '880px',
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
          borderTop: `1px solid rgba(255,255,255,0.1)`,
          paddingTop: '20px',
          marginTop: '20px',
        },
      },
      spec.source,
    ),
  );
}

/**
 * KEY_FINDINGS template — up to 5 bullet findings on a dark background.
 */

import type { VisualSpec } from '../visual-types';
import React from 'react';

type KeyFindingsSpec = Extract<VisualSpec, { template: 'KEY_FINDINGS' }>;

const DEFAULTS = {
  background: '#0A0F1E',
  primary: '#6366F1',
  text: '#F1F5F9',
  accent: '#22D3EE',
};

const BULLET_COLOURS = ['#6366F1', '#22D3EE', '#A78BFA', '#34D399', '#F472B6'];

export function KeyFindings(spec: KeyFindingsSpec) {
  const theme = { ...DEFAULTS, ...spec.theme };

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: `linear-gradient(150deg, ${theme.background} 0%, #111827 100%)`,
        padding: '80px',
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
    // Headline
    React.createElement(
      'div',
      {
        style: {
          fontSize: '44px',
          fontWeight: 700,
          color: theme.text,
          marginTop: '40px',
          lineHeight: 1.2,
          marginBottom: '48px',
        },
      },
      spec.headline,
    ),
    // Findings
    ...spec.findings.map((finding, i) =>
      React.createElement(
        'div',
        {
          key: i,
          style: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: '20px',
            marginBottom: '28px',
          },
        },
        React.createElement('div', {
          style: {
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            background: BULLET_COLOURS[i % BULLET_COLOURS.length],
            marginTop: '14px',
            flexShrink: 0,
          },
        }),
        React.createElement(
          'div',
          {
            style: {
              fontSize: '30px',
              color: theme.text,
              opacity: 0.9,
              lineHeight: 1.4,
              fontWeight: i === 0 ? 600 : 400,
            },
          },
          finding,
        ),
      ),
    ),
    React.createElement('div', { style: { flex: 1 } }),
    React.createElement(
      'div',
      {
        style: {
          fontSize: '22px',
          color: theme.text,
          opacity: 0.4,
          borderTop: `1px solid rgba(255,255,255,0.1)`,
          paddingTop: '20px',
        },
      },
      spec.source,
    ),
  );
}

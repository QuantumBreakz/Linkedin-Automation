/**
 * COMPARISON template — two values side-by-side with a divider.
 * E.g. "Control group: 12%" vs "Treatment group: 37%".
 */

import type { VisualSpec } from '../visual-types';
import React from 'react';

type ComparisonSpec = Extract<VisualSpec, { template: 'COMPARISON' }>;

const DEFAULTS = {
  background: '#0A0F1E',
  primary: '#6366F1',
  text: '#F1F5F9',
  accent: '#22D3EE',
};

export function Comparison(spec: ComparisonSpec) {
  const theme = { ...DEFAULTS, ...spec.theme };

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: `linear-gradient(135deg, ${theme.background} 0%, #111827 100%)`,
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
          marginBottom: '60px',
        },
      },
      spec.headline,
    ),
    // Two-column comparison
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'row',
          flex: 1,
          gap: '0',
          alignItems: 'center',
        },
      },
      // Left
      React.createElement(
        'div',
        {
          style: {
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '40px',
            background: `rgba(99, 102, 241, 0.1)`,
            borderRadius: '24px',
          },
        },
        React.createElement(
          'div',
          {
            style: {
              fontSize: '100px',
              fontWeight: 700,
              color: theme.primary,
              lineHeight: 1,
            },
          },
          spec.leftValue,
        ),
        React.createElement(
          'div',
          {
            style: {
              fontSize: '28px',
              color: theme.text,
              opacity: 0.7,
              textAlign: 'center',
              marginTop: '16px',
            },
          },
          spec.leftLabel,
        ),
      ),
      // Divider
      React.createElement(
        'div',
        {
          style: {
            fontSize: '40px',
            fontWeight: 700,
            color: theme.text,
            opacity: 0.3,
            padding: '0 24px',
          },
        },
        'vs',
      ),
      // Right
      React.createElement(
        'div',
        {
          style: {
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '40px',
            background: `rgba(34, 211, 238, 0.1)`,
            borderRadius: '24px',
          },
        },
        React.createElement(
          'div',
          {
            style: {
              fontSize: '100px',
              fontWeight: 700,
              color: theme.accent,
              lineHeight: 1,
            },
          },
          spec.rightValue,
        ),
        React.createElement(
          'div',
          {
            style: {
              fontSize: '28px',
              color: theme.text,
              opacity: 0.7,
              textAlign: 'center',
              marginTop: '16px',
            },
          },
          spec.rightLabel,
        ),
      ),
    ),
    // Context
    React.createElement(
      'div',
      {
        style: {
          fontSize: '28px',
          color: theme.text,
          opacity: 0.6,
          marginTop: '40px',
          lineHeight: 1.5,
          textAlign: 'center',
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
          marginTop: '32px',
          borderTop: `1px solid rgba(255,255,255,0.1)`,
          paddingTop: '20px',
        },
      },
      spec.source,
    ),
  );
}

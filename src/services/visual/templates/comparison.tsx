/**
 * COMPARISON template — two values side-by-side with a divider.
 * E.g. "Control group: 12%" vs "Treatment group: 37%".
 */

import type { VisualSpec } from '../visual-types';
import React from 'react';
import { CONTENT_WIDTH, CHAR_WIDTH_RATIO, fitFontSize, fitSingleLine } from '../layout';

type ComparisonSpec = Extract<VisualSpec, { template: 'COMPARISON' }>;

const DEFAULTS = {
  background: '#0A0F1E',
  primary: '#6366F1',
  text: '#F1F5F9',
  accent: '#22D3EE',
};

const HEADLINE_LADDER = [44, 40, 36, 32, 28] as const;
const VALUE_LADDER = [100, 84, 70, 58, 48, 40, 34] as const;
const LABEL_LADDER = [28, 25, 22, 20] as const;

/**
 * Both sides are pinned to an explicit, equal width. Left to `flex: 1`, Satori
 * sizes each box to its own content, so the two halves came out different
 * widths and the wider value wrapped while the other did not — a comparison has
 * to be visually symmetrical to be read as one.
 */
const DIVIDER_WIDTH = 90;
const BOX_PADDING = 40;
const BOX_WIDTH = (CONTENT_WIDTH - DIVIDER_WIDTH) / 2;
const BOX_TEXT_WIDTH = BOX_WIDTH - BOX_PADDING * 2;

export function Comparison(spec: ComparisonSpec) {
  const theme = { ...DEFAULTS, ...spec.theme };

  const headlineSize = fitFontSize(
    spec.headline,
    CONTENT_WIDTH,
    200,
    HEADLINE_LADDER,
    1.2,
    CHAR_WIDTH_RATIO.DISPLAY,
  );

  // Both sides are sized from the longer text so the two halves match: a
  // comparison whose values render at different sizes reads as a ranking.
  const longerValue = spec.leftValue.length >= spec.rightValue.length ? spec.leftValue : spec.rightValue;
  const longerLabel = spec.leftLabel.length >= spec.rightLabel.length ? spec.leftLabel : spec.rightLabel;
  const valueSize = fitSingleLine(longerValue, BOX_TEXT_WIDTH, VALUE_LADDER);
  const labelSize = fitFontSize(longerLabel, BOX_TEXT_WIDTH, 120, LABEL_LADDER, 1.3);

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
          fontSize: `${headlineSize}px`,
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
            width: `${BOX_WIDTH}px`,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: `${BOX_PADDING}px`,
            background: `rgba(99, 102, 241, 0.1)`,
            borderRadius: '24px',
          },
        },
        React.createElement(
          'div',
          {
            style: {
              fontSize: `${valueSize}px`,
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
              fontSize: `${labelSize}px`,
              color: theme.text,
              opacity: 0.7,
              textAlign: 'center',
              marginTop: '16px',
              lineHeight: 1.3,
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
            width: `${DIVIDER_WIDTH}px`,
            flexShrink: 0,
            display: 'flex',
            justifyContent: 'center',
          },
        },
        'vs',
      ),
      // Right
      React.createElement(
        'div',
        {
          style: {
            width: `${BOX_WIDTH}px`,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: `${BOX_PADDING}px`,
            background: `rgba(34, 211, 238, 0.1)`,
            borderRadius: '24px',
          },
        },
        React.createElement(
          'div',
          {
            style: {
              fontSize: `${valueSize}px`,
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
              fontSize: `${labelSize}px`,
              color: theme.text,
              opacity: 0.7,
              textAlign: 'center',
              marginTop: '16px',
              lineHeight: 1.3,
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

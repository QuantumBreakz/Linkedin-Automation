/**
 * KEY_FINDINGS template — up to 5 bullet findings on a dark background.
 *
 * Type size adapts to the content: five 200-character findings under a long
 * headline used to overflow the fixed canvas and collide with the headline, so
 * both the headline and the bullets are now sized to the space they actually
 * have (see ../layout.ts). The block is vertically centred between the top of
 * the card and the source line, so a card with two short findings reads as
 * composed rather than top-heavy.
 */

import type { VisualSpec } from '../visual-types';
import React from 'react';
import {
  CARD,
  CONTENT_WIDTH,
  CHAR_WIDTH_RATIO,
  estimateHeight,
  fitFontSize,
  fitFontSizeForItems,
} from '../layout';
import { DEFAULT_THEME, withAlpha } from '../palette';

type KeyFindingsSpec = Extract<VisualSpec, { template: 'KEY_FINDINGS' }>;


const HEADLINE_LADDER = [44, 40, 36, 32, 28] as const;
const FINDING_LADDER = [30, 27, 24, 22, 20, 18] as const;

/** Vertical space the source footer occupies, so content never runs into it. */
const FOOTER_RESERVE = 90;
/** Space between the headline and the first bullet. */
const HEADLINE_GAP = 48;
/** Bullet dot plus its gutter, subtracted from the text column. */
const BULLET_GUTTER = 32;

export function KeyFindings(spec: KeyFindingsSpec) {
  const theme = { ...DEFAULT_THEME, ...spec.theme };

  const available = CARD.HEIGHT - CARD.PADDING * 2 - FOOTER_RESERVE;
  const textWidth = CONTENT_WIDTH - BULLET_GUTTER;

  const headlineSize = fitFontSize(
    spec.headline,
    CONTENT_WIDTH,
    available * 0.32,
    HEADLINE_LADDER,
    1.2,
    CHAR_WIDTH_RATIO.DISPLAY,
  );
  const headlineHeight = estimateHeight(
    spec.headline,
    headlineSize,
    CONTENT_WIDTH,
    1.2,
    CHAR_WIDTH_RATIO.DISPLAY,
  );

  const findingSize = fitFontSizeForItems(
    spec.findings,
    textWidth,
    available - headlineHeight - HEADLINE_GAP,
    FINDING_LADDER,
    1.4,
    0.9,
  );

  const bulletSize = Math.max(10, Math.round(findingSize * 0.4));
  const rowGap = Math.round(findingSize * 0.9);

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: `linear-gradient(150deg, ${theme.background} 0%, ${theme.surface} 100%)`,
        padding: `${CARD.PADDING}px`,
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
    // Content block, vertically centred above the source line.
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'center',
        },
      },
      React.createElement(
        'div',
        {
          style: {
            fontSize: `${headlineSize}px`,
            fontWeight: 700,
            color: theme.text,
            lineHeight: 1.2,
            marginBottom: `${HEADLINE_GAP}px`,
          },
        },
        spec.headline,
      ),
      ...spec.findings.map((finding, i) =>
        React.createElement(
          'div',
          {
            key: i,
            style: {
              display: 'flex',
              alignItems: 'flex-start',
              gap: '20px',
              marginBottom: i === spec.findings.length - 1 ? '0px' : `${rowGap}px`,
            },
          },
          React.createElement('div', {
            style: {
              width: `${bulletSize}px`,
              height: `${bulletSize}px`,
              borderRadius: '50%',
              background: theme.accent,
              marginTop: `${Math.round(findingSize * 0.45)}px`,
              flexShrink: 0,
            },
          }),
          React.createElement(
            'div',
            {
              style: {
                fontSize: `${findingSize}px`,
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
    ),
    React.createElement(
      'div',
      {
        style: {
          fontSize: '22px',
          color: theme.text,
          opacity: 0.4,
          borderTop: `1px solid ${withAlpha(theme.text, 0.12)}`,
          paddingTop: '20px',
        },
      },
      spec.source,
    ),
  );
}

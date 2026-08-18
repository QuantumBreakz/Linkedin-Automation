/**
 * CONCEPT_EXPLAINER template — the paper's jargon, in plain language.
 *
 * Built from the extraction's `technicalTerms`, which pair a term with the
 * plain-language gloss the model already produced. Useful for a paper whose
 * value to a general audience is conceptual rather than numerical.
 */

import type { VisualSpec } from '../visual-types';
import React from 'react';
import { CARD, CONTENT_WIDTH, CHAR_WIDTH_RATIO, fitFontSize, fitFontSizeForItems } from '../layout';
import { DEFAULT_THEME, withAlpha } from '../palette';

type ConceptExplainerSpec = Extract<VisualSpec, { template: 'CONCEPT_EXPLAINER' }>;


const HEADLINE_LADDER = [42, 38, 34, 30, 27] as const;
const PLAIN_LADDER = [28, 25, 23, 21, 19] as const;

const FOOTER_RESERVE = 90;
const HEADLINE_GAP = 44;
const ROW_PADDING = 28;

export function ConceptExplainer(spec: ConceptExplainerSpec) {
  const theme = { ...DEFAULT_THEME, ...spec.theme };

  const available = CARD.HEIGHT - CARD.PADDING * 2 - FOOTER_RESERVE;
  const textWidth = CONTENT_WIDTH - ROW_PADDING * 2;

  const headlineSize = fitFontSize(
    spec.headline,
    CONTENT_WIDTH,
    available * 0.28,
    HEADLINE_LADDER,
    1.2,
    CHAR_WIDTH_RATIO.DISPLAY,
  );

  // Each row costs its gloss plus the term line and the row's own padding, so
  // the budget passed to the fitter is discounted accordingly.
  const rowChrome = 46 + ROW_PADDING * 2;
  const plainSize = fitFontSizeForItems(
    spec.terms.map((t) => t.plain),
    textWidth,
    available - headlineSize * 1.2 * 2 - HEADLINE_GAP - rowChrome * spec.terms.length,
    PLAIN_LADDER,
    1.45,
    1.1,
  );

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
    React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' } },
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
      ...spec.terms.map((entry, i) =>
        React.createElement(
          'div',
          {
            key: i,
            style: {
              display: 'flex',
              flexDirection: 'column',
              padding: `${ROW_PADDING}px`,
              marginBottom: i === spec.terms.length - 1 ? '0px' : '20px',
              background: withAlpha(theme.text, 0.05),
              borderRadius: '20px',
              borderLeft: `4px solid ${theme.series[i % theme.series.length]}`,
            },
          },
          React.createElement(
            'div',
            {
              style: {
                fontSize: '26px',
                fontWeight: 700,
                color: theme.series[i % theme.series.length],
                marginBottom: '10px',
              },
            },
            entry.term,
          ),
          React.createElement(
            'div',
            { style: { fontSize: `${plainSize}px`, color: theme.text, opacity: 0.85, lineHeight: 1.45 } },
            entry.plain,
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

/**
 * PROBLEM_SOLUTION template — the gap the paper names, then what it did.
 *
 * Two stacked panels with an arrow between them. Both panels are sized from the
 * longer of the two texts so they read as a matched pair rather than a ranking.
 */

import type { VisualSpec } from '../visual-types';
import React from 'react';
import { CARD, CONTENT_WIDTH, CHAR_WIDTH_RATIO, fitFontSize } from '../layout';
import { DEFAULT_THEME, withAlpha } from '../palette';

type ProblemSolutionSpec = Extract<VisualSpec, { template: 'PROBLEM_SOLUTION' }>;


const HEADLINE_LADDER = [42, 38, 34, 30, 27] as const;
const BODY_LADDER = [30, 27, 24, 22, 20] as const;

const PANEL_PADDING = 40;
const PANEL_TEXT_WIDTH = CONTENT_WIDTH - PANEL_PADDING * 2;

function panel(
  label: string,
  body: string,
  bodySize: number,
  labelColour: string,
  textColour: string,
  background: string,
) {
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: `${CONTENT_WIDTH}px`,
        padding: `${PANEL_PADDING}px`,
        background,
        borderRadius: '24px',
      },
    },
    React.createElement(
      'div',
      {
        style: {
          fontSize: '20px',
          fontWeight: 700,
          color: labelColour,
          letterSpacing: '2px',
          marginBottom: '14px',
        },
      },
      label,
    ),
    React.createElement(
      'div',
      { style: { fontSize: `${bodySize}px`, color: textColour, lineHeight: 1.4, opacity: 0.92 } },
      body,
    ),
  );
}

export function ProblemSolution(spec: ProblemSolutionSpec) {
  const theme = { ...DEFAULT_THEME, ...spec.theme };

  // A hue from the palette that contrasts its accent, so the two panels read
  // as opposed rather than as a pair.
  const problemColour = theme.series[theme.series.length - 1] ?? theme.primary;

  const headlineSize = fitFontSize(
    spec.headline,
    CONTENT_WIDTH,
    170,
    HEADLINE_LADDER,
    1.2,
    CHAR_WIDTH_RATIO.DISPLAY,
  );
  const longer = spec.problem.length >= spec.solution.length ? spec.problem : spec.solution;
  const bodySize = fitFontSize(longer, PANEL_TEXT_WIDTH, 230, BODY_LADDER, 1.4);

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
            marginBottom: '44px',
          },
        },
        spec.headline,
      ),
      panel(
        'THE PROBLEM',
        spec.problem,
        bodySize,
        problemColour,
        theme.text,
        withAlpha(problemColour, 0.12),
      ),
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'center',
            fontSize: '34px',
            color: theme.accent,
            opacity: 0.75,
            padding: '18px 0',
          },
        },
        '↓',
      ),
      panel(
        'WHAT THIS WORK DOES',
        spec.solution,
        bodySize,
        theme.accent,
        theme.text,
        withAlpha(theme.accent, 0.12),
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

// ESLint flat config.
//
// eslint-config-next v16 ships native flat-config arrays, so these are spread
// directly rather than wrapped in FlatCompat (which cannot serialise the
// plugin graph and crashes on it).

import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'dist/**',
      'coverage/**',
      'next-env.d.ts',
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Rule 3 of the build brief: no bare `any` without a justification.
      '@typescript-eslint/no-explicit-any': 'error',
      // Unused variables are usually a half-finished refactor; `_` opts out.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Swallowing an error is the failure mode this codebase cares most about.
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];

export default config;

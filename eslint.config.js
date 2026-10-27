import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'localStorage',
        'fetch',
        'navigator',
        'sessionStorage',
        'indexedDB',
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '../app-*',
            '../../adapters/*',
            '@cornerstonejs/*',
            'react*',
          ],
        },
      ],
    },
  },
  {
    files: ['packages/adapters/source-local/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'localStorage',
        'sessionStorage',
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '../../app-*',
            '@cornerstonejs/*',
            'react*',
          ],
        },
      ],
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.pnpm-store/**',
      '**/build/**',
    ],
  },
);

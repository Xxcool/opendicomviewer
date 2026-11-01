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
    /**
     * 解码适配器：允许第三方解码库（仅像素），
     * 但禁止任何 DICOM 解析库与网络/存储 API——解封装在 source-* 完成。
     */
    files: ['packages/adapters/codec-wasm/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'localStorage',
        'sessionStorage',
        'fetch',
        'indexedDB',
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '../../app-*',
            'dicom-parser',
            'react*',
            '@cornerstonejs/*',
          ],
        },
      ],
    },
  },
  {
    /**
     * 渲染适配器：允许 @cornerstonejs/*（这是它存在的理由），
     * 但仍禁止任何 DICOM 解析库（解析职责在 source-*）与任何网络/存储 API。
     */
    files: ['packages/adapters/renderer-cs3d/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'localStorage',
        'sessionStorage',
        'fetch',
        'indexedDB',
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '../../app-*',
            'dicom-parser',
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
      '**/src-tauri/target/**',
      '**/src-tauri/gen/**',
    ],
  },
);

import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const noTauri = { group: ['@tauri-apps/*'], message: 'Usa @suite/platform (ADR-0008).' };
const noNode = { group: ['node:*'], message: 'Este código corre en el navegador.' };
const noPdfjs = { group: ['pdfjs-dist', 'pdfjs-dist/*'], message: 'Solo src/engine importa pdfjs-dist (ADR-0007).' };
const noTesseract = { group: ['tesseract.js', 'tesseract.js/*'], message: 'Solo src/engine/ocr.ts importa tesseract.js (ADR-0038).' };
const noUi = { group: ['react', 'react-dom', 'react-dom/*', 'zustand'], message: 'core/ es lógica pura sin React (stack-typescript-react).' };

export default defineConfig(
  {
    ignores: ['**/node_modules/', '**/coverage/', '**/dist/', 'boveda/', 'ejemplos/', 'target/',
      '**/src-tauri/target/', '**/src-tauri/gen/', '**/public/pdfjs/', '**/public/ocr/', 'fixtures/pdf/generated/',
      '**/playwright-report/', '**/test-results/', 'apps/lector-pdf/dist-firma/', 'apps/lector-pdf/dist-pdf090/', 'apps/lector-pdf/dist-qa049/'],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description' }],
    },
  },
  { files: ['packages/shared/src/logger.ts'], rules: { 'no-console': 'off' } },
  { files: ['apps/**/*.{ts,tsx}', 'packages/platform/**/*.ts'], languageOptions: { globals: { ...globals.browser } } },
  { files: ['apps/**/*.{ts,tsx}'], ...reactHooks.configs.flat.recommended },
  { files: ['apps/*/src/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', { patterns: [noPdfjs, noTesseract, noTauri, noNode] }] } },
  { files: ['apps/*/src/engine/**/*.{ts,tsx}'], ignores: ['apps/*/src/engine/ocr.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [noTauri, noNode, noTesseract] }] } },
  { files: ['apps/*/src/engine/ocr.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [noTauri, noNode] }] } },
  { files: ['apps/*/src/core/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [noPdfjs, noTesseract, noTauri, noNode, noUi] }] } },
  { files: ['packages/platform/src/**/*.ts'], ignores: ['packages/platform/src/tauri/**'], rules: { 'no-restricted-imports': ['error', { patterns: [noTauri, noNode] }] } },
  { files: ['apps/*/tests/e2e/**/*.ts'], rules: { 'no-restricted-properties': ['error', { property: 'waitForTimeout', message: 'Espera a una condición (expect, page.clock o settle), no a un tiempo fijo.' }] } },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: { module: 'writable', require: 'readonly' } } },
  { files: ['**/*.mjs'], languageOptions: { globals: { ...globals.node } } },
);

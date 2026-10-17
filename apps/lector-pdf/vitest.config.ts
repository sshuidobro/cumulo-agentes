import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

export default defineProject({
  plugins: [react()],
  test: {
    name: 'lector-pdf',
    include: ['tests/unit/**/*.test.ts', 'tests/ui/**/*.test.tsx'],
    environment: 'node',
    setupFiles: ['tests/setup/setup.ts'],
    globalSetup: ['tests/setup/global-setup.ts'],
    alias: [{ find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' }],
  },
});

import { defineConfig } from 'vitest/config';

// Suite de rendimiento (ADR-0012): solo asserts de tiempo de reloj, sin cobertura y un fichero cada vez.
// Un proyecto por app/paquete con tests/perf/. Mantener alias y globalSetup iguales que en el vitest.config.ts de la app.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'lector-pdf-perf',
          root: './apps/lector-pdf',
          include: ['tests/perf/**/*.perf.test.ts'],
          environment: 'node',
          globalSetup: ['tests/setup/global-setup.ts'],
          alias: [{ find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' }],
          fileParallelism: false,
        },
      },
    ],
    fileParallelism: false,
    coverage: { enabled: false },
  },
});

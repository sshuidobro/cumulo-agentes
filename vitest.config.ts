import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
    coverage: {
      provider: 'v8',
      // Los patrones se resuelven contra la raíz del workspace (pnpm coverage) o contra la
      // del proyecto (vitest run --project X): por eso aparecen ambas formas.
      include: ['packages/*/src/**/*.ts', 'apps/*/src/core/**/*.ts', 'src/**/*.ts'],
      exclude: ['**/*.d.ts'],
      // Resumen JSON con todos los ficheros (el texto oculta los 100 % cubiertos).
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 80 },
    },
  },
});

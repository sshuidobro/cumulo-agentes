import { defineConfig, devices } from '@playwright/test';

// Puerto propio para no chocar con otras ejecuciones (p. ej. otra ficha en paralelo): LECTOR_E2E_PORT.
const port = Number(process.env.LECTOR_E2E_PORT ?? 4173);
// Directorio de build propio (LECTOR_E2E_OUTDIR) para no pisar el `dist` de otra ejecución en paralelo.
const outDir = process.env.LECTOR_E2E_OUTDIR ?? 'dist';
const baseURL = `http://localhost:${String(port)}`;

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 2,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, grepInvert: /@perf/ },
    // Pruebas de long tasks (ADR-0016): solas, en serie y después del resto, sin carga concurrente.
    {
      name: 'chromium-perf',
      use: { ...devices['Desktop Chrome'] },
      grep: /@perf/,
      workers: 1,
      fullyParallel: false,
      dependencies: ['chromium'],
    },
  ],
  webServer: {
    command: `pnpm assets && pnpm exec vite build --outDir ${outDir} && pnpm exec vite preview --outDir ${outDir} --port ${String(port)} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});

import { expect, test } from '@playwright/test';
import { fixture, pageNow, waitPageRendered } from './helpers.ts';

/** PDF-075: pdf.js se carga en un chunk diferido; abrir un PDF antes de que acabe la precarga debe funcionar. */
const PDFJS_CHUNK = '**/assets/pdf-*.js';
const CHUNK_DELAY_MS = 400;
const OPEN_BUDGET_MS = 1_000 + CHUNK_DELAY_MS;

test('abrir basic-5 con el chunk de pdf.js aún en vuelo (retraso de red de 400 ms) muestra la página 1 sin errores', { tag: '@perf' }, async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let chunkRequests = 0;
  await page.route(PDFJS_CHUNK, async (route) => {
    chunkRequests += 1;
    await new Promise<void>((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
    await route.continue();
  });
  await page.goto('/');
  const started = await pageNow(page);
  await page.locator('[data-testid=open-input]').setInputFiles(fixture('basic-5.pdf'));
  await waitPageRendered(page, 1);
  const elapsed = (await pageNow(page)) - started;
  testInfo.annotations.push({ type: 'abrir-con-precarga-en-vuelo-ms', description: elapsed.toFixed(0) });
  expect(elapsed).toBeLessThan(OPEN_BUDGET_MS);
  expect(chunkRequests, 'el chunk de pdf.js se pide una sola vez').toBe(1);
  expect(errors).toEqual([]);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('si el chunk de pdf.js no se puede descargar: mensaje en español, sin pantalla en blanco, y tras recargar la aplicación con red vuelve a funcionar', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(PDFJS_CHUNK, (route) => route.abort('failed'));
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(fixture('basic-5.pdf'));
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  const text = (await alert.textContent()) ?? '';
  expect(text.trim().length).toBeGreaterThan(0);
  expect(text).not.toMatch(/undefined|Exception|TypeError|Failed to fetch|dynamically imported/i);
  expect(errors).toEqual([]);

  // Chromium recuerda en el documento el fallo de un import() dinámico: la recuperación pasa por recargar.
  await page.unroute(PDFJS_CHUNK);
  await page.reload();
  await page.locator('[data-testid=open-input]').setInputFiles(fixture('basic-5.pdf'));
  await waitPageRendered(page, 1);
  await expect(alert).toHaveCount(0);
});

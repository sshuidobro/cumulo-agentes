import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { CORPUS_DIR, FIXTURES_DIR } from '../fixtures/paths.ts';
import { waitPageRendered, waitPageVisible } from './helpers.ts';

/**
 * Corpus real: cada PDF válido se abre, se dibuja su página 1, se va a la última y no aparece ningún error
 * en la consola ni excepción no capturada. Los dañados muestran su mensaje y la app sigue usable.
 * `corrupt-bad-startxref.pdf` no es rechazado: pdf.js reconstruye la xref y se abre (prueba aparte).
 */

/** PDF válidos del corpus público (`fixtures/pdf/corpus/`, ver fixtures/FUENTES.md). */
function corpusFiles(): string[] {
  return (readdirSync(CORPUS_DIR, { recursive: true }) as string[])
    .filter((entry) => entry.endsWith('.pdf'))
    .sort()
    .map((entry) => join(CORPUS_DIR, entry));
}

/** Fixtures generados válidos (los `corrupt-*` van aparte). */
const GENERATED_VALID = [
  'basic-5.pdf',
  'sizes-mixed.pdf',
  'outline.pdf',
  'links.pdf',
  'page-labels.pdf',
  'compressed.pdf',
  'incremental-updates.pdf',
  'annotated.pdf',
  'form.pdf',
  'pages-5000.pdf',
  'pages-20000-flat.pdf',
  'pages-100000.pdf',
  'images-200.pdf',
] as const;

/** Ficheros que la app rechaza con un mensaje (ver tests/unit/errors.test.ts y open.spec.ts). */
const REJECTED: readonly { readonly name: string; readonly message: string }[] = [
  { name: 'corrupt-empty.pdf', message: 'El fichero está vacío (0 bytes).' },
  { name: 'corrupt-not-pdf.pdf', message: 'Este fichero no es un PDF.' },
  { name: 'corrupt-truncated.pdf', message: 'El PDF está dañado y no se puede abrir.' },
];

/** Registra errores de consola (nivel `error`) y excepciones no capturadas de la página. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(`consola: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    errors.push(`excepción: ${error.message}`);
  });
  return errors;
}

async function openPath(page: Page, path: string): Promise<void> {
  await page.locator('[data-testid=open-input]').setInputFiles(path);
}

async function openAndWalk(page: Page, path: string, label: string): Promise<void> {
  const errors = collectErrors(page);
  await page.goto('/');
  await openPath(page, path);
  await expect(page.getByTestId('viewer'), label).toBeVisible();
  await waitPageRendered(page, 1);

  const total = await lastPageNumber(page);
  await page.keyboard.press('End');
  await waitPageVisible(page, total, total);
  await waitPageRendered(page, total);

  expect(errors, label).toEqual([]);
}

/** Número total de páginas, leído del recuento que muestra la app («5 páginas», «100.000 páginas»). */
async function lastPageNumber(page: Page): Promise<number> {
  const ready = page.getByTestId('document-ready');
  await expect(ready).toHaveText(/^[\d.]+ páginas?$/);
  const text = (await ready.textContent()) ?? '';
  return Number(/^([\d.]+)/.exec(text)?.[1]?.replace(/\./g, '') ?? '');
}

test.describe('corpus público: abrir, dibujar página 1, ir a la última y sin errores', () => {
  for (const path of corpusFiles()) {
    const label = relative(CORPUS_DIR, path);
    test(`corpus/${label}`, async ({ page }) => {
      await openAndWalk(page, path, label);
    });
  }
});

test.describe('fixtures generados válidos: abrir, dibujar página 1, ir a la última y sin errores', () => {
  for (const name of GENERATED_VALID) {
    test(`generated/${name}`, async ({ page }) => {
      await openAndWalk(page, join(FIXTURES_DIR, name), name);
    });
  }
});

test('corrupt-bad-startxref.pdf (startxref roto) se recupera: se abre con sus 5 páginas y la página 1 se dibuja', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await openPath(page, join(FIXTURES_DIR, 'corrupt-bad-startxref.pdf'));
  await expect(page.getByTestId('document-ready')).toHaveText('5 páginas');
  await waitPageRendered(page, 1);
  expect(errors).toEqual([]);
});

test('los ficheros dañados muestran su mensaje y la app sigue usable para abrir otro', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  for (const { name, message } of REJECTED) {
    await openPath(page, join(FIXTURES_DIR, name));
    await expect(page.getByRole('alert'), name).toContainText(message);
  }

  // Después de los fallos, un PDF válido se abre y se dibuja.
  await openPath(page, join(FIXTURES_DIR, 'basic-5.pdf'));
  await expect(page.getByTestId('document-ready')).toHaveText('5 páginas');
  await waitPageRendered(page, 1);
  expect(errors.filter((text) => text.startsWith('excepción'))).toEqual([]);
});

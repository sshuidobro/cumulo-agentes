import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { CORPUS_DIR } from '../fixtures/paths.ts';
import { clearLongTasks, fixture, installPerfProbes, longTasks, openFixture, recordMeasure } from './helpers.ts';
import { test as perfTest } from './perf-fixture.ts';
import { expectViewerReady } from './viewer-ready.ts';

/**
 * Propiedades del documento (PDF-045): Ctrl+D y «Más acciones» en la web, con fichero de prueba real.
 */

/** Fila de la lista de propiedades cuya etiqueta contiene `label`; devuelve su valor (dd). */
function valueRow(dialog: Locator, label: string): Locator {
  return dialog.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd[1]');
}

function propertiesDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Propiedades del documento' });
}

/** Versión de cabecera «%PDF-x.y» del fichero, leída del propio fichero. */
function pdfHeaderVersion(path: string): string {
  const head = readFileSync(path).subarray(0, 1024).toString('latin1');
  const match = /%PDF-(\d\.\d)/.exec(head);
  if (match?.[1] === undefined) throw new Error(`Sin cabecera %PDF en ${path}`);
  return match[1];
}

/** Errores de página (excepciones y consola) durante la prueba, para asegurar que el diálogo no rompe nada. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function openWithCtrlD(page: Page): Promise<Locator> {
  await page.getByTestId('viewer').focus();
  await page.keyboard.press('Control+d');
  const dialog = propertiesDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

test('Ctrl+D abre el diálogo con el foco dentro; Páginas, Versión PDF y Cifrado; Esc cierra y devuelve el foco al visor', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  const dialog = await openWithCtrlD(page);
  await expect(dialog.getByRole('tab', { name: 'Descripción' })).toBeFocused();

  await dialog.getByRole('tab', { name: 'Avanzado' }).click();
  await expect(valueRow(dialog, 'Páginas')).toHaveText('5');
  await expect(valueRow(dialog, 'Versión PDF')).toHaveText(pdfHeaderVersion(fixture('basic-5.pdf')));
  await expect(valueRow(dialog, 'Cifrado')).toHaveText('No');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('viewer')).toBeFocused();
});

test('el atajo Ctrl+D se consume (no llega al navegador como marcador)', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await page.getByTestId('viewer').focus();
  const prevented = await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(propertiesDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
});

test('veraPDF 7.18.4-t01-pass-a: título, autor, productor, fecha, vista web rápida, formulario y etiquetado', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(join(CORPUS_DIR, 'verapdf', '7.18.4-t01-pass-a.pdf'));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);

  const dialog = await openWithCtrlD(page);
  await expect(valueRow(dialog, 'Título')).toHaveText('Widget-pass');
  await expect(valueRow(dialog, 'Autor')).toHaveText('veraPDF Consortium');
  await expect(valueRow(dialog, 'Productor')).toHaveText('veraPDF Test Builder 1.0');
  await expect(valueRow(dialog, 'Creado')).toContainText('4 de enero de 2020');

  await dialog.getByRole('tab', { name: 'Avanzado' }).click();
  await expect(valueRow(dialog, 'PDF etiquetado')).toHaveText('Sí');
  await expect(valueRow(dialog, 'Vista web rápida')).toHaveText('Sí');
  await expect(valueRow(dialog, 'Formulario')).toHaveText('Sí');
});

for (const name of ['incremental-updates.pdf', 'compressed.pdf']) {
  test(`${name}: el diálogo abre sin errores y el número de páginas coincide con el visor`, async ({ page }) => {
    const errors = collectErrors(page);
    await openFixture(page, name);
    const shown = await page.getByTestId('document-ready').textContent();
    const pages = /^([\d.]+) página/.exec(shown ?? '')?.[1]?.replace(/\./g, '');
    expect(pages).toBeDefined();

    const dialog = await openWithCtrlD(page);
    await expect(dialog.getByText('Leyendo propiedades…')).toBeHidden();
    await dialog.getByRole('tab', { name: 'Avanzado' }).click();
    await expect(valueRow(dialog, 'Páginas')).toHaveText(pages ?? '');
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });
}

test('menú «Más acciones»: deshabilitado sin documento; con documento, abre las propiedades', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Más acciones' })).toBeDisabled();

  await openFixture(page, 'basic-5.pdf');
  await page.getByRole('button', { name: 'Más acciones' }).click();
  await page.getByRole('menuitem', { name: 'Propiedades del documento…' }).click();
  await expect(propertiesDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Más acciones' })).toBeFocused();
});

/** Axe sobre la página con el diálogo abierto: ninguna violación de impacto «serious» o «critical». */
async function expectNoSeriousViolations(page: Page, testInfo: TestInfo): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  testInfo.annotations.push({
    type: 'axe',
    description: `${String(results.violations.length)} violaciones en total, ${String(serious.length)} serious/critical`,
  });
  expect(serious.map((v) => `${v.impact ?? '?'} ${v.id}: ${v.help}`)).toEqual([]);
}

test('axe: diálogo de propiedades sin incidencias serious ni critical (tema claro)', async ({ page }, testInfo) => {
  await openFixture(page, 'basic-5.pdf');
  const dialog = await openWithCtrlD(page);
  await expect(valueRow(dialog, 'Fichero')).toHaveText('basic-5.pdf');
  await expectNoSeriousViolations(page, testInfo);
});

test.describe('tema oscuro', () => {
  test.use({ colorScheme: 'dark' });

  test('axe: diálogo de propiedades sin incidencias serious ni critical (tema oscuro)', async ({ page }, testInfo) => {
    await openFixture(page, 'basic-5.pdf');
    // Con el tema «Sistema» (por defecto) la app sigue al navegador, que aquí está en oscuro.
    expect(await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
    const dialog = await openWithCtrlD(page);
    await expect(valueRow(dialog, 'Fichero')).toHaveText('basic-5.pdf');
    await expectNoSeriousViolations(page, testInfo);
  });
});


test('teclado: pestañas con ←/→ y menú «Más acciones» con flechas e Intro; Esc devuelve el foco', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  const more = page.getByRole('button', { name: 'Más acciones' });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: /Propiedades del documento/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: /Propiedades del documento/ })).toBeVisible();
  await page.keyboard.press('Enter');

  const dialog = propertiesDialog(page);
  await expect(dialog).toBeVisible();
  const first = dialog.getByRole('tab', { name: 'Descripción' });
  const second = dialog.getByRole('tab', { name: 'Avanzado' });
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect(valueRow(dialog, 'Páginas')).toHaveText('5');
  await page.keyboard.press('ArrowLeft');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  // Tab no escapa del diálogo (el foco queda atrapado).
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('[role=dialog]') !== null)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('los PDF corruptos no permiten abrir las propiedades y no rompen la app', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(fixture('corrupt-truncated.pdf'));
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('dialog', { name: 'Propiedades del documento' })).toBeHidden();
  await expect(page.locator('body')).not.toBeEmpty();
  expect(errors.filter((e) => /TypeError|ReferenceError/.test(e))).toEqual([]);
});

/** Pestaña «Fuentes» (PDF-088): la tabla, con sus cabeceras, dentro del diálogo abierto. */
async function openFontsTab(dialog: Locator): Promise<Locator> {
  await dialog.getByRole('tab', { name: 'Fuentes' }).click();
  const table = dialog.getByRole('table');
  await expect(dialog.getByRole('status')).toBeHidden({ timeout: 30_000 });
  await expect(table).toBeVisible();
  return table;
}

test('pestaña «Fuentes» con basic-5.pdf: una fuente Helvetica, Type1, WinAnsiEncoding y no incrustada', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  const dialog = await openWithCtrlD(page);
  const table = await openFontsTab(dialog);
  await expect(table.getByRole('columnheader')).toHaveText(['Nombre', 'Tipo', 'Codificación', 'Incrustada']);
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table.getByRole('row').nth(1).getByRole('cell')).toHaveText(['Helvetica', 'Type1', 'WinAnsiEncoding', 'No']);
});

test('pestaña «Fuentes» con libreoffice/multilingue.pdf: TrueType incrustadas en subconjunto y sin prefijo «XXXXXX+»', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(join(CORPUS_DIR, 'libreoffice', 'multilingue.pdf'));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
  const dialog = await openWithCtrlD(page);
  const table = await openFontsTab(dialog);
  const rows = table.locator('tbody tr');
  expect(await rows.count()).toBeGreaterThan(1);
  for (let i = 0; i < (await rows.count()); i += 1) {
    const cells = await rows.nth(i).getByRole('cell').allTextContents();
    expect(cells[0]).not.toMatch(/^[A-Z]{6}\+/);
    expect(cells[1]).toBe('TrueType');
    expect(cells[3]).toBe('Sí, subconjunto');
  }
});

test('pestaña «Fuentes»: Esc cierra el diálogo y, al volver a abrirlo, la pestaña vuelve a leer el documento', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  const dialog = await openWithCtrlD(page);
  await openFontsTab(dialog);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const again = await openWithCtrlD(page);
  await openFontsTab(again);
  await expect(again.getByRole('row').nth(1).getByRole('cell').first()).toHaveText('Helvetica');
});

test('axe: pestaña «Fuentes» sin incidencias serious ni critical', async ({ page }, testInfo) => {
  await openFixture(page, 'basic-5.pdf');
  const dialog = await openWithCtrlD(page);
  await openFontsTab(dialog);
  await expectNoSeriousViolations(page, testInfo);
});

perfTest('pages-100000.pdf: el escaneo de fuentes no tiene long tasks > 100 ms y «Detener» lo para en < 200 ms', { tag: '@perf' }, async ({ page }, testInfo) => {
  await installPerfProbes(page);
  await openFixture(page, 'pages-100000.pdf');
  const dialog = await openWithCtrlD(page);
  await clearLongTasks(page);
  await dialog.getByRole('tab', { name: 'Fuentes' }).click();
  // Esperamos a que haya progreso visible y a que la barra siga escaneando; luego se pulsa «Detener».
  await expect(dialog.getByRole('status')).toContainText('de 100.000 páginas');
  const stop = dialog.getByRole('button', { name: 'Detener' });
  const clicked = Date.now();
  await stop.click();
  await expect(dialog.getByText(/Búsqueda detenida/)).toBeVisible();
  const stopMs = Date.now() - clicked;
  recordMeasure(testInfo, `«Detener» hasta ver «Búsqueda detenida»: ${stopMs.toFixed(0)} ms (presupuesto < 200 ms)`);
  expect(stopMs).toBeLessThan(200);

  const tasks = await longTasks(page);
  recordMeasure(testInfo, `long tasks durante el escaneo: ${String(tasks.length)}, máxima ${Math.max(0, ...tasks).toFixed(0)} ms`);
  expect(tasks.filter((d) => d > 100)).toEqual([]);
});

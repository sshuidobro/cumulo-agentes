import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test } from './perf-fixture.ts';
import { compareMsg } from '../../src/ui/messages-compare.ts';
import { propertiesMsg } from '../../src/ui/messages-properties.ts';
import { clearLongTasks, fixture, installPerfProbes, longTasks, openFixture } from './helpers.ts';

/*
 * Comparar con otro PDF (PDF-112). El selector de la plataforma web se fuerza a su variante de `<input type="file">`
 * (sin File System Access), así el segundo PDF se elige con un selector de ficheros real de Playwright.
 */

const DIALOG = { name: /^Comparar «/ };

/** Quita el selector de File System Access antes de cargar la app: la plataforma usa el `<input>`. */
async function useInputPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
  });
}

/** Desde «Más acciones», elige `name` como segundo PDF. */
async function compareWith(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: propertiesMsg.moreActions, exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: compareMsg.menuItem, exact: true }).click();
  await (await chooser).setFiles(fixture(name));
}

test.describe('Comparar con otro PDF (PDF-112)', () => {
  test.beforeEach(async ({ page }) => {
    await useInputPicker(page);
  });

  test('basic-5 contra basic-5-changed: «1 cambio en 1 página» y la fila de la página 2', async ({ page }) => {
    await openFixture(page, 'basic-5.pdf');
    await compareWith(page, 'basic-5-changed.pdf');

    const dialog = page.getByRole('dialog', DIALOG);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('1 cambio en 1 página', { exact: true })).toBeVisible();
    const rows = dialog.getByRole('option');
    await expect(rows).toHaveCount(1);
    await expect(rows).toHaveText('Página 2 · Se ha cambiado “página” por “hoja”.');

    const violations = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    const serious = violations.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => v.id)).toEqual([]);
  });

  test('basic-5 consigo mismo: «No hay diferencias de texto entre los dos documentos.»', async ({ page }) => {
    await openFixture(page, 'basic-5.pdf');
    await compareWith(page, 'basic-5.pdf');

    const dialog = page.getByRole('dialog', DIALOG);
    await expect(dialog.getByText(compareMsg.noChanges, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('option')).toHaveCount(0);
  });

  test('con el teclado: flechas y Intro en la lista; Escape cierra y devuelve el foco al visor', async ({ page }) => {
    await openFixture(page, 'basic-5.pdf');
    await compareWith(page, 'basic-5-changed.pdf');

    const list = page.getByRole('listbox', { name: compareMsg.listLabel });
    await expect(list).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('option', { name: /Página 2/ })).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', DIALOG)).toBeHidden();
    await expect(page.getByTestId('viewer')).toBeFocused();
  });

  test('@perf pages-5000 contra sí mismo: progreso, Cancelar en < 500 ms y sin long tasks > 100 ms', { tag: '@perf' }, async ({ page }) => {
    await installPerfProbes(page);
    await openFixture(page, 'pages-5000.pdf');
    await clearLongTasks(page);
    await compareWith(page, 'pages-5000.pdf');

    const dialog = page.getByRole('dialog', DIALOG);
    await expect(dialog.getByText(/^Comparando página/)).toBeVisible();

    const started = Date.now();
    await dialog.getByRole('button', { name: compareMsg.cancel, exact: true }).click();
    await expect(dialog.getByText(/^Comparación cancelada/)).toBeVisible();
    expect(Date.now() - started, 'Cancelar detiene la comparación en menos de 500 ms').toBeLessThan(500);

    const slowest = Math.max(0, ...(await longTasks(page)));
    expect(slowest, 'ninguna long task > 100 ms durante la comparación').toBeLessThan(100);
  });
});

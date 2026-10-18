import { expect, test, type Page } from '@playwright/test';
import { frameSize, goToPageByKeyboard, openFixture, pageField, waitPageRendered, waitPageVisible } from './helpers.ts';

/**
 * Flujo completo solo con teclado sobre outline.pdf (30 páginas, con marcadores y el destino «Anexo» en la página 30).
 * Ningún paso usa el ratón; tras cada paso se comprueba el estado de la app.
 */

const TOTAL = 30;
const VIEWER = '[data-testid="viewer"]';
const TREE = '[role="tree"]';
const OUTLINE_TAB = '#sidebar-tab-outline';

/** Pulsa `key` hasta que el elemento activo cumpla `selector` (máximo `max` pulsaciones). */
async function keyUntilFocused(page: Page, key: string, selector: string, max = 60): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await isFocused(page, selector)) return;
    await page.keyboard.press(key);
  }
  expect(await isFocused(page, selector), `foco en ${selector} tras ${String(max)} pulsaciones de ${key}`).toBe(true);
}

async function isFocused(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, selector);
}

/** Texto del elemento al que apunta `aria-activedescendant` del árbol de marcadores. */
async function activeBookmarkTitle(page: Page): Promise<string> {
  return page.evaluate((sel) => {
    const tree = document.querySelector(sel);
    const id = tree?.getAttribute('aria-activedescendant');
    return id === null || id === undefined ? '' : (document.getElementById(id)?.textContent ?? '');
  }, TREE);
}

async function scrollTopOf(page: Page): Promise<number> {
  return page.getByTestId('viewer').evaluate((el) => el.scrollTop);
}

function isLandscape(size: { readonly width: number; readonly height: number }): boolean {
  return size.width > size.height;
}

async function zoomValue(page: Page): Promise<string> {
  return page.getByRole('textbox', { name: 'Zoom' }).inputValue();
}

test('outline.pdf: flujo completo de lectura solo con teclado', async ({ page }) => {
  await openFixture(page, 'outline.pdf');
  await waitPageRendered(page, 1);
  await expect(pageField(page)).toHaveValue('1');

  // Tab hasta el visor (el foco parte del cuerpo de la página, no del visor).
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await keyUntilFocused(page, 'Tab', VIEWER);

  // Av Pág: el visor se desplaza hacia abajo.
  const scrolled = await scrollTopOf(page);
  await page.keyboard.press('PageDown');
  await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(scrolled);

  // Ctrl+Mayús+N, 12 e Intro: ir a la página 12.
  await goToPageByKeyboard(page, 12, TOTAL);
  await expect(pageField(page)).toHaveValue('12');
  // El campo de página retiene el foco; los atajos de vista (F4 incluido) solo actúan desde el visor: Tab hasta él.
  await keyUntilFocused(page, 'Tab', VIEWER);

  // F4: abre el panel lateral.
  await page.keyboard.press('F4');
  await expect(page.getByRole('complementary', { name: 'Panel lateral' })).toBeVisible();

  // Foco a la lista de pestañas (Mayús+Tab desde el visor) y flechas hasta «Marcadores».
  await keyUntilFocused(page, 'Shift+Tab', '[role="tab"]');
  for (let i = 0; i < 3 && !(await isSelectedTab(page)); i++) {
    await page.keyboard.press('ArrowRight');
  }
  await expect(page.locator(OUTLINE_TAB)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(OUTLINE_TAB)).toBeFocused();

  // Tab al árbol de marcadores y flechas abajo hasta «Anexo».
  await keyUntilFocused(page, 'Tab', TREE, 10);
  for (let i = 0; i < 20 && (await activeBookmarkTitle(page)) !== 'Anexo'; i++) {
    await page.keyboard.press('ArrowDown');
  }
  expect(await activeBookmarkTitle(page)).toBe('Anexo');

  // Intro activa «Anexo»: va a su destino, la página 30.
  await page.keyboard.press('Enter');
  await waitPageVisible(page, TOTAL, TOTAL);
  await expect(pageField(page)).toHaveValue(String(TOTAL));

  // Alt+Flecha izquierda: vuelve a la vista anterior (página 12).
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(pageField(page)).toHaveValue('12');

  // Ctrl+F, «Página 7» e Intro: la coincidencia está en la página 7.
  await page.keyboard.press('Control+f');
  const search = page.getByRole('searchbox', { name: 'Buscar en el documento' });
  await expect(search).toBeFocused();
  await search.fill('Página 7');
  await search.press('Enter');
  await expect(pageField(page)).toHaveValue('7');
  await expect(page.getByRole('search').getByText('1 de 1', { exact: true })).toBeVisible();

  // Los atajos de vista no actúan dentro del campo de búsqueda: Mayús+Tab devuelve el foco al visor.
  await keyUntilFocused(page, 'Shift+Tab', VIEWER, 5);

  // Ctrl++: amplía el zoom.
  const zoomBefore = await zoomValue(page);
  await page.keyboard.press('Control+=');
  await expect.poll(() => zoomValue(page)).not.toBe(zoomBefore);

  // Ctrl+0: ajustar a la página.
  await page.keyboard.press('Control+0');
  await expect(page.getByRole('combobox', { name: 'Ajuste de zoom' })).toHaveValue('fit-page');

  // Ctrl+Mayús+→: gira la vista a la derecha; la página 7 pasa de vertical a horizontal.
  expect(isLandscape(await frameSize(page, 7))).toBe(false);
  await page.keyboard.press('Control+Shift+ArrowRight');
  await expect.poll(async () => isLandscape(await frameSize(page, 7))).toBe(true);

  // Esc cierra la búsqueda (hay que enfocarla de nuevo con Ctrl+F).
  await page.keyboard.press('Control+f');
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('search')).toHaveCount(0);
  await expect(page.getByTestId('viewer')).toBeFocused();
  await expect(pageField(page)).toHaveValue('7');
});

async function isSelectedTab(page: Page): Promise<boolean> {
  return page.locator(OUTLINE_TAB).getAttribute('aria-selected').then((value) => value === 'true');
}

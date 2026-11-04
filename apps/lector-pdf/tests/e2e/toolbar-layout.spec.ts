import { expect, test, type Page } from '@playwright/test';
import { openFixture } from './helpers.ts';

/** Controles de la barra que se salen de la ventana por la derecha, y ancho total de la página. */
function overflow(page: Page): Promise<{ readonly outside: readonly string[]; readonly pageWidth: number }> {
  return page.evaluate(() => ({
    outside: [...document.querySelectorAll('[role=toolbar] button, [role=toolbar] input, [role=toolbar] select')]
      .filter((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().right > innerWidth + 0.5)
      .map((el) => el.getAttribute('aria-label') ?? el.tagName),
    pageWidth: document.documentElement.scrollWidth,
  }));
}

function pressedButtons(page: Page): Promise<readonly (string | null)[]> {
  return page.evaluate(() => [...document.querySelectorAll('[role=toolbar] [aria-pressed=true]')].map((el) => el.getAttribute('aria-label')));
}

test.describe('barra y menús en cualquier tamaño de ventana', () => {
  for (const width of [1400, 1000, 700, 420]) {
    test(`a ${String(width)} px no se sale ningún control ni la página se desplaza en horizontal`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await openFixture(page, 'basic-5.pdf');
      const { outside, pageWidth } = await overflow(page);
      expect(outside).toEqual([]);
      expect(pageWidth).toBeLessThanOrEqual(width);
    });
  }

  for (const size of [{ width: 1400, height: 500 }, { width: 700, height: 400 }]) {
    test(`a ${String(size.width)}×${String(size.height)} los menús caben en la ventana`, async ({ page }) => {
      await page.setViewportSize(size);
      await openFixture(page, 'basic-5.pdf');
      for (const name of ['Vista', 'Apariencia', 'Más acciones']) {
        await page.getByRole('button', { name, exact: true }).click();
        const box = await page.getByRole('menu', { name }).boundingBox();
        expect(box).not.toBeNull();
        if (box === null) continue;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(size.width);
        expect(box.y + box.height).toBeLessThanOrEqual(size.height);
        await page.keyboard.press('Escape');
      }
    });
  }
});

test('solo hay una herramienta marcada: elegir otra desmarca la anterior', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await page.getByRole('button', { name: 'Comentar', exact: true }).click();
  await page.getByRole('button', { name: 'Resaltar', exact: true }).click();
  expect(await pressedButtons(page)).toEqual(['Comentar', 'Resaltar']);

  await page.getByRole('button', { name: 'Herramienta mano', exact: true }).click();
  expect(await pressedButtons(page)).toEqual(['Herramienta mano', 'Comentar']);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-tool', 'hand');

  await page.getByRole('button', { name: 'Dibujar', exact: true }).click();
  expect(await pressedButtons(page)).toEqual(['Comentar', 'Dibujar']);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-tool', 'ink');

  await page.getByRole('button', { name: 'Herramienta de selección', exact: true }).click();
  expect(await pressedButtons(page)).toEqual(['Herramienta de selección', 'Comentar']);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-tool', 'select');
});

test('en el modo noche la selección usa su color propio, no el del sistema', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await page.getByRole('button', { name: 'Apariencia', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /noche/i }).click();
  const span = page.locator('[data-page-index="0"] .textLayer span').first();
  await span.waitFor();
  const style = await span.evaluate((el) => {
    const selection = getComputedStyle(el, '::selection');
    return { background: selection.backgroundColor, color: selection.color };
  });
  expect(style).toEqual({ background: 'rgba(60, 120, 216, 0.35)', color: 'rgba(0, 0, 0, 0)' });
});

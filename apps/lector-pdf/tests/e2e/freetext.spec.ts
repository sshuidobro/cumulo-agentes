import { expect, test, type Locator, type Page } from '@playwright/test';
import { openFixture, pageFrame, waitPageRendered } from './helpers.ts';

/** Capa de anotaciones de la página 1 (el `svg` de `AnnotationLayer`; su clase CSS lleva un sufijo de módulo). */
function annotationLayer(page: Page): Locator {
  return pageFrame(page, 1).locator('svg[class*="annotationLayer"]');
}

/** Cuadro de texto libre en edición. */
function editor(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Texto del cuadro' });
}

/** Activa la herramienta «Texto» de la barra Comentar (la abre si está cerrada). */
async function pickTextTool(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Comentar' }).click();
  const bar = page.getByRole('toolbar', { name: 'Comentar' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Texto', exact: true }).click();
}

/** Fija el zoom escribiendo en el campo de zoom de la barra. */
async function setZoom(page: Page, value: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Zoom' });
  await input.fill(value);
  await input.press('Enter');
  await expect(input).toHaveValue(`${value} %`);
}

test('crear «Texto de prueba áéí €» a 14 pt y confirmar con Esc: el texto se ve en la página y no queda editor', async ({
  page,
}) => {
  await openFixture(page, 'basic-5.pdf');
  await waitPageRendered(page, 1);
  await pickTextTool(page);
  await page.getByRole('button', { name: 'Tamaño de letra' }).click();
  await page.getByRole('menuitemradio', { name: '14 pt' }).click();

  await pageFrame(page, 1).click({ position: { x: 150, y: 150 } });
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('Texto de prueba áéí €');
  await page.keyboard.press('Escape');

  await expect(editor(page)).toHaveCount(0);
  await expect(annotationLayer(page).locator('text', { hasText: 'Texto de prueba áéí €' })).toHaveCount(1);
  await expect(annotationLayer(page).locator('text', { hasText: 'Texto de prueba áéí €' })).toHaveAttribute('font-size', '14');
});

test('con zoom 200 % el editor coincide con el cuadro: 200 pt × alto de una línea, en el punto del clic', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await waitPageRendered(page, 1);
  await setZoom(page, '200');
  await waitPageRendered(page, 1);
  await pickTextTool(page);

  const click = { x: 150, y: 150 };
  await pageFrame(page, 1).click({ position: click });
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('Hola');
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);

  // La matriz de la capa es `matrix(escala 0 0 -escala 0 alto)`: la escala en píxeles CSS por punto PDF.
  // 200 % a 96 dpi (1 pt = 4/3 px CSS): escala = 2 × 4/3.
  const transform = await annotationLayer(page).locator('g').first().getAttribute('transform');
  const scale = Number(/matrix\(([\d.]+)/.exec(transform ?? '')?.[1] ?? NaN);
  expect(scale).toBeCloseTo((2 * 4) / 3, 5);

  // Reabrir con doble clic sobre el cuadro: el editor ocupa exactamente el cuadro a esa escala.
  await annotationLayer(page).locator('[role="button"]').first().dblclick();
  await expect(editor(page)).toBeFocused();
  const layer = await annotationLayer(page).boundingBox();
  const box = await editor(page).boundingBox();
  expect(layer).not.toBeNull();
  expect(box).not.toBeNull();
  if (layer === null || box === null) return;
  // Esquina superior izquierda en el punto del clic; tamaño = 200 pt × (1,15 × 12 + 4) pt, a la escala.
  expect(Math.abs(box.x - (layer.x + click.x))).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y - (layer.y + click.y))).toBeLessThanOrEqual(2);
  expect(Math.abs(box.width - 200 * scale)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.height - (1.15 * 12 + 4) * scale)).toBeLessThanOrEqual(2);
});

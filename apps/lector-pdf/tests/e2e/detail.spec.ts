import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { canvasCount, clearLongTasks, installPerfProbes, longTasks, settle } from './helpers.ts';
import { expectViewerReady } from './viewer-ready.ts';

/** Presupuesto de memoria de lienzos y de lienzos vivos (ADR-0025, PDF-051). */
const MAX_CANVAS_MB = 300;
const MAX_LIVE_CANVASES_PER_PAGE = 13;

/** Páginas montadas que cruzan el visor. */
function visiblePageCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const viewer = document.querySelector('[data-testid=viewer]');
    if (viewer === null) return 0;
    const v = viewer.getBoundingClientRect();
    return Array.from(document.querySelectorAll('[data-page-index]')).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > v.top && r.top < v.bottom && r.right > v.left && r.left < v.right;
    }).length;
  });
}

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(join(FIXTURES_DIR, 'basic-5.pdf'));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
  await expect(page.locator('[data-page-index="0"][data-rendered="true"]')).toBeVisible();
}

async function setZoom(page: Page, percent: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Zoom' });
  await input.fill(percent);
  await input.press('Enter');
}

/** Lienzo de detalle de la primera página, si existe. */
function detailHost(page: Page): Locator {
  return page.locator('[data-page-index="0"] [data-detail]');
}

/**
 * Varianza del laplaciano en escala de grises de la captura de `locator` (PNG en base64). Mide la nitidez: un
 * texto borroso tiene poca varianza y uno nítido mucha. Se calcula en el navegador con un canvas auxiliar.
 */
async function sharpness(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('sin contexto 2d');
    ctx.drawImage(bitmap, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const gray = new Float64Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      const o = i * 4;
      gray[i] = 0.299 * (data[o] ?? 0) + 0.587 * (data[o + 1] ?? 0) + 0.114 * (data[o + 2] ?? 0);
    }
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const c = y * width + x;
        const lap =
          4 * (gray[c] ?? 0) - (gray[c - 1] ?? 0) - (gray[c + 1] ?? 0) - (gray[c - width] ?? 0) - (gray[c + width] ?? 0);
        sum += lap;
        sumSq += lap * lap;
        n++;
      }
    }
    const mean = sum / n;
    return sumSq / n - mean * mean;
  }, png.toString('base64'));
}

/** Lleva la vista a un texto de la primera página (su capa de texto) y espera a que el detalle la cubra. */
async function goToText(page: Page): Promise<void> {
  await page.locator('[data-page-index="0"] .textLayer span').first().scrollIntoViewIfNeeded();
  await expectDetailCovers(page);
}

/** Espera a que el detalle cubra el visor entero: el dibujo de 150 ms y el render ya han terminado. */
async function expectDetailCovers(page: Page): Promise<void> {
  await expect.poll(() => coversViewer(page), { timeout: 5000 }).toBe(true);
}

/** Comprueba que el contenedor de detalle cubre la parte visible de la página (visor ∩ marco). */
async function coversViewer(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-page-index="0"] [data-detail]');
    const frame = document.querySelector('[data-page-index="0"]');
    const viewer = document.querySelector('[data-testid=viewer]');
    if (host === null || frame === null || viewer === null) return false;
    const h = host.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    const v = viewer.getBoundingClientRect();
    // Lo que se ve de la página: el visor recortado por el marco (el margen gris no lleva contenido).
    const left = Math.max(v.left, f.left);
    const top = Math.max(v.top, f.top);
    const right = Math.min(v.right, f.right);
    const bottom = Math.min(v.bottom, f.bottom);
    if (right <= left || bottom <= top) return false;
    return h.left <= left && h.top <= top && h.right >= right && h.bottom >= bottom;
  });
}

test('a 3 200 % hay exactamente un lienzo de detalle en la página visible, a densidad completa', async ({ page }) => {
  await open(page);
  await setZoom(page, '3200');
  await goToText(page);
  await expect(detailHost(page)).toHaveCount(1);

  const sizes = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('[data-page-index="0"] [data-detail]');
    const canvas = host?.querySelector('canvas');
    if (host === null || canvas === null || canvas === undefined) return null;
    const rect = host.getBoundingClientRect();
    return { canvasWidth: canvas.width, canvasHeight: canvas.height, rectWidth: rect.width, rectHeight: rect.height };
  });
  expect(sizes).not.toBeNull();
  if (sizes === null) return;
  expect(Math.abs(sizes.canvasWidth - Math.floor(sizes.rectWidth))).toBeLessThanOrEqual(1);
  expect(Math.abs(sizes.canvasHeight - Math.floor(sizes.rectHeight))).toBeLessThanOrEqual(1);
});

test('el detalle es más nítido que el lienzo base estirado', async ({ page }) => {
  await open(page);
  await setZoom(page, '3200');
  await goToText(page);

  const viewer = page.getByTestId('viewer');
  const withDetail = await sharpness(page, await viewer.screenshot());
  await page.addStyleTag({ content: '[data-detail]{visibility:hidden !important}' });
  const withoutDetail = await sharpness(page, await viewer.screenshot());
  expect(withDetail).toBeGreaterThanOrEqual(3 * withoutDetail);
});

test('a 3 200 % la zona visible se ve igual que en la referencia', async ({ page }) => {
  await open(page);
  await setZoom(page, '3200');
  await goToText(page);
  await expect(page.getByTestId('viewer')).toHaveScreenshot('detalle-3200.png', { maxDiffPixelRatio: 0.01 });
});

test('al desplazarse 2 000 px el detalle cubre la nueva zona visible y nunca queda blanco sobre el texto', async ({
  page,
}) => {
  await open(page);
  await setZoom(page, '3200');
  await goToText(page);

  await page.getByTestId('viewer').hover();
  await page.mouse.wheel(0, 2000);
  // Durante el desplazamiento la base sigue debajo: hay píxeles oscuros (el texto) en la zona visible.
  const during = await page.getByTestId('viewer').screenshot();
  expect(await darkPixelCount(page, during)).toBeGreaterThan(0);

  await expect.poll(() => coversViewer(page), { timeout: 3000 }).toBe(true);
});

test('volver a 100 % quita todos los lienzos de detalle', async ({ page }) => {
  await open(page);
  await setZoom(page, '3200');
  await expect(detailHost(page)).toHaveCount(1, { timeout: 3000 });
  await setZoom(page, '100');
  await expect(page.locator('[data-detail]')).toHaveCount(0);
});

test('con modo noche a 3 200 % el detalle también sale invertido', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Apariencia' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Modo noche de las páginas' }).click();
  await page.keyboard.press('Escape');
  await setZoom(page, '3200');
  await goToText(page);

  const luminance = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-page-index="0"] [data-detail] canvas');
    const ctx = canvas?.getContext('2d');
    if (canvas === null || canvas === undefined || ctx === null || ctx === undefined) return null;
    // Esquina superior izquierda del detalle: margen de la página, que con noche debe ser oscuro.
    const [r = 0, g = 0, b = 0] = ctx.getImageData(2, 2, 1, 1).data;
    return (r + g + b) / 3;
  });
  expect(luminance).not.toBeNull();
  expect(luminance ?? 255).toBeLessThan(100);
});

test('a 6 400 % el texto sigue legible y ningún lienzo supera los límites', async ({ page }) => {
  await open(page);
  await setZoom(page, '6400');
  await goToText(page);

  const limits = await page.evaluate(() =>
    Array.from(document.querySelectorAll('canvas')).map((c) => ({ w: c.width, h: c.height })),
  );
  for (const { w, h } of limits) {
    expect(w * h).toBeLessThanOrEqual(33_554_432);
    expect(w).toBeLessThanOrEqual(32_767);
    expect(h).toBeLessThanOrEqual(32_767);
  }
  const png = await page.getByTestId('viewer').screenshot();
  expect(await darkPixelCount(page, png)).toBeGreaterThan(0);
});

test('con zoom alto, 20 s de desplazamiento continuo: pocos lienzos vivos, sin long tasks > 100 ms y memoria acotada', { tag: '@perf' }, async ({ page }) => {
  await installPerfProbes(page);
  await open(page);
  await setZoom(page, '3200');
  await goToText(page);
  await clearLongTasks(page);

  await page.getByTestId('viewer').hover();
  const started = Date.now();
  let maxBudget = 0;
  while (Date.now() - started < 20_000) {
    await page.mouse.wheel(0, 150);
    await settle(page);
    // Presupuesto: 12 lienzos base y 1 de detalle por cada página visible (ADR-0025).
    const [canvases, visiblePages] = await Promise.all([canvasCount(page), visiblePageCount(page)]);
    maxBudget = Math.max(maxBudget, canvases - MAX_LIVE_CANVASES_PER_PAGE * visiblePages);
  }
  expect(maxBudget).toBeLessThanOrEqual(0);
  expect((await longTasks(page)).filter((ms) => ms > 100)).toEqual([]);
  const mb = await page.evaluate(() => {
    let bytes = 0;
    for (const c of document.querySelectorAll('canvas')) bytes += c.width * c.height * 4;
    return bytes / (1024 * 1024);
  });
  expect(mb).toBeLessThanOrEqual(MAX_CANVAS_MB);
});

/** Píxeles oscuros (luminancia < 128) de una captura: el texto negro sobre el papel blanco. */
async function darkPixelCount(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('sin contexto 2d');
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 255) < 128 && (data[i + 1] ?? 255) < 128 && (data[i + 2] ?? 255) < 128) dark++;
    }
    return dark;
  }, png.toString('base64'));
}

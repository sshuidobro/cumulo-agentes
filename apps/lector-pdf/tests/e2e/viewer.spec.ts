import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { expectViewerReady } from './viewer-ready.ts';

/** Presupuesto de PDF-009: la última página visible tras Fin en 100 000 páginas. */
const END_BUDGET_MS = 1_500;
const MAX_MOUNTED = 12;

function fixture(name: string): string {
  return join(FIXTURES_DIR, name);
}

async function openFixture(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(fixture(name));
  await expect(page.getByTestId('viewer')).toBeVisible();
}

async function mountedCount(page: Page): Promise<number> {
  return page.locator('[data-page-index]').count();
}

/** Generador determinista (LCG) para que los saltos aleatorios sean reproducibles. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test('en 5 000 páginas la página 1 está visible al abrir y nunca hay más de 12 marcos montados', async ({ page }) => {
  await openFixture(page, 'pages-5000.pdf');
  await expectViewerReady(page);
  await expect(page.getByRole('group', { name: 'Página 1 de 5000' })).toBeVisible();

  const viewer = page.getByTestId('viewer');
  const random = seeded(9009);
  for (let jump = 0; jump < 20; jump++) {
    const roll = random();
    if (roll < 0.4) {
      await page.keyboard.press(roll < 0.2 ? 'End' : 'Home');
    } else {
      await viewer.hover();
      await page.mouse.wheel(0, Math.floor(random() * 4000) - 1500);
    }
    expect(await mountedCount(page)).toBeLessThanOrEqual(MAX_MOUNTED);
  }
});

test('en 100 000 páginas, Fin muestra la última página en menos de 1,5 s', async ({ page }, testInfo) => {
  await openFixture(page, 'pages-100000.pdf');
  await expectViewerReady(page);

  const started = Date.now();
  await page.keyboard.press('End');
  const last = page.getByRole('group', { name: 'Página 100000 de 100000' });
  await expect(last).toBeVisible({ timeout: END_BUDGET_MS });
  const elapsed = Date.now() - started;
  testInfo.annotations.push({ type: 'rendimiento', description: `Fin hasta la última página: ${String(elapsed)} ms` });
  expect(elapsed).toBeLessThan(END_BUDGET_MS);
});

test('en sizes-mixed, la página 2 es más ancha que alta y la 5 (rotada 90°) también', async ({ page }) => {
  await openFixture(page, 'sizes-mixed.pdf');
  await expectViewerReady(page);
  const viewer = page.getByTestId('viewer');

  const pageBox = async (index: number): Promise<{ width: number; height: number }> => {
    const box = await page.locator(`[data-page-index="${index}"]`).boundingBox();
    if (box === null) throw new Error(`La página ${index} no está montada`);
    return { width: box.width, height: box.height };
  };

  // La página 2 está montada al abrir; se mide antes de bajar, porque las páginas se desmontan al salir.
  const second = await pageBox(1);
  expect(second.width).toBeGreaterThan(second.height);

  for (let step = 0; step < 50 && (await page.locator('[data-page-index="4"]').count()) === 0; step++) {
    await viewer.hover();
    await page.mouse.wheel(0, 400);
  }
  const fifth = await pageBox(4);
  expect(fifth.width).toBeGreaterThan(fifth.height);
});

test('el visor es enfocable con Tab y las páginas tienen etiqueta accesible', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await expect(page.getByRole('group', { name: 'Página 1 de 5' })).toBeVisible();
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  // Orden de tabulación: los controles de la barra principal (Abrir, zoom, giro) y luego el visor.
  for (let press = 0; press < 12; press++) {
    if (await page.getByTestId('viewer').evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(page.getByTestId('viewer')).toBeFocused();
});

test('durante un scroll continuo no hay tareas largas de más de 100 ms', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const longTasks: number[] = [];
    (window as unknown as { __longTasks: number[] }).__longTasks = longTasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  });
  await openFixture(page, 'pages-100000.pdf');
  await expectViewerReady(page);

  const viewer = page.getByTestId('viewer');
  await viewer.hover();
  for (let i = 0; i < 50; i++) {
    await page.mouse.wheel(0, 100);
  }
  await page.waitForTimeout(200);

  const longest = await page.evaluate(() => {
    const tasks = (window as unknown as { __longTasks: number[] }).__longTasks;
    return tasks.reduce((max, duration) => Math.max(max, duration), 0);
  });
  testInfo.annotations.push({ type: 'rendimiento', description: `Tarea larga máxima: ${Math.round(longest)} ms` });
  expect(longest).toBeLessThanOrEqual(100);
});

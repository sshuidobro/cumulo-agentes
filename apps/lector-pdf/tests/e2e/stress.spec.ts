import { expect, test, type Locator, type Page } from '@playwright/test';
import { frameSize, openFixture, pageField, pageNow, recordMeasure, waitPageRendered, waitPageVisible } from './helpers.ts';

/**
 * Estrés con documentos enormes (100 000 páginas y 20 000 páginas planas): la app responde en todo momento.
 * Cada acción debe ser visible en menos de 2 s; si no, la prueba falla con la medida en el informe.
 */
const RESPONSE_MS = 2_000;
const SEARCH_START_MS = 10_000;
const ZOOM_STEPS = 5;
const ROTATIONS = 4;

const CASES = [
  { name: 'pages-100000.pdf', total: 100_000 },
  { name: 'pages-20000-flat.pdf', total: 20_000 },
] as const;

function searchField(page: Page): Locator {
  return page.getByRole('searchbox', { name: 'Buscar en el documento' });
}

/** Ejecuta `action` y espera a `visible`; registra el tiempo del reloj de la página y lo compara con `RESPONSE_MS`. */
async function responds(page: Page, label: string, action: () => Promise<void>, visible: () => Promise<void>): Promise<number> {
  const started = await pageNow(page);
  await action();
  await visible();
  const elapsed = (await pageNow(page)) - started;
  expect(elapsed, `«${label}» visible en menos de ${String(RESPONSE_MS)} ms`).toBeLessThan(RESPONSE_MS);
  return elapsed;
}

for (const { name, total } of CASES) {
  test(`${name}: Fin, Inicio, buscar «aguja» y detener, zoom ×${String(ZOOM_STEPS)} y giro ×${String(ROTATIONS)}; cada acción visible en < 2 s`, async ({
    page,
  }, testInfo) => {
    const times: string[] = [];
    const log = (label: string, ms: number): void => {
      times.push(`${label} ${ms.toFixed(0)} ms`);
    };

    await openFixture(page, name);
    await waitPageRendered(page, 1);

    log(
      'Fin',
      await responds(
        page,
        'Fin',
        () => page.keyboard.press('End'),
        () => waitPageVisible(page, total, total),
      ),
    );
    log(
      'Inicio',
      await responds(
        page,
        'Inicio',
        () => page.keyboard.press('Home'),
        () => waitPageVisible(page, 1, total),
      ),
    );

    // Buscar «aguja» y detener: el botón «Detener» solo existe mientras la búsqueda avanza.
    const started = await pageNow(page);
    await page.keyboard.press('Control+f');
    await searchField(page).fill('aguja');
    const stop = page.getByRole('button', { name: 'Detener' });
    await expect(stop).toBeVisible({ timeout: SEARCH_START_MS });
    const searchStarted = (await pageNow(page)) - started;
    log('buscar «aguja» (aparece «Detener»)', searchStarted);
    log(
      'detener',
      await responds(
        page,
        'detener la búsqueda',
        () => stop.click(),
        () => expect(page.getByRole('button', { name: 'Detener' })).toHaveCount(0),
      ),
    );

    // La búsqueda ha podido llevar el visor a una coincidencia: volver a la página 1 para los pasos siguientes.
    await page.getByTestId('viewer').focus();
    await page.keyboard.press('Home');
    await waitPageVisible(page, 1, total);
    await waitPageRendered(page, 1);

    // Zoom: cada Ctrl+ amplía, así que el campo de zoom cambia en cada paso.
    for (let step = 1; step <= ZOOM_STEPS; step++) {
      const before = await page.getByRole('textbox', { name: 'Zoom' }).inputValue();
      log(
        `zoom ${String(step)}`,
        await responds(
          page,
          `zoom ${String(step)}`,
          () => page.keyboard.press('Control+='),
          () => expect.poll(() => page.getByRole('textbox', { name: 'Zoom' }).inputValue()).not.toBe(before),
        ),
      );
    }

    // Giro: la página 1 alterna entre vertical y horizontal con cada Ctrl+Mayús+→.
    const portrait = await frameSize(page, 1);
    expect(portrait.height).toBeGreaterThan(portrait.width);
    for (let turn = 1; turn <= ROTATIONS; turn++) {
      const expectLandscape = turn % 2 === 1;
      log(
        `giro ${String(turn)}`,
        await responds(
          page,
          `giro ${String(turn)}`,
          () => page.keyboard.press('Control+Shift+ArrowRight'),
          () =>
            expect
              .poll(async () => {
                const size = await frameSize(page, 1);
                return size.width > size.height;
              })
              .toBe(expectLandscape),
        ),
      );
    }

    // Al final la app sigue respondiendo: la última página se ve.
    await page.keyboard.press('End');
    await waitPageVisible(page, total, total);
    await expect(pageField(page)).toHaveValue(String(total));

    recordMeasure(testInfo, `${name}: ${times.join('; ')}`);
  });
}

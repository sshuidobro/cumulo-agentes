import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readAloudMsg } from '../../src/ui/messages-read-aloud.ts';
import { goToPageByKeyboard, openFixture, pageFrame } from './helpers.ts';

/*
 * Leer en voz alta (PDF-114, ADR-0033). La voz es falsa: `speechSynthesis` y `SpeechSynthesisUtterance` se sustituyen
 * antes de que cargue la app. Cada `speak` registra su texto y su velocidad en `__spoken` y `__rates`, y termina a los
 * `__speakMs` milisegundos (50 por defecto). Las pruebas que miran la lectura «en curso» suben ese tiempo para no
 * depender de la velocidad de la máquina.
 */

const BAR = { name: readAloudMsg.toolbar };

interface FakeSpeech {
  __spoken: string[];
  __rates: number[];
  __speakMs: number;
}

/** Sustituye la voz del navegador. `local: false` deja solo una voz en red (`localService: false`). */
async function installFakeSpeech(page: Page, local: boolean): Promise<void> {
  await page.addInitScript((localService: boolean) => {
    const fake = window as unknown as FakeSpeech;
    fake.__spoken = [];
    fake.__rates = [];
    fake.__speakMs = 50;

    class FakeUtterance {
      readonly text: string;
      voice: unknown = null;
      lang = '';
      rate = 1;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }

    const voices = [{ voiceURI: 'es-voz', name: 'Voz local española', lang: 'es-ES', localService, default: true }];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const synth = {
      getVoices: () => voices,
      speak(utterance: FakeUtterance) {
        fake.__spoken.push(utterance.text);
        fake.__rates.push(utterance.rate);
        timer = setTimeout(() => {
          timer = null;
          utterance.onend?.();
        }, fake.__speakMs);
      },
      cancel() {
        if (timer !== null) clearTimeout(timer);
        timer = null;
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true });
  }, local);
}

/** Textos que ha dicho la voz falsa, en orden. */
function spoken(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as FakeSpeech).__spoken);
}

/** Alarga cada fragmento para observar la lectura «en curso» sin carrera. */
async function slowSpeech(page: Page, ms: number): Promise<void> {
  await page.evaluate((value: number) => {
    (window as unknown as FakeSpeech).__speakMs = value;
  }, ms);
}

/** Deja pasar `ms` milisegundos para comprobar que «no pasa nada». */
async function observe(page: Page, ms: number): Promise<void> {
  await page.evaluate((value: number) => new Promise<void>((resolve) => setTimeout(resolve, value)), ms);
}

test.describe('Leer en voz alta (PDF-114)', () => {
  test('Ctrl+Mayús+V lee la página 1: los fragmentos en orden, un resaltado en curso y la barra desaparece al final', async ({ page }) => {
    await installFakeSpeech(page, true);
    await openFixture(page, 'basic-5.pdf');

    await page.keyboard.press('Control+Shift+V');
    await expect(page.getByRole('toolbar', BAR)).toHaveCount(0);
    // Los renglones de la página forman un único fragmento (sin signo de fin de frase entre ellos); no sale ninguna otra página.
    expect(await spoken(page)).toEqual(['Página 1 de 5 marcador-1 El veloz murciélago hindú comía feliz cardillo y kiwi.']);
  });

  test('durante la lectura hay exactamente un resaltado sobre la frase en curso, y «Parar» lo quita', async ({ page }) => {
    await installFakeSpeech(page, true);
    await openFixture(page, 'basic-5.pdf');
    await slowSpeech(page, 5_000);

    await page.keyboard.press('Control+Shift+V');
    await expect.poll(async () => (await spoken(page)).length).toBe(1);

    await expect(page.locator('.read-aloud-current')).toHaveCount(1);
    await expect(pageFrame(page, 1).locator('.read-aloud-current')).toHaveCount(1);

    await page.getByRole('toolbar', BAR).getByRole('button', { name: 'Parar' }).click();
    await expect(page.getByRole('toolbar', BAR)).toHaveCount(0);
    await expect(page.locator('.read-aloud-current')).toHaveCount(0);
  });

  test('«Leer hasta el final» desde la página 4 pasa a la página 5 y el visor la muestra', async ({ page }) => {
    await installFakeSpeech(page, true);
    await openFixture(page, 'basic-5.pdf');
    await goToPageByKeyboard(page, 4, 5);

    await page.getByRole('button', { name: 'Vista', exact: true }).click();
    await page.getByRole('menuitem', { name: readAloudMsg.readToEnd, exact: true }).click();

    await expect(page.getByTestId('viewer')).toHaveAttribute('data-current-page', '5');
    await expect(page.getByRole('toolbar', BAR)).toHaveCount(0);
    const texts = await spoken(page);
    expect(texts.some((text) => text.startsWith('Página 5 de 5'))).toBe(true);
    expect(texts.some((text) => text.startsWith('Página 4 de 5'))).toBe(true);
  });

  test('pausa: no se dice nada durante 300 ms; reanudar repite el fragmento pausado y sigue; Parar no deja resaltado', async ({ page }) => {
    await installFakeSpeech(page, true);
    await openFixture(page, 'basic-5.pdf');
    await slowSpeech(page, 5_000);

    await page.keyboard.press('Control+Shift+V');
    await expect.poll(async () => (await spoken(page)).length).toBe(1);
    const bar = page.getByRole('toolbar', BAR);
    const pause = bar.getByRole('button', { name: readAloudMsg.pause });

    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    const atPause = (await spoken(page)).length;
    await observe(page, 300);
    expect((await spoken(page)).length).toBe(atPause);

    await slowSpeech(page, 50);
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'false');
    // Reanudar vuelve a decir el fragmento que se pausó (el último dicho) y la lectura sigue.
    await expect.poll(async () => (await spoken(page)).length).toBe(atPause + 1);
    const texts = await spoken(page);
    expect(texts[atPause]).toBe(texts[atPause - 1]);
    await expect(page.getByRole('toolbar', BAR)).toHaveCount(0);
  });

  test('sin voces locales: las entradas del menú están deshabilitadas, con su explicación, y nunca se llama a speak', async ({ page }) => {
    await installFakeSpeech(page, false);
    await openFixture(page, 'basic-5.pdf');

    await page.getByRole('button', { name: 'Vista', exact: true }).click();
    const item = page.getByRole('menuitem', { name: readAloudMsg.readPage, exact: true });
    await expect(item).toBeDisabled();
    await expect(item).toHaveAttribute('title', readAloudMsg.noVoices);
    await expect(page.getByRole('menuitem', { name: readAloudMsg.readToEnd, exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');

    await page.keyboard.press('Control+Shift+V');
    await expect(page.getByText(readAloudMsg.noVoices, { exact: true })).toBeVisible();
    expect(await spoken(page)).toEqual([]);
  });

  test('la velocidad 1,5× se aplica al siguiente fragmento y se recuerda al recargar la app', async ({ page }) => {
    await installFakeSpeech(page, true);
    await openFixture(page, 'basic-5.pdf');
    await slowSpeech(page, 5_000);
    await page.keyboard.press('Control+Shift+V');
    await expect.poll(async () => (await spoken(page)).length).toBe(1);

    const speed = page.getByRole('toolbar', BAR).getByRole('combobox', { name: 'Velocidad de lectura' });
    await speed.selectOption({ label: '1,5×' });
    await expect.poll(() => page.evaluate(() => (window as unknown as FakeSpeech).__rates.at(-1))).toBe(1.5);

    await page.reload();
    await openFixture(page, 'basic-5.pdf');
    await slowSpeech(page, 5_000);
    await page.keyboard.press('Control+Shift+V');
    await expect(page.getByRole('toolbar', BAR).getByRole('combobox', { name: 'Velocidad de lectura' })).toHaveValue('1.5');
    await expect.poll(() => page.evaluate(() => (window as unknown as FakeSpeech).__rates.at(-1))).toBe(1.5);
  });

  test.describe('accesibilidad', () => {
    test('la barra no tiene violaciones de axe, se controla con teclado y Esc la cierra', async ({ page }) => {
      await installFakeSpeech(page, true);
      await openFixture(page, 'basic-5.pdf');
      await slowSpeech(page, 5_000);
      await page.keyboard.press('Control+Shift+V');
      const bar = page.getByRole('toolbar', BAR);
      await expect(bar).toBeVisible();

      const violations = await new AxeBuilder({ page }).include('[role="toolbar"][aria-label="Lectura en voz alta"]').analyze();
      expect(violations.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

      const pause = bar.getByRole('button', { name: readAloudMsg.pause });
      await pause.focus();
      await expect(pause).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(bar).toHaveCount(0);
    });

    test.describe('tema oscuro', () => {
      test.use({ colorScheme: 'dark' });

      test('la barra se ve y es accesible con el tema oscuro', async ({ page }) => {
        await installFakeSpeech(page, true);
        await openFixture(page, 'basic-5.pdf');
        await slowSpeech(page, 5_000);
        await page.keyboard.press('Control+Shift+V');
        await expect(page.getByRole('toolbar', BAR)).toBeVisible();

        const violations = await new AxeBuilder({ page }).include('[role="toolbar"][aria-label="Lectura en voz alta"]').analyze();
        expect(violations.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
      });
    });
  });
});

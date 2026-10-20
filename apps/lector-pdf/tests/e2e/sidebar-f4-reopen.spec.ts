import { expect, test } from '@playwright/test';
import { createNoteWithText, openInNewPage, openWithDownloads, saveWithCtrlS } from './annotations-kit.ts';
import { fixture } from './helpers.ts';

// PDF-141: F4 abre y cierra el panel lateral también tras reabrir un PDF guardado (atajo usable con teclado).
test('F4 abre y cierra el panel lateral tras reabrir un PDF guardado', async ({ page }, testInfo) => {
  // Hace falta un cambio: Ctrl+S sin modificaciones no descarga nada.
  await openWithDownloads(page, fixture('basic-5.pdf'));
  await createNoteWithText(page, 'Nota para F4');
  const saved = await saveWithCtrlS(page, testInfo, 'basic-5-f4.pdf');

  const reopened = await openInNewPage(page, saved);
  const toggle = reopened.getByRole('button', { name: 'Panel lateral', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', /^(true|false)$/);
  const initial: 'true' | 'false' = (await toggle.getAttribute('aria-pressed')) === 'true' ? 'true' : 'false';

  const flipped = initial === 'true' ? 'false' : 'true';
  await reopened.keyboard.press('F4');
  await expect(toggle).toHaveAttribute('aria-pressed', flipped);

  await reopened.keyboard.press('F4');
  await expect(toggle).toHaveAttribute('aria-pressed', initial);
});

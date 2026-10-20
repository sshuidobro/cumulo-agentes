import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { msg } from '../../src/ui/messages.ts';
import { tabsMsg } from '../../src/ui/messages-tabs.ts';
import { openCommentBar, zoneOf } from './annotations-kit.ts';
import { fixture, goToPageByKeyboard, openFixture, waitPageRendered, waitPageVisible } from './helpers.ts';
import { copyWithId, openMore, tabNamed } from './tabs-kit.ts';

/**
 * Pestañas de documentos (PDF-095): barra solo con dos o más documentos, cambio con ratón y teclado, cierre con
 * preguntas por los cambios sin guardar, límite de 10 documentos, documentos repetidos, cierre de ventana y axe.
 * Las consultas son por rol y nombre accesible.
 */

/** Resalta todo el texto de la página visible (dirty) con la barra «Comentar». */
async function makeDirty(page: Page): Promise<void> {
  await waitPageRendered(page, 1);
  const toolbar = await openCommentBar(page);
  await page.keyboard.press('Control+a');
  const highlight = toolbar.getByRole('button', { name: 'Resaltar' });
  await highlight.focus();
  await page.keyboard.press('Enter');
  await expect(zoneOf(page, 1, 'Resaltado de Usuario')).toHaveCount(1);
}

/** Lleva el foco con Tab hasta la barra de pestañas (desde el inicio del documento). */
async function tabUntilTabBar(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  for (let i = 0; i < 40; i++) {
    const role = await page.evaluate(() => document.activeElement?.getAttribute('role') ?? null);
    if (role === 'tab') return;
    await page.keyboard.press('Tab');
  }
  throw new Error('El foco no llega a la barra de pestañas con Tab');
}

test('con un documento no hay barra; con dos aparece y el documento anterior conserva página y zoom', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await expect(page.getByRole('tablist')).toHaveCount(0);

  await goToPageByKeyboard(page, 3, 5);
  await page.getByTestId('viewer').focus();
  await page.keyboard.press('Control+Equal');
  const zoom = page.getByRole('textbox', { name: 'Zoom' });
  const zoomBefore = await zoom.inputValue();
  expect(zoomBefore).not.toBe('100 %');

  await openMore(page, fixture('links.pdf'), 'links.pdf');
  await expect(page.getByRole('tablist', { name: tabsMsg.tabListLabel })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(tabNamed(page, 'links.pdf')).toHaveAttribute('aria-selected', 'true');

  await tabNamed(page, 'basic-5.pdf').click();
  await expect(tabNamed(page, 'basic-5.pdf')).toHaveAttribute('aria-selected', 'true');
  await waitPageVisible(page, 3, 5);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-current-page', '3');
  await expect(zoom).toHaveValue(zoomBefore);
});

test('Ctrl+Tab y Ctrl+Mayús+Tab alternan con vuelta; Tab, flecha, Intro y Supr funcionan en la barra', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await openMore(page, fixture('links.pdf'), 'links.pdf');
  await openMore(page, fixture('basic-5-changed.pdf'), 'basic-5-changed.pdf');
  await expect(page.getByRole('tab')).toHaveCount(3);

  await page.keyboard.press('Control+Tab');
  await expect(tabNamed(page, 'basic-5.pdf')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+Tab');
  await expect(tabNamed(page, 'links.pdf')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+Shift+Tab');
  await expect(tabNamed(page, 'basic-5.pdf')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+Shift+Tab');
  await expect(tabNamed(page, 'basic-5-changed.pdf')).toHaveAttribute('aria-selected', 'true');

  // La activa tiene el foco de la barra; → lleva a la siguiente (con vuelta) y Intro la activa.
  await tabUntilTabBar(page);
  await expect(tabNamed(page, 'basic-5-changed.pdf')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tabNamed(page, 'basic-5.pdf')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tabNamed(page, 'basic-5.pdf')).toHaveAttribute('aria-selected', 'true');
  await expect(tabNamed(page, 'basic-5.pdf')).toBeFocused();

  // Supr cierra la pestaña enfocada (sin cambios, sin preguntar).
  await page.keyboard.press('Delete');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(tabNamed(page, 'basic-5.pdf')).toHaveCount(0);
});

test('un documento con cambios muestra «• »; Ctrl+W pregunta; «Cancelar» lo deja y «No guardar» lo cierra', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await openMore(page, fixture('links.pdf'), 'links.pdf');
  await tabNamed(page, 'basic-5.pdf').click();
  await expect(tabNamed(page, 'basic-5.pdf')).toHaveAttribute('aria-selected', 'true');
  await makeDirty(page);

  await expect(tabNamed(page, 'basic-5.pdf')).toContainText('•');
  await expect(tabNamed(page, 'links.pdf')).not.toContainText('•');

  const dialog = page.getByRole('dialog');
  await page.keyboard.press('Control+w');
  await expect(dialog).toContainText(msg.unsavedQuestion('basic-5.pdf'));
  await dialog.getByRole('button', { name: msg.cancel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(tabNamed(page, 'basic-5.pdf')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Control+w');
  await expect(dialog).toContainText(msg.unsavedQuestion('basic-5.pdf'));
  await dialog.getByRole('button', { name: msg.discard, exact: true }).click();
  await expect(tabNamed(page, 'basic-5.pdf')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(tabNamed(page, 'links.pdf')).toHaveCount(0);
});

test('con 10 documentos abiertos, el 11.º no se abre y avisa; siguen 10', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  for (let n = 2; n <= 10; n++) {
    await openMore(page, copyWithId(fixture('basic-5.pdf'), `copia-${String(n)}.pdf`, n), `copia-${String(n)}.pdf`);
  }
  await expect(page.getByRole('tab')).toHaveCount(10);

  await page.locator('[data-testid=open-input]').setInputFiles(copyWithId(fixture('basic-5.pdf'), 'copia-11.pdf', 11));
  await expect(page.getByRole('status').filter({ hasText: tabsMsg.tooMany })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(10);
  await expect(tabNamed(page, 'copia-11.pdf')).toHaveCount(0);
});

test('abrir de nuevo un documento ya abierto activa su pestaña y avisa', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await openMore(page, fixture('links.pdf'), 'links.pdf');
  await expect(tabNamed(page, 'links.pdf')).toHaveAttribute('aria-selected', 'true');

  await page.locator('[data-testid=open-input]').setInputFiles(fixture('basic-5.pdf'));
  // La pestaña provisional de la carga duplicada desaparece al descartarse: primero se espera a que queden dos.
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(tabNamed(page, 'basic-5.pdf')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('status').filter({ hasText: tabsMsg.alreadyOpen('basic-5.pdf') })).toBeVisible();
});

test('cerrar la ventana con dos pestañas sucias pregunta por la primera y luego por la segunda', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await makeDirty(page);
  await openMore(page, fixture('basic-5-changed.pdf'), 'basic-5-changed.pdf');
  await makeDirty(page);

  // Equivale al `beforeunload` del navegador: el aviso cancela el cierre.
  const prevented = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(msg.unsavedQuestion('basic-5.pdf'));
  await dialog.getByRole('button', { name: msg.discard, exact: true }).click();
  await expect(dialog).toContainText(msg.unsavedQuestion('basic-5-changed.pdf'));
  await dialog.getByRole('button', { name: msg.cancel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(tabNamed(page, 'basic-5-changed.pdf')).toHaveAttribute('aria-selected', 'true');
});

test('con tres pestañas (una sucia, una con error) no hay violaciones axe graves', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await makeDirty(page);
  await openMore(page, fixture('links.pdf'), 'links.pdf');
  await page.locator('[data-testid=open-input]').setInputFiles(fixture('corrupt-not-pdf.pdf'));
  await expect(tabNamed(page, 'corrupt-not-pdf.pdf')).toHaveAttribute('aria-selected', 'true');
  await expect(tabNamed(page, 'corrupt-not-pdf.pdf').getByRole('img', { name: tabsMsg.loadFailed })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(tabNamed(page, 'basic-5.pdf')).toContainText('•');

  const results = await new AxeBuilder({ page }).analyze();
  const severe = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(severe.map((v) => `${v.impact ?? '?'} ${v.id}: ${v.help} ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { fixture } from './helpers.ts';
import {
  commentDialog,
  commentRows,
  openCommentBar,
  openCommentsPanel,
  openWithDownloads,
  pickTool,
} from './annotations-kit.ts';
import { pageFrame } from './helpers.ts';

/**
 * Accesibilidad de la capa de anotaciones (PDF-039): axe-core sobre la barra «Comentar», la ventana de nota y el
 * panel de comentarios. Ninguna violación de impacto «serious» o «critical» en las tres vistas.
 */

/** Violaciones de axe con impacto grave o crítico, en un formato legible para el informe. */
async function seriousViolations(page: Page, testInfo: TestInfo, view: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  testInfo.annotations.push({
    type: 'axe',
    description: `${view}: ${String(results.violations.length)} violaciones en total, ${String(serious.length)} serious/critical`,
  });
  return serious.map((v) => `${v.impact ?? '?'} ${v.id}: ${v.help} (${String(v.nodes.length)} nodos)`);
}

test('barra «Comentar» abierta: sin violaciones serious ni critical', async ({ page }, testInfo) => {
  await openWithDownloads(page, fixture('basic-5.pdf'));
  await openCommentBar(page);
  await expect(page.getByRole('toolbar', { name: 'Comentar' })).toBeVisible();

  expect(await seriousViolations(page, testInfo, 'barra Comentar')).toEqual([]);
});

test('ventana de nota abierta: sin violaciones serious ni critical', async ({ page }, testInfo) => {
  await openWithDownloads(page, fixture('basic-5.pdf'));
  await pickTool(page, 'Nota');
  await pageFrame(page, 1).click({ position: { x: 150, y: 150 } });
  await expect(commentDialog(page)).toBeVisible();

  expect(await seriousViolations(page, testInfo, 'ventana de nota')).toEqual([]);
});

test('panel de comentarios con filas: sin violaciones serious ni critical', async ({ page }, testInfo) => {
  await openWithDownloads(page, fixture('annotated.pdf'));
  await openCommentsPanel(page);
  await expect(commentRows(page)).toHaveCount(6);

  expect(await seriousViolations(page, testInfo, 'panel de comentarios')).toEqual([]);
});

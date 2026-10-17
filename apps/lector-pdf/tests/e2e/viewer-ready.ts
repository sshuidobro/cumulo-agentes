import { expect, type Page } from '@playwright/test';

/**
 * Espera a que el visor pueda recibir teclas y rueda: la primera página está montada y el visor tiene el foco.
 * El foco lo pone el propio visor al abrir el documento, después de que React registre sus efectos
 * (rueda y, con scroll escalado, teclado de navegación). Así un test no pulsa teclas antes de que la app esté lista.
 */
export async function expectViewerReady(page: Page): Promise<void> {
  await expect(page.locator('[data-page-index]').first()).toBeVisible();
  await expect(page.getByTestId('viewer')).toBeFocused();
}

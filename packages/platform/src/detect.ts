import type { Platform } from './types';

/** Detección de plataforma en un único sitio (ADR-0008). */
export function isTauri(win: object = globalThis): boolean {
  return '__TAURI_INTERNALS__' in win;
}

export async function loadPlatform(options: { readonly prefsPrefix: string }): Promise<Platform> {
  if (isTauri()) {
    const tauri = await import('./tauri/index');
    return tauri.createTauriPlatform(options);
  }
  const web = await import('./web/index');
  return web.createWebPlatform(options);
}

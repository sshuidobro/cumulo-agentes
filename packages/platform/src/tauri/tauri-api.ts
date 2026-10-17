import { invoke as coreInvoke } from '@tauri-apps/api/core';
import { listen as eventListen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl as pluginOpenUrl } from '@tauri-apps/plugin-opener';

/** Cabeceras HTTP-like que los comandos `suite_*` leen (ver COM-009). */
export interface InvokeOptions { readonly headers: Record<string, string> }

/**
 * Superficie mínima de Tauri que usa `createTauriPlatform`. Se inyecta para poder
 * probarla con un doble falso; la implementación real está en `realTauriApi()`.
 * Es el único punto del código de la plataforma que toca `@tauri-apps/*`.
 */
export interface TauriApi {
  invoke<T>(cmd: string, args?: Record<string, unknown> | Uint8Array, options?: InvokeOptions): Promise<T>;
  listen(event: string, handler: () => void): Promise<() => void>;
  setTitle(title: string): Promise<void>;
  onCloseRequested(handler: (preventDefault: () => void) => void): Promise<() => void>;
  /** Destruye la ventana: no emite `close-requested`. */
  destroyWindow(): Promise<void>;
  openUrl(url: string): Promise<void>;
}

/** Implementación real sobre la API de Tauri 2. Solo se usa dentro de la app de escritorio. */
export function realTauriApi(): TauriApi {
  return {
    invoke<T>(cmd: string, args?: Record<string, unknown> | Uint8Array, options?: InvokeOptions): Promise<T> {
      return coreInvoke<T>(cmd, args, options);
    },
    listen(event: string, handler: () => void): Promise<() => void> {
      return eventListen(event, () => { handler(); });
    },
    setTitle(title: string): Promise<void> {
      return getCurrentWindow().setTitle(title);
    },
    onCloseRequested(handler: (preventDefault: () => void) => void): Promise<() => void> {
      return getCurrentWindow().onCloseRequested((event) => {
        handler(() => { event.preventDefault(); });
      });
    },
    destroyWindow(): Promise<void> {
      return getCurrentWindow().destroy();
    },
    openUrl(url: string): Promise<void> {
      return pluginOpenUrl(url);
    },
  };
}

import type { TextLayerHandle } from '../../engine/text';

/**
 * Capas de texto montadas, por índice de página (0-based). Lo usan la selección de «Seleccionar todo»
 * (PDF-013) y el resaltado de búsqueda (PDF-018).
 */
const layers = new Map<number, TextLayerHandle>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Registra la capa de la página `pageIndex`, sustituyendo la anterior si la había. */
export function register(pageIndex: number, handle: TextLayerHandle): void {
  layers.set(pageIndex, handle);
  notify();
}

/** Quita la capa de la página `pageIndex` (no hace nada si no estaba). */
export function unregister(pageIndex: number): void {
  if (!layers.delete(pageIndex)) return;
  notify();
}

/** Capa de texto de la página `pageIndex`, o `undefined` si no está montada. */
export function get(pageIndex: number): TextLayerHandle | undefined {
  return layers.get(pageIndex);
}

/** Avisa cada vez que se registra o desregistra una capa. Devuelve la función que cancela la suscripción. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

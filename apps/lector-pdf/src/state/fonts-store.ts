import { create } from 'zustand';
import type { FontInfo } from '../core/pdf';

export type FontScanStatus = 'idle' | 'scanning' | 'done' | 'cancelled' | 'error';

/** Escaneo de fuentes del documento abierto (PDF-088). Lo gestiona `fonts-actions.ts`. */
export interface FontScanState {
  readonly status: FontScanStatus;
  /** Fuentes encontradas hasta ahora, únicas y ordenadas. Crecen por lotes. */
  readonly fonts: readonly FontInfo[];
  /** Páginas ya recorridas (lotes completos). */
  readonly pagesDone: number;
  readonly total: number;
}

export const initialFontScan: FontScanState = { status: 'idle', fonts: [], pagesDone: 0, total: 0 };

export const useFontScan = create<FontScanState>()(() => initialFontScan);

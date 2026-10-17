import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { UndoState } from '@suite/shared';
import {
  EMPTY_EDITS,
  type Annotation,
  type AnnotationEdits,
  type Rgb,
} from '../core/annotations/model';
import type { ForeignAnnotation } from '../core/annotations/import';
import {
  DEFAULT_AUTHOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_INK_WIDTH,
  DEFAULT_TOOL_COLORS,
  type FONT_SIZES,
  type INK_WIDTHS,
} from '../core/annotations/palette';

export type AnnotationTool = 'none' | 'highlight' | 'underline' | 'strikeout' | 'note' | 'freetext' | 'ink';
export type ColorTool = Exclude<AnnotationTool, 'none'>;
export type ScanState = 'idle' | 'scanning' | 'done' | 'lazy';

/** Estado de las anotaciones del documento abierto. Lo escriben solo las acciones de `annotation-actions.ts`. */
export interface AnnotationState {
  /** Anotaciones soportadas importadas del fichero, por id. */
  readonly baseline: ReadonlyMap<string, Annotation>;
  readonly foreign: ReadonlyMap<string, ForeignAnnotation>;
  /** Páginas (0-based) ya importadas. */
  readonly importedPages: ReadonlySet<number>;
  /** 'lazy' = documento > 20 000 páginas: se importa por páginas visitadas. */
  readonly scan: ScanState;
  /** Páginas importadas hasta ahora. */
  readonly scanProgress: number;
  readonly edits: AnnotationEdits;
  readonly undo: UndoState;
  readonly selectedId: string | null;
  readonly tool: AnnotationTool;
  readonly colors: Readonly<Record<ColorTool, Rgb>>;
  readonly inkWidth: (typeof INK_WIDTHS)[number];
  readonly fontSize: (typeof FONT_SIZES)[number];
  readonly author: string;
  readonly commentBarOpen: boolean;
  /** Sube cuando cambian las anotaciones de una página (para redibujar). */
  readonly pageVersion: ReadonlyMap<number, number>;
}

const EMPTY_UNDO: UndoState = {
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
  undoDepth: 0,
  redoDepth: 0,
  isDirty: false,
};

/** Estado inicial de una sesión sin documento (valores por defecto, sin preferencias). */
export function initialAnnotationState(): AnnotationState {
  return {
    baseline: new Map(),
    foreign: new Map(),
    importedPages: new Set(),
    scan: 'idle',
    scanProgress: 0,
    edits: EMPTY_EDITS,
    undo: EMPTY_UNDO,
    selectedId: null,
    tool: 'none',
    colors: { ...DEFAULT_TOOL_COLORS },
    inkWidth: DEFAULT_INK_WIDTH,
    fontSize: DEFAULT_FONT_SIZE,
    author: DEFAULT_AUTHOR,
    commentBarOpen: false,
    pageVersion: new Map(),
  };
}

export const useAnnotations: UseBoundStore<StoreApi<AnnotationState>> = create<AnnotationState>()(() =>
  initialAnnotationState(),
);

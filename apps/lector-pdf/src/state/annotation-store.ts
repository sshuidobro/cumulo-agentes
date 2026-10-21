import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { UndoState } from '@suite/shared';
import {
  EMPTY_EDITS,
  type Annotation,
  type AnnotationEdits,
  type FreeTextAnnotation,
  type Rgb,
} from '../core/annotations/model';
import type { ForeignAnnotation } from '../core/annotations/import';
import type { SignatureArt } from '../core/annotations/model';
import type { StampName } from '../core/annotations/shapes';
import {
  DEFAULT_AUTHOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_INK_WIDTH,
  DEFAULT_TOOL_COLORS,
  type FONT_SIZES,
  type INK_WIDTHS,
} from '../core/annotations/palette';

/**
 * `page-text` y `page-image` (PDF-130): texto e imagen que se aplican como contenido de la página al guardar. La
 * imagen pendiente de colocar es la misma `pendingSignature` que la firma.
 *
 * `signature`: la firma elegida se coloca con un clic o con Intro (PDF-043). No tiene color propio. `stamp` (PDF-115):
 * el sello pendiente se coloca con un clic o con Intro; su color lo fija el nombre. `polygon` (PDF-115): cada clic añade
 * un vértice.
 */
export type AnnotationTool =
  | 'none'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'note'
  | 'freetext'
  | 'ink'
  | 'square'
  | 'circle'
  | 'line'
  | 'arrow'
  | 'polygon'
  | 'signature'
  | 'stamp'
  | 'page-text'
  | 'page-image'
  | 'redact';
/** Herramientas con color propio. `page-image` no tiene: la imagen trae sus colores (PDF-130). */
export type ColorTool = Exclude<AnnotationTool, 'none' | 'signature' | 'stamp' | 'page-image' | 'redact'>;
export type ScanState = 'idle' | 'scanning' | 'done' | 'lazy';

/**
 * Cuadro de texto libre en edición (PDF-034). `base` es el cuadro tal como se mostrará: uno nuevo que aún no está en
 * la pila de cambios (`inStore: false`), o la anotación existente (`inStore: true`). `floor` es el borde inferior de la
 * página en puntos PDF: el cuadro puede crecer hacia abajo hasta ahí.
 */
export interface FreeTextEditing {
  readonly base: FreeTextAnnotation;
  readonly inStore: boolean;
  readonly floor: number;
}

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
  /** `true` mientras corre el escaneo completo que lanza el usuario desde el panel de comentarios (PDF-036): se puede cancelar. */
  readonly scanCancelable: boolean;
  readonly edits: AnnotationEdits;
  readonly undo: UndoState;
  readonly selectedId: string | null;
  /** Anotación cuya ventana emergente de comentario está abierta (PDF-033), o ninguna. */
  readonly openPopupId: string | null;
  readonly tool: AnnotationTool;
  /** Firma elegida con «Firmar» (herramienta `signature`) o imagen elegida con «Añadir imagen» (`page-image`, PDF-130), pendiente de colocar; o ninguna (PDF-043). */
  readonly pendingSignature: SignatureArt | null;
  /** Sello elegido en «Sello» (PDF-115): el que se coloca con la herramienta `stamp`. Es preferencia global. */
  readonly pendingStamp: StampName;
  /** Cuadro de texto libre que se edita en el sitio, o ninguno (PDF-034). */
  readonly editing: FreeTextEditing | null;
  readonly colors: Readonly<Record<ColorTool, Rgb>>;
  readonly inkWidth: (typeof INK_WIDTHS)[number];
  /** Grosor de los rectángulos, elipses, líneas y flechas nuevos (PDF-108). */
  readonly shapeWidth: (typeof INK_WIDTHS)[number];
  readonly fontSize: (typeof FONT_SIZES)[number];
  readonly author: string;
  readonly commentBarOpen: boolean;
  /** Barra «Editar» abierta (PDF-130). Como «Comentar», no se guarda entre sesiones. */
  readonly editBarOpen: boolean;
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
    scanCancelable: false,
    edits: EMPTY_EDITS,
    undo: EMPTY_UNDO,
    selectedId: null,
    openPopupId: null,
    tool: 'none',
    pendingSignature: null,
    pendingStamp: 'Approved',
    editing: null,
    colors: { ...DEFAULT_TOOL_COLORS },
    inkWidth: DEFAULT_INK_WIDTH,
    shapeWidth: DEFAULT_INK_WIDTH,
    fontSize: DEFAULT_FONT_SIZE,
    author: DEFAULT_AUTHOR,
    commentBarOpen: false,
    editBarOpen: false,
    pageVersion: new Map(),
  };
}

export const useAnnotations: UseBoundStore<StoreApi<AnnotationState>> = create<AnnotationState>()(() =>
  initialAnnotationState(),
);

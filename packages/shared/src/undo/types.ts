export interface Command<D> {
  /** Texto en español para "Deshacer <label>", p. ej. "escribir". */
  readonly label: string;
  /** Clave de agrupación (la usa COM-003). Sin clave = nunca se agrupa (pegar, cortar, IME). */
  readonly mergeKey?: string;
  apply(doc: D): D;
  /** Devuelve el comando que deshace este, dado el documento ANTES de aplicarlo. */
  invert(before: D): Command<D>;
}

export interface UndoStackOptions {
  readonly maxDepth?: number; // por defecto 100; 0 = sin historial
  readonly groupDelayMs?: number; // por defecto 500 (lo usa COM-003)
  readonly now?: () => number; // por defecto Date.now (para tests)
}

export interface UndoState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null; // label de la entrada superior de deshacer
  readonly redoLabel: string | null;
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly isDirty: boolean;
}

export type UndoListener = (state: UndoState) => void;

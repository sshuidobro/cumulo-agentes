import type { DraftStore } from '@suite/platform';
import { createLogger } from '@suite/shared';
import { draftSavedAt, fromDraft, toDraft } from '../core/annotations/draft';
import { EMPTY_EDITS, type AnnotationEdits } from '../core/annotations/model';
import type { LoadedPdf } from '../engine';
import { msg } from '../ui/messages';
import { nowIso, recoverEdits } from './annotation-actions';
import { useAnnotations } from './annotation-store';
import { askChoice, useChoice } from './choice';
import { useViewer } from './viewer-store';

const log = createLogger('draft-sync');

/** Retraso del guardado del borrador tras el último cambio (PDF-038). */
export const DRAFT_DELAY_MS = 2_000;
/** Los borradores más viejos que esto se borran al arrancar. */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const KEY_PREFIX = 'pdf:';

/** Clave del borrador de un documento: huella del PDF y tamaño del fichero. */
export function draftKey(fingerprint: string, size: number): string {
  return `${KEY_PREFIX}${fingerprint}:${size}`;
}

type DraftChoice = 'recover' | 'discard' | 'keep';

/** Documento abierto cuyos cambios se vigilan. */
interface Tracked {
  readonly key: string;
  readonly name: string;
  readonly pdf: LoadedPdf;
  /** Hay cambios sin guardar según el store de anotaciones. */
  dirty: boolean;
  /** Últimos cambios vistos. Se guardan desde aquí porque el store se reinicia al cambiar de documento. */
  latest: AnnotationEdits;
  /** Conservar el borrador: aviso de recuperación sin decidir, o cerrado con Esc. */
  keep: boolean;
  /** «No guardar»: el borrador ya se ha borrado y no se vuelve a escribir hasta que haya un cambio nuevo. */
  suppressed: boolean;
  /** Diálogo de recuperación visible; se cierra si el documento cambia. */
  shown: { readonly dismiss: () => void } | null;
}

/** Descarta el borrador del documento abierto. Lo usa el aviso de «No guardar» (ver `discardCurrentDraft`). */
let discardCurrent: (() => Promise<void>) | null = null;

/**
 * El usuario ha elegido «No guardar»: borra el borrador del documento abierto antes de seguir, para que
 * un cierre inmediato no lo vuelva a escribir. Sin sincronización activa no hace nada.
 */
export function discardCurrentDraft(): Promise<void> {
  return discardCurrent?.() ?? Promise.resolve();
}

/**
 * Vigila los cambios de anotaciones del documento abierto y los guarda como borrador en el almacén (PDF-038):
 * con debounce de 2 s tras cada cambio y al ocultarse la página. Al abrir un documento con borrador ofrece
 * recuperarlo. Los errores del almacén se registran como aviso y no interrumpen la app.
 * Devuelve la función que detiene la sincronización.
 */
export function startDraftSync(store: DraftStore): () => void {
  let tracked: Tracked | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancelTimer(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  /** Escribe el borrador ya, si hay cambios sin guardar que conservar. */
  function flush(t: Tracked): void {
    cancelTimer();
    if (t.dirty && !t.suppressed) void attempt('put', () => store.put(t.key, toDraft(t.latest, t.name, nowIso())));
  }

  function schedule(t: Tracked): void {
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      flush(t);
    }, DRAFT_DELAY_MS);
  }

  function remove(key: string): Promise<void> {
    return attempt('delete', () => store.delete(key));
  }

  async function read(key: string): Promise<unknown> {
    try {
      return await store.get(key);
    } catch (cause) {
      log.warn('get', cause);
      return undefined;
    }
  }

  /** Cierra la vigilancia de un documento: conserva sus cambios pendientes o borra lo que ya no hace falta. */
  function leave(t: Tracked): void {
    cancelTimer();
    t.shown?.dismiss();
    if (t.dirty) {
      flush(t);
    } else if (!t.keep && !t.suppressed) {
      void remove(t.key);
    }
  }

  /** Espera a que las anotaciones del documento estén importadas. `false` si el documento cambia antes. */
  function whenScanned(t: Tracked): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const stops: (() => void)[] = [];
      const check = (): boolean => {
        const gone = tracked !== t;
        const { scan } = useAnnotations.getState();
        if (!gone && scan !== 'done' && scan !== 'lazy') return false;
        for (const stop of stops) stop();
        resolve(!gone);
        return true;
      };
      stops.push(useAnnotations.subscribe(check), useViewer.subscribe(check));
      check();
    });
  }

  /** Al abrir un documento: si hay borrador válido y no vacío, pregunta si recuperarlo. */
  async function offerRecovery(t: Tracked): Promise<void> {
    const raw = await read(t.key);
    if (tracked !== t || raw === undefined) return;
    const edits = fromDraft(raw);
    const savedAt = draftSavedAt(raw);
    if (edits === null || savedAt === null) {
      log.warn('borrador inválido, se borra', t.key);
      await remove(t.key);
      return;
    }
    if (edits.upserts.size === 0 && edits.removed.size === 0) {
      await remove(t.key);
      return;
    }

    t.keep = true;
    const answer = askChoice<DraftChoice>({
      title: msg.draftFound(t.name, formatWhen(savedAt)),
      options: [
        { label: msg.draftRecover, value: 'recover' },
        { label: msg.draftDiscard, value: 'discard' },
      ],
      cancel: 'keep',
    });
    t.shown = useChoice.getState().active;
    const choice = await answer;
    t.shown = null;
    if (tracked !== t || choice === 'keep') return;

    t.keep = false;
    if (choice === 'discard') {
      t.suppressed = true;
      await remove(t.key);
      return;
    }
    if (!(await whenScanned(t)) || tracked !== t) return;
    recoverEdits(edits);
  }

  /** Descarta el borrador del documento vigilado (ver `discardCurrentDraft`). */
  async function discard(): Promise<void> {
    const t = tracked;
    if (t === null) return;
    cancelTimer();
    t.suppressed = true;
    t.keep = false;
    await remove(t.key);
  }

  const unsubscribeAnnotations = useAnnotations.subscribe((s, prev) => {
    const t = tracked;
    // El store se reinicia al cerrar o abrir un documento (scan 'idle'): eso no es un cambio del usuario.
    if (t === null || s.scan === 'idle' || useViewer.getState().pdf !== t.pdf) return;
    const dirty = s.undo.isDirty;
    const changed = s.edits !== prev.edits;
    if (dirty === t.dirty && !changed) return;
    const wasDirty = t.dirty;
    t.dirty = dirty;
    if (!dirty) {
      cancelTimer();
      if (wasDirty && !t.keep && !t.suppressed) void remove(t.key);
      return;
    }
    t.latest = s.edits;
    if (changed) {
      t.keep = false;
      t.suppressed = false;
    }
    schedule(t);
  });

  const unsubscribeViewer = useViewer.subscribe((s) => {
    const pdf = s.status === 'ready' ? s.pdf : null;
    if (pdf === (tracked?.pdf ?? null)) return;
    const previous = tracked;
    tracked = null;
    if (previous !== null) leave(previous);
    if (pdf !== null && s.file !== null) {
      const t: Tracked = {
        key: draftKey(pdf.fingerprint, s.file.size),
        name: s.file.name,
        pdf,
        dirty: false,
        latest: EMPTY_EDITS,
        keep: false,
        suppressed: false,
        shown: null,
      };
      tracked = t;
      void offerRecovery(t);
    }
  });

  const onPageHide = (): void => {
    if (tracked !== null) flush(tracked);
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') onPageHide();
  };
  const inBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (inBrowser) {
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
  }

  discardCurrent = discard;
  void purgeOld(store);

  return () => {
    unsubscribeAnnotations();
    unsubscribeViewer();
    if (inBrowser) {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    }
    const previous = tracked;
    tracked = null;
    if (previous !== null) leave(previous);
    discardCurrent = null;
  };
}

/** Ejecuta una operación del almacén; un fallo se registra como aviso y no se propaga. */
async function attempt(operation: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (cause) {
    log.warn(operation, cause);
  }
}

/** Al arrancar: borra los borradores de más de 30 días o que no se pueden leer. */
async function purgeOld(store: DraftStore): Promise<void> {
  let keys: readonly string[];
  try {
    keys = await store.keys();
  } catch (cause) {
    log.warn('keys', cause);
    return;
  }
  for (const key of keys) {
    if (!key.startsWith(KEY_PREFIX)) continue;
    let raw: unknown;
    try {
      raw = await store.get(key);
    } catch (cause) {
      log.warn('get', cause);
      continue;
    }
    const savedAt = draftSavedAt(raw);
    if (savedAt === null || Date.now() - Date.parse(savedAt) > DRAFT_MAX_AGE_MS) {
      try {
        await store.delete(key);
      } catch (cause) {
        log.warn('delete', cause);
      }
    }
  }
}

function formatWhen(savedAt: string): string {
  return new Date(savedAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}

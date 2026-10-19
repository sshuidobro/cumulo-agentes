import { useEffect, useRef, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  REVIEW_STATES,
  REVIEW_STATE_LABELS,
  reviewStateOf,
  type Annotation,
  type ReviewState,
} from '../../core/annotations';
import type { PageViewport } from '../../engine/pdfjs';
import {
  closePopup,
  deleteAnnotation,
  getEffective,
  nowIso,
  pageAnnotations,
  updateAnnotation,
} from '../../state/annotation-actions';
import { useAnnotations } from '../../state/annotation-store';
import { setReviewState } from '../../state/reply-actions';
import { IconClose, IconTrash } from '../icons';
import { IconButton } from '../kit/IconButton';
import { MenuButton, type MenuEntry } from '../kit/MenuButton';
import { msg } from '../messages';
import { commentsMsg } from '../messages-comments';
import { formatCommentDate } from './comment-date';
import { isBoxOnPage, pageBox, popupPlacement, type PageSizePx, type PxBox } from './popup-placement';
import { ReplyThread } from './ReplyThread';
import styles from './AnnotationPopup.module.css';

/** Marcador del visor (región con foco): se lleva el foco aquí al borrar el comentario. */
const VIEWER_REGION = '[role="region"]';

export interface AnnotationPopupProps {
  /** Índice de la página (0-based). */
  readonly pageIndex: number;
  /** Viewport de la página con el mismo zoom y rotación que su lienzo (ver `PageView`). */
  readonly viewport: PageViewport;
  /** `false` si la página no está en el área visible: la ventana se cierra. */
  readonly visible: boolean;
}

/**
 * Ventana emergente de comentario de una anotación (PDF-033). Es HTML propio, no un `/Popup` del PDF: no es modal
 * (se puede seguir usando la página). Solo hay una abierta a la vez, en `openPopupId`. Si su anotación deja de estar
 * en la página visible o desaparece, la ventana se cierra.
 */
export function AnnotationPopup({ pageIndex, viewport, visible }: AnnotationPopupProps) {
  const openId = useAnnotations((s) => s.openPopupId);
  // La versión de la página cambia con cada edición (también con cada tecla del comentario): ver `annotation-actions`.
  const version = useAnnotations((s) => s.pageVersion.get(pageIndex) ?? 0);
  const annotation = openId === null ? undefined : pageAnnotations(pageIndex, version).find((a) => a.id === openId);
  const box = annotation === undefined ? null : pageBox(viewport.transform, annotation.rect);
  const page: PageSizePx = { width: viewport.width, height: viewport.height };
  const outside = annotation !== undefined && (!visible || box === null || !isBoxOnPage(box, page));

  useEffect(() => {
    if (outside) closePopup();
  }, [outside]);

  if (annotation === undefined || box === null || outside) return null;
  return <CommentDialog key={annotation.id} annotation={annotation} box={box} page={page} />;
}

interface CommentDialogProps {
  readonly annotation: Annotation;
  readonly box: PxBox;
  readonly page: PageSizePx;
}

function CommentDialog({ annotation, box, page }: CommentDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const { id, author, modified } = annotation;
  const placement = popupPlacement(box, page);
  // Estado vigente de revisión (PDF-109); `None` si no hay ninguno.
  const review: ReviewState = reviewStateOf(getEffective(), id)?.state ?? 'None';

  // Al abrir, el foco va al comentario para escribir de inmediato.
  useEffect(() => {
    textRef.current?.focus();
  }, []);

  function onChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    const current = getEffective().get(id);
    if (current === undefined) return;
    // Una ráfaga de teclas es una sola entrada de deshacer («escribir comentario») gracias a la clave de agrupación.
    updateAnnotation({ ...current, contents: event.currentTarget.value, modified: nowIso() }, 'escribir comentario', `note-text:${id}`);
  }

  /** Cierra la ventana y devuelve el foco a la zona activa de la anotación. */
  function closeAndFocusZone(): void {
    const zone = findZone(dialogRef.current, id);
    closePopup();
    zone?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Esc cierra la ventana aquí; no debe llegar a los atajos de la ventana (p. ej. dejar la herramienta).
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeAndFocusZone();
  }

  function onDelete(): void {
    const viewer = dialogRef.current?.closest<HTMLElement>(VIEWER_REGION) ?? null;
    closePopup();
    deleteAnnotation(id);
    viewer?.focus();
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={msg.popupLabel(author)}
      className={styles.popup}
      style={{ left: placement.left, top: placement.top, width: placement.width }}
    >
      <header className={styles.header}>
        <span className={styles.author}>{author}</span>
        <span className={styles.status} aria-live="polite">
          {review === 'None' ? '' : commentsMsg.stateLabel(review)}
        </span>
        <time dateTime={modified}>{formatCommentDate(modified)}</time>
      </header>
      <textarea
        ref={textRef}
        className={styles.text}
        aria-label={msg.popupText}
        value={annotation.contents}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
      <ReplyThread parentId={id} onEscape={closeAndFocusZone} />
      <footer className={styles.footer}>
        <div className={styles.stateWrap}>
          <MenuButton label={commentsMsg.stateMenu} entries={stateEntries(id, review)}>
            <span className={styles.stateText}>{commentsMsg.stateMenu}</span>
          </MenuButton>
        </div>
        <IconButton label={msg.popupDelete} onClick={onDelete}>
          <IconTrash />
        </IconButton>
        <IconButton label={msg.popupClose} onClick={closeAndFocusZone}>
          <IconClose />
        </IconButton>
      </footer>
    </div>
  );
}

/**
 * Zona activa (SVG) de la anotación `id`. `PageView` pone la ventana y la capa de anotaciones como hermanas
 * dentro del marco de la página, así que la zona se busca entre los hermanos de la ventana.
 */
function findZone(dialog: HTMLElement | null, id: string): HTMLElement | null {
  const frame = dialog?.parentElement ?? null;
  if (frame === null) return null;
  for (const el of frame.querySelectorAll<HTMLElement>('[data-annot-id]')) {
    if (el.getAttribute('data-annot-id') === id) return el;
  }
  return null;
}

/** Opciones del menú «Estado» (PDF-109): las cinco, con la vigente marcada. */
function stateEntries(parentId: string, current: ReviewState): readonly MenuEntry[] {
  return REVIEW_STATES.map((state): MenuEntry => ({
    kind: 'radio',
    label: state === 'None' ? commentsMsg.stateNone : REVIEW_STATE_LABELS[state],
    checked: state === current,
    onSelect: () => setReviewState(parentId, state),
  }));
}

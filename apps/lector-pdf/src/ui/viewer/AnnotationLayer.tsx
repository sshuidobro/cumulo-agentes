import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { translateAnnotation, type Annotation, type AnnotationType } from '../../core/annotations/model';
import type { PageViewport } from '../../engine/pdfjs';
import { deleteAnnotation, getEffective, pageAnnotations, select, updateAnnotation } from '../../state/annotation-actions';
import { useAnnotations } from '../../state/annotation-store';
import { msg } from '../messages';
import { annotationOutline } from './annotation-geometry';
import { AnnotationShape, ZoneShape } from './annotation-shapes';
import styles from './AnnotationLayer.module.css';
import viewerStyles from './Viewer.module.css';

/** Movimiento mínimo del puntero para que un clic se convierta en arrastre, en píxeles. */
const DRAG_THRESHOLD_PX = 3;
/** Paso de las flechas, en puntos PDF; con Mayús, diez veces más. */
const ARROW_STEP_PT = 1;
const ARROW_STEP_SHIFT_PT = 10;
/** Caracteres del comentario que entran en el nombre accesible. */
const LABEL_CONTENTS_CHARS = 80;
/** Tipos que se pueden mover. El marcado de texto va unido al texto y no se mueve. */
const MOVABLE: ReadonlySet<AnnotationType> = new Set<AnnotationType>(['note', 'freetext', 'ink']);
/** Marcador del foco tras borrar: se lleva el foco al visor (la región del documento). */
const FOCUS_VIEWER = 'viewer';

export interface AnnotationLayerProps {
  /** Índice de la página (0-based). */
  readonly pageIndex: number;
  /** Viewport de la página con el mismo zoom y rotación que su lienzo (ver `PageView`). */
  readonly viewport: PageViewport;
}

/** Arrastre en curso: solo se convierte en movimiento al pasar el umbral. */
interface Drag {
  readonly startX: number;
  readonly startY: number;
  active: boolean;
}

/** Desplazamiento en vista previa de la anotación que se arrastra, en puntos PDF. */
interface Offset {
  readonly id: string;
  readonly dx: number;
  readonly dy: number;
}

/**
 * Capa SVG de las anotaciones de una página, encima del lienzo y la capa de texto. Dibuja las nuevas y las
 * modificadas; las del fichero sin tocar las sigue dibujando pdf.js. Cada anotación soportada tiene una zona
 * activa (botón con foco) para seleccionarla, moverla o borrarla con ratón o teclado.
 */
export function AnnotationLayer({ pageIndex, viewport }: AnnotationLayerProps) {
  // La versión de la página cambia cuando sus anotaciones cambian (importación o edición): ver `annotation-actions`.
  const version = useAnnotations((s) => s.pageVersion.get(pageIndex) ?? 0);
  const edits = useAnnotations((s) => s.edits);
  const selectedId = useAnnotations((s) => s.selectedId);
  // Cacheadas por versión de la página (ver `pageAnnotations`): cambiar la selección no recalcula la lista.
  const items = pageAnnotations(pageIndex, version);

  const [stopId, setStopId] = useState<string | null>(null);
  const [offset, setOffset] = useState<Offset | null>(null);
  const zones = useRef(new Map<string, SVGGElement>());
  const layerRef = useRef<SVGSVGElement>(null);
  /** Dónde poner el foco tras un render (p. ej. tras borrar): id de zona, `FOCUS_VIEWER` o nada. */
  const pendingFocus = useRef<string | null>(null);
  /** Quita los escuchadores del arrastre en curso (si lo hay). */
  const endDrag = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      endDrag.current?.();
    },
    [],
  );

  // Aplica el foco pendiente (p. ej. tras borrar) una vez pintado el render, cuando la zona de destino ya existe.
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    if (target === FOCUS_VIEWER) {
      layerRef.current?.closest<HTMLElement>('[role="region"]')?.focus();
      return;
    }
    zones.current.get(target)?.focus();
  });

  const selectedHere = items.some((a) => a.id === selectedId);
  const tabStop = selectedHere ? selectedId : items.some((a) => a.id === stopId) ? stopId : (items[0]?.id ?? null);

  /** Delta en puntos PDF de un desplazamiento en píxeles del visor (respeta zoom y rotación). */
  function pdfDelta(dxPx: number, dyPx: number): readonly [number, number] {
    const origin = viewport.convertToPdfPoint(0, 0);
    const moved = viewport.convertToPdfPoint(dxPx, dyPx);
    return [(moved[0] ?? 0) - (origin[0] ?? 0), (moved[1] ?? 0) - (origin[1] ?? 0)];
  }

  function moveAnnotation(id: string, dx: number, dy: number, mergeKey?: string): void {
    if (dx === 0 && dy === 0) return;
    const current = getEffective().get(id);
    if (current === undefined || !MOVABLE.has(current.type)) return;
    updateAnnotation(translateAnnotation(current, dx, dy), 'mover', mergeKey);
  }

  function beginPointer(event: PointerEvent<SVGGElement>, a: Annotation): void {
    if (event.button !== 0) return;
    select(a.id);
    if (!MOVABLE.has(a.type)) return;
    event.preventDefault();

    endDrag.current?.();
    const drag: Drag = { startX: event.clientX, startY: event.clientY, active: false };
    const onMove = (e: globalThis.PointerEvent): void => {
      const dxPx = e.clientX - drag.startX;
      const dyPx = e.clientY - drag.startY;
      if (!drag.active && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return;
      drag.active = true;
      const [dx, dy] = pdfDelta(dxPx, dyPx);
      setOffset({ id: a.id, dx, dy });
    };
    const onEnd = (e: globalThis.PointerEvent): void => {
      stopListening();
      setOffset(null);
      if (!drag.active || e.type === 'pointercancel') return;
      const [dx, dy] = pdfDelta(e.clientX - drag.startX, e.clientY - drag.startY);
      moveAnnotation(a.id, dx, dy);
    };
    // El arrastre sigue al puntero aunque salga de la zona: los escuchadores van en `window`.
    const stopListening = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      endDrag.current = null;
    };
    endDrag.current = stopListening;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }

  function onZoneKeyDown(event: KeyboardEvent<SVGGElement>, a: Annotation, index: number): void {
    const stopHere = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    switch (event.key) {
      case 'Enter':
      case ' ':
        stopHere();
        select(a.id);
        return;
      case 'Delete':
      case 'Backspace': {
        // Supr borra la zona enfocada, seleccionada o no (p. ej. llegada con Tab). `deleteAnnotation` limpia la selección si era ella.
        stopHere();
        // Tras borrar, el foco pasa a la siguiente anotación de la página, o a la anterior, o al visor.
        const next = items[index + 1] ?? items[index - 1];
        pendingFocus.current = next?.id ?? FOCUS_VIEWER;
        deleteAnnotation(a.id);
        return;
      }
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        const movable = a.id === selectedId && MOVABLE.has(a.type);
        if (movable) {
          stopHere();
          const step = event.shiftKey ? ARROW_STEP_SHIFT_PT : ARROW_STEP_PT;
          const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
          const dy = event.key === 'ArrowDown' ? -step : event.key === 'ArrowUp' ? step : 0;
          moveAnnotation(a.id, dx, dy, `move:${a.id}`);
          return;
        }
        // Sin anotación movible seleccionada, ↑/↓ recorren las zonas de la página (roving tabindex).
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          const neighbour = items[index + (event.key === 'ArrowDown' ? 1 : -1)];
          if (neighbour === undefined) return;
          stopHere();
          setStopId(neighbour.id);
          zones.current.get(neighbour.id)?.focus();
        }
        return;
      }
      default:
    }
  }

  return (
    <svg
      ref={layerRef}
      className={viewerStyles.annotationLayer}
      width={viewport.width}
      height={viewport.height}
    >
      {items.length > 0 && (
        <g transform={`matrix(${viewport.transform.join(' ')})`}>
          {items.map((a, index) => {
            const drawn = a.origin.kind === 'new' || edits.upserts.has(a.id);
            const shift = offset !== null && offset.id === a.id ? `translate(${offset.dx} ${offset.dy})` : undefined;
            const selected = a.id === selectedId;
            const outline = annotationOutline(a);
            return (
              <g key={a.id} transform={shift}>
                {drawn && <AnnotationShape a={a} />}
                <g
                  ref={(el) => {
                    if (el !== null) zones.current.set(a.id, el);
                    else zones.current.delete(a.id);
                  }}
                  role="button"
                  tabIndex={a.id === tabStop ? 0 : -1}
                  aria-label={zoneLabel(a)}
                  data-annot-id={a.id}
                  className={styles.zoneGroup}
                  onPointerDown={(e) => {
                    beginPointer(e, a);
                  }}
                  onKeyDown={(e) => {
                    onZoneKeyDown(e, a, index);
                  }}
                  onFocus={() => {
                    setStopId(a.id);
                  }}
                >
                  <ZoneShape a={a} />
                  <rect
                    x={outline[0]}
                    y={outline[1]}
                    width={outline[2] - outline[0]}
                    height={outline[3] - outline[1]}
                    className={selected ? styles.outlineOn : styles.outline}
                  />
                </g>
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}

/** Nombre accesible de la zona: «Resaltado de Ana: primeros 80 caracteres del comentario». */
function zoneLabel(a: Annotation): string {
  const name = msg.annotationName(msg.annotationKinds[a.type], a.author);
  const excerpt = Array.from(a.contents).slice(0, LABEL_CONTENTS_CHARS).join('');
  return excerpt === '' ? name : `${name}: ${excerpt}`;
}

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  resizeSignature,
  translateAnnotation,
  type Annotation,
  type AnnotationType,
  type FreeTextAnnotation,
  type RectPt,
  type SignatureAnnotation,
} from '../../core/annotations/model';
import { freeTextClickRect, freeTextDragRect, resizeFreeTextRect } from '../../core/annotations/freetext';
import { newInkAnnotation } from '../../core/annotations/ink';
import { newNoteAnnotation, noteRectAt } from '../../core/annotations/note';
import { simplifyPath } from '../../core/annotations/simplify';
import { resizeKeepingAspect } from '../../core/signature/signature';
import type { PageViewport } from '../../engine/pdfjs';
import {
  addAnnotation,
  beginEditFreeText,
  beginFreeText,
  deleteAnnotation,
  getEffective,
  newAnnotationId,
  nowIso,
  openPopup,
  pageAnnotations,
  placeSignature,
  resizeFreeText,
  select,
  setTool,
  updateAnnotation,
} from '../../state/annotation-actions';
import { useAnnotations } from '../../state/annotation-store';
import { msg } from '../messages';
import { annotationOutline, cssColor } from './annotation-geometry';
import { AnnotationShape, ZoneShape } from './annotation-shapes';
import { FreeTextEditor } from './FreeTextEditor';
import { toPx } from './freetext-box';
import { drawInkSegments, prepareInkCanvas, type InkDrawingContext } from './ink-preview';
import styles from './AnnotationLayer.module.css';
import viewerStyles from './Viewer.module.css';

/** Movimiento mínimo del puntero para que un clic se convierta en arrastre, en píxeles. */
const DRAG_THRESHOLD_PX = 3;
/** Movimiento mínimo para que un clic con «Texto» se convierta en un cuadro arrastrado (PDF-034), en píxeles. */
const FREETEXT_DRAG_PX = 5;
/** Lado del tirador de tamaño de un texto libre, en píxeles. */
const HANDLE_PX = 8;
/** Paso de las flechas, en puntos PDF; con Mayús, diez veces más. */
const ARROW_STEP_PT = 1;
const ARROW_STEP_SHIFT_PT = 10;
/** Caracteres del comentario que entran en el nombre accesible. */
const LABEL_CONTENTS_CHARS = 80;
/** Caracteres del comentario que muestra el `title` nativo al pasar el ratón (PDF-033). */
const TOOLTIP_CHARS = 200;
/** Tipos que se pueden mover. El marcado de texto va unido al texto y no se mueve. */
const MOVABLE: ReadonlySet<AnnotationType> = new Set<AnnotationType>(['note', 'freetext', 'ink', 'signature']);
/** Tipos con tirador de tamaño en la esquina inferior derecha cuando están seleccionados. */
type Resizable = FreeTextAnnotation | SignatureAnnotation;
/** Marcador del foco tras borrar: se lleva el foco al visor (la región del documento). */
const FOCUS_VIEWER = 'viewer';
/** Tolerancia de la simplificación de un trazo a mano alzada al soltar, en puntos PDF (PDF-035). */
const INK_TOLERANCE_PT = 0.5;
/** Un trazo necesita al menos dos puntos (cuatro coordenadas); un clic sin arrastre no crea dibujo. */
const INK_MIN_COORDS = 4;

/** Trazo a mano alzada en curso (PDF-035). Los puntos van en puntos PDF, ya recortados a la página. */
interface InkStroke {
  readonly pointerId: number;
  readonly touch: boolean;
  /** Caja del lienzo en píxeles, para convertir las coordenadas del puntero. */
  readonly box: DOMRect;
  /** `[x0, y0, x1, y1, ...]` en puntos PDF. */
  readonly points: number[];
  /** Petición de animación pendiente para la vista previa, o `null`. */
  frame: number | null;
  /** Contexto del lienzo de la vista previa; `null` hasta que el lienzo existe (PDF-076). */
  ctx: InkDrawingContext | null;
  /** Coordenadas de `points` ya dibujadas en la vista previa (PDF-076). */
  drawn: number;
}

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

/** Cambio de tamaño en vista previa de un texto libre, en puntos PDF. */
interface Resizing {
  readonly id: string;
  readonly rect: RectPt;
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
  // Cuadro de texto libre en edición, si es de esta página (PDF-034).
  const editing = useAnnotations((s) => s.editing);
  const editingHere = editing !== null && editing.base.pageIndex === pageIndex ? editing : null;
  // Color y grosor del dibujo nuevo (PDF-035); la vista previa del trazo los usa.
  const inkColor = useAnnotations((s) => s.colors.ink);
  const inkWidth = useAnnotations((s) => s.inkWidth);

  const [stopId, setStopId] = useState<string | null>(null);
  const [offset, setOffset] = useState<Offset | null>(null);
  /** Cuadro que se traza con la herramienta «Texto» mientras se arrastra, en puntos PDF (PDF-034). */
  const [sketch, setSketch] = useState<RectPt | null>(null);
  /** Tirador de tamaño en curso: id del texto libre y rectángulo de vista previa (PDF-034). */
  const [resizing, setResizing] = useState<Resizing | null>(null);
  /** Hay un trazo a mano alzada en curso: monta el lienzo de la vista previa (PDF-035, PDF-076). */
  const [inkActive, setInkActive] = useState(false);
  /** Lienzo temporal de la vista previa del trazo; solo existe mientras se traza (PDF-076). */
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
  const zones = useRef(new Map<string, SVGGElement>());
  const layerRef = useRef<SVGSVGElement>(null);
  /** Dónde poner el foco tras un render (p. ej. tras borrar): id de zona, `FOCUS_VIEWER` o nada. */
  const pendingFocus = useRef<string | null>(null);
  /** Quita los escuchadores del arrastre en curso (si lo hay). */
  const endDrag = useRef<(() => void) | null>(null);
  /** Trazo a mano alzada en curso, si lo hay (PDF-035). */
  const inkStroke = useRef<InkStroke | null>(null);

  useEffect(
    () => () => {
      endDrag.current?.();
      // Desmontar la página a mitad de un trazo lo descarta.
      const stroke = inkStroke.current;
      if (stroke?.frame != null) cancelAnimationFrame(stroke.frame);
      inkStroke.current = null;
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

  /** Sigue el puntero en `window` hasta que se suelta; `onEnd` recibe el evento final (`pointerup` o `pointercancel`). */
  function followPointer(
    onMove: (e: globalThis.PointerEvent) => void,
    onEnd: (e: globalThis.PointerEvent) => void,
  ): void {
    endDrag.current?.();
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      endDrag.current = null;
    };
    const finish = (e: globalThis.PointerEvent): void => {
      stop();
      onEnd(e);
    };
    endDrag.current = stop;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  function moveAnnotation(id: string, dx: number, dy: number, mergeKey?: string): void {
    if (dx === 0 && dy === 0) return;
    const current = getEffective().get(id);
    if (current === undefined || !MOVABLE.has(current.type)) return;
    updateAnnotation(translateAnnotation(current, dx, dy), 'mover', mergeKey);
  }

  /**
   * Con la herramienta «Nota», un clic en la página crea una nota (ver `createNoteAt`); con «Dibujar», el trazo empieza
   * aunque el puntero caiga sobre una anotación (ver `beginInk`). En ambos casos la zona no selecciona ni arrastra.
   */
  function beginPointer(event: PointerEvent<SVGGElement>, a: Annotation): void {
    const tool = useAnnotations.getState().tool;
    if (event.button !== 0 || tool === 'note' || tool === 'ink' || tool === 'signature') return;
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

  /**
   * Herramienta «Texto» (PDF-034): un clic crea un cuadro de 200 pt con la esquina superior izquierda en el punto;
   * arrastrar más de 5 px crea el rectángulo arrastrado. Abre el editor en el sitio: el cuadro se añade al confirmar.
   */
  function beginFreeTextCreate(event: PointerEvent<SVGSVGElement>): void {
    const state = useAnnotations.getState();
    if (event.button !== 0 || state.tool !== 'freetext') return;
    // Con un editor abierto, el clic solo confirma su texto (lo hace la pérdida de foco); no crea otro cuadro.
    if (state.editing !== null) return;
    // Un clic sobre una anotación o sobre su tirador es de esa anotación, no de una nueva.
    if (event.target instanceof Element && event.target.closest('[data-annot-id], [data-resize-id]') !== null) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    const toPdf = (clientX: number, clientY: number): readonly [number, number] => {
      const [x = 0, y = 0] = viewport.convertToPdfPoint(clientX - box.left, clientY - box.top);
      return [x, y];
    };
    const [sx, sy] = toPdf(event.clientX, event.clientY);
    const startX = event.clientX;
    const startY = event.clientY;
    const bounds = pageBoundsPt();
    followPointer(
      (e) => {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) <= FREETEXT_DRAG_PX) return;
        const [ex, ey] = toPdf(e.clientX, e.clientY);
        setSketch(freeTextDragRect(sx, sy, ex, ey, useAnnotations.getState().fontSize));
      },
      (e) => {
        setSketch(null);
        if (e.type === 'pointercancel') return;
        const fontSize = useAnnotations.getState().fontSize;
        const dragged = Math.hypot(e.clientX - startX, e.clientY - startY) > FREETEXT_DRAG_PX;
        const [ex, ey] = toPdf(e.clientX, e.clientY);
        const rect = dragged ? freeTextDragRect(sx, sy, ex, ey, fontSize) : freeTextClickRect(sx, sy, fontSize, bounds);
        beginFreeText(pageIndex, rect, bounds[1]);
      },
    );
  }

  /**
   * Tirador de tamaño de un texto libre (PDF-034) o de una firma (PDF-043): arrastrarlo cambia ancho y alto, con la
   * esquina superior izquierda fija. La firma mantiene su proporción.
   */
  function beginResize(event: PointerEvent<SVGRectElement>, a: Resizable): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const original = a.rect;
    const rectAt = (e: globalThis.PointerEvent): RectPt => {
      // Arrastrar hacia abajo (PDF y decreciente) hace más alto el cuadro: dh = -dy.
      const [dx, dy] = pdfDelta(e.clientX - startX, e.clientY - startY);
      return a.type === 'freetext'
        ? resizeFreeTextRect(original, dx, -dy, a.fontSize)
        : resizeKeepingAspect(original, 'se', dx, -dy);
    };
    followPointer(
      (e) => {
        setResizing({ id: a.id, rect: rectAt(e) });
      },
      (e) => {
        setResizing(null);
        if (e.type === 'pointercancel') return;
        if (a.type === 'freetext') resizeFreeText(a.id, rectAt(e));
        else updateAnnotation(resizeSignature(a, rectAt(e)), 'cambiar tamaño de la firma');
      },
    );
  }

  /** Clic o arrastre sobre la capa: primero la herramienta «Nota», luego «Texto», «Dibujar» y «Firmar» (cada una comprueba la suya). */
  function onLayerPointerDown(event: PointerEvent<SVGSVGElement>): void {
    createNoteAt(event);
    beginFreeTextCreate(event);
    beginInk(event);
    createSignatureAt(event);
  }

  /**
   * Herramienta «Firmar» (PDF-043): un clic en la página coloca la firma pendiente centrada en el punto, la selecciona
   * y devuelve la herramienta a «ninguna».
   */
  function createSignatureAt(event: PointerEvent<SVGSVGElement>): void {
    const state = useAnnotations.getState();
    if (event.button !== 0 || state.tool !== 'signature' || state.pendingSignature === null) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    const [x = 0, y = 0] = viewport.convertToPdfPoint(event.clientX - box.left, event.clientY - box.top);
    const [x1, y1, x2, y2] = pageBoundsPt();
    placeSignature(pageIndex, [x, y], [x1, y1, x2, y2]);
  }

  /** Guarda un punto del puntero en el trazo, en puntos PDF y recortado a la página. Un punto repetido no se guarda. */
  function addInkSample(stroke: InkStroke, clientX: number, clientY: number): void {
    const [x1, y1, x2, y2] = pageBoundsPt();
    const [x = 0, y = 0] = viewport.convertToPdfPoint(clientX - stroke.box.left, clientY - stroke.box.top);
    const px = Math.min(Math.max(x, x1), x2);
    const py = Math.min(Math.max(y, y1), y2);
    const n = stroke.points.length;
    if (n >= 2 && stroke.points[n - 2] === px && stroke.points[n - 1] === py) return;
    stroke.points.push(px, py);
  }

  /**
   * Pide dibujar la vista previa del trazo en el siguiente frame; varios eventos en el mismo frame cuestan una sola
   * pasada. Dibuja solo los segmentos nuevos en el lienzo temporal: no re-renderiza la capa (PDF-076).
   */
  function requestInkPreview(stroke: InkStroke): void {
    if (stroke.frame !== null) return;
    stroke.frame = requestAnimationFrame(() => {
      stroke.frame = null;
      if (inkStroke.current !== stroke) return;
      const canvas = inkCanvasRef.current;
      if (stroke.ctx === null && canvas !== null) {
        stroke.ctx = prepareInkCanvas(canvas, viewport, window.devicePixelRatio || 1, {
          color: cssColor(inkColor),
          widthPt: inkWidth,
        });
      }
      if (stroke.ctx !== null) stroke.drawn = drawInkSegments(stroke.ctx, stroke.points, stroke.drawn);
    });
  }

  /** Quita el trazo en curso y su vista previa, sin crear nada. */
  function clearInk(): void {
    const stroke = inkStroke.current;
    if (stroke === null) return;
    if (stroke.frame !== null) cancelAnimationFrame(stroke.frame);
    inkStroke.current = null;
    setInkActive(false);
  }

  /**
   * Herramienta «Dibujar» (PDF-035): al bajar el puntero empieza un trazo a mano alzada, con ratón, lápiz o dedo. La
   * herramienta sigue activa tras cada trazo. Un segundo puntero durante un trazo se ignora; con dos dedos el gesto es
   * del navegador, así que el trazo en curso se descarta.
   */
  function beginInk(event: PointerEvent<SVGSVGElement>): void {
    if (useAnnotations.getState().tool !== 'ink') return;
    const touch = event.pointerType === 'touch';
    if (inkStroke.current !== null) {
      if (touch) clearInk();
      return;
    }
    if (event.button !== 0 && !touch) return;
    event.preventDefault();
    const svg = event.currentTarget;
    // Con el puntero capturado, los movimientos llegan a la capa aunque salgan de ella.
    svg.setPointerCapture?.(event.pointerId);
    const stroke: InkStroke = {
      pointerId: event.pointerId,
      touch,
      box: svg.getBoundingClientRect(),
      points: [],
      frame: null,
      ctx: null,
      drawn: 0,
    };
    inkStroke.current = stroke;
    setInkActive(true);
    addInkSample(stroke, event.clientX, event.clientY);
  }

  /** Movimiento del trazo: toma todos los puntos intermedios que el navegador haya agrupado (lápiz de alta frecuencia). */
  function moveInk(event: PointerEvent<SVGSVGElement>): void {
    const stroke = inkStroke.current;
    if (stroke === null || event.pointerId !== stroke.pointerId) return;
    const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [];
    if (coalesced.length === 0) {
      addInkSample(stroke, event.clientX, event.clientY);
    } else {
      for (const sample of coalesced) addInkSample(stroke, sample.clientX, sample.clientY);
    }
    requestInkPreview(stroke);
  }

  /** Suelta el puntero: el trazo se simplifica y se añade como un dibujo (una única entrada de deshacer). */
  function endInk(event: PointerEvent<SVGSVGElement>): void {
    const stroke = inkStroke.current;
    if (stroke === null || event.pointerId !== stroke.pointerId) return;
    addInkSample(stroke, event.clientX, event.clientY);
    clearInk();
    const path = simplifyPath(stroke.points, INK_TOLERANCE_PT);
    if (path.length < INK_MIN_COORDS) return;
    const { colors, inkWidth: width, author } = useAnnotations.getState();
    addAnnotation(
      newInkAnnotation({
        id: newAnnotationId(),
        pageIndex,
        paths: [path],
        width,
        color: colors.ink,
        author,
        now: nowIso(),
      }),
    );
  }

  /** El navegador ha cancelado el puntero (p. ej. se ha cedido a un gesto): el trazo se descarta sin dibujar. */
  function cancelInkPointer(event: PointerEvent<SVGSVGElement>): void {
    if (inkStroke.current?.pointerId === event.pointerId) clearInk();
  }

  /**
   * Herramienta «Nota» (PDF-033): un clic crea una nota de 20 × 20 pt con la esquina superior izquierda en el punto,
   * la selecciona, abre su ventana de comentario y devuelve la herramienta a «ninguna», como Acrobat.
   */
  function createNoteAt(event: PointerEvent<SVGSVGElement>): void {
    if (event.button !== 0 || useAnnotations.getState().tool !== 'note') return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    const [x = 0, y = 0] = viewport.convertToPdfPoint(event.clientX - box.left, event.clientY - box.top);
    const { colors, author } = useAnnotations.getState();
    const note = newNoteAnnotation({
      id: newAnnotationId(),
      pageIndex,
      rect: noteRectAt(x, y, pageBoundsPt()),
      color: colors.note,
      author,
      now: nowIso(),
    });
    addAnnotation(note);
    setTool('none');
    select(note.id);
    openPopup(note.id);
  }

  /** Página completa en puntos PDF, con los ejes ordenados (la rotación de vista los invierte). */
  function pageBoundsPt(): RectPt {
    const [ax = 0, ay = 0] = viewport.convertToPdfPoint(0, 0);
    const [bx = 0, by = 0] = viewport.convertToPdfPoint(viewport.width, viewport.height);
    return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
  }

  function onZoneKeyDown(event: KeyboardEvent<SVGGElement>, a: Annotation, index: number): void {
    const stopHere = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    switch (event.key) {
      case 'Enter':
        // Intro abre la ventana de comentario (como el doble clic) y deja la anotación seleccionada.
        // Un texto libre se edita en el sitio (PDF-034).
        stopHere();
        select(a.id);
        if (a.type === 'freetext') beginEditFreeText(a.id, pageBoundsPt()[1]);
        else openPopup(a.id);
        return;
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
        const selected = a.id === selectedId;
        // Mayús+flechas cambian el tamaño de un texto libre seleccionado, 1 pt cada vez (PDF-034).
        if (selected && a.type === 'freetext' && event.shiftKey) {
          stopHere();
          const dw = event.key === 'ArrowRight' ? ARROW_STEP_PT : event.key === 'ArrowLeft' ? -ARROW_STEP_PT : 0;
          const dh = event.key === 'ArrowDown' ? ARROW_STEP_PT : event.key === 'ArrowUp' ? -ARROW_STEP_PT : 0;
          resizeFreeText(a.id, resizeFreeTextRect(a.rect, dw, dh, a.fontSize), `resize:${a.id}`);
          return;
        }
        const movable = selected && MOVABLE.has(a.type);
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

  // Tirador del texto libre o de la firma seleccionados, en la esquina inferior derecha (PDF-034, PDF-043); no aparece mientras se edita.
  const selectedResizable = items.find((a): a is Resizable => a.id === selectedId && (a.type === 'freetext' || a.type === 'signature'));
  const handleRect =
    selectedResizable === undefined ? undefined : resizing?.id === selectedResizable.id ? resizing.rect : selectedResizable.rect;
  const handle =
    selectedResizable === undefined || handleRect === undefined || editingHere !== null
      ? null
      : { a: selectedResizable, ...toPx(viewport.transform, handleRect) };

  return (
    <>
      <svg
        ref={layerRef}
        className={viewerStyles.annotationLayer}
        width={viewport.width}
        height={viewport.height}
        onPointerDown={onLayerPointerDown}
        onPointerMove={moveInk}
        onPointerUp={endInk}
        onPointerCancel={cancelInkPointer}
      >
        {sketch !== null && (
          <g transform={`matrix(${viewport.transform.join(' ')})`}>
            <rect x={sketch[0]} y={sketch[1]} width={sketch[2] - sketch[0]} height={sketch[3] - sketch[1]} className={styles.sketch} />
          </g>
        )}
        {items.length > 0 && (
          <g transform={`matrix(${viewport.transform.join(' ')})`}>
            {items.map((a, index) => {
              // Un texto que se edita en el sitio no se dibuja: lo muestra el editor.
              const drawn = (a.origin.kind === 'new' || edits.upserts.has(a.id)) && editingHere?.base.id !== a.id;
              const shift = offset !== null && offset.id === a.id ? `translate(${offset.dx} ${offset.dy})` : undefined;
              const selected = a.id === selectedId;
              const view = resizing?.id === a.id ? { ...a, rect: resizing.rect } : a;
              const outline = annotationOutline(view);
              return (
                <g key={a.id} transform={shift}>
                  {drawn && <AnnotationShape a={view} />}
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
                    onDoubleClick={() => {
                      if (a.type === 'freetext') beginEditFreeText(a.id, pageBoundsPt()[1]);
                      else openPopup(a.id);
                    }}
                  >
                    {a.contents !== '' && <title>{Array.from(a.contents).slice(0, TOOLTIP_CHARS).join('')}</title>}
                    <ZoneShape a={view} />
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
        {handle !== null && (
          <rect
            x={handle.x - HANDLE_PX / 2}
            y={handle.y - HANDLE_PX / 2}
            width={HANDLE_PX}
            height={HANDLE_PX}
            role="button"
            tabIndex={-1}
            aria-label={msg.resizeHandle}
            data-resize-id={handle.a.id}
            className={styles.handle}
            onPointerDown={(e) => {
              beginResize(e, handle.a);
            }}
          />
        )}
      </svg>
      {inkActive && <canvas ref={inkCanvasRef} className={styles.inkPreview} data-testid="ink-preview" aria-hidden="true" />}
    {editingHere !== null && <FreeTextEditor key={editingHere.base.id} editing={editingHere} viewport={viewport} />}
    </>
  );
}

/** Nombre accesible de la zona: «Resaltado de Ana: primeros 80 caracteres del comentario». */
function zoneLabel(a: Annotation): string {
  const kind = a.type === 'line' && a.endings.some((e) => e !== 'None') ? msg.annotationArrowKind : msg.annotationKinds[a.type];
  const name = msg.annotationName(kind, a.author);
  const excerpt = Array.from(a.contents).slice(0, LABEL_CONTENTS_CHARS).join('');
  return excerpt === '' ? name : `${name}: ${excerpt}`;
}

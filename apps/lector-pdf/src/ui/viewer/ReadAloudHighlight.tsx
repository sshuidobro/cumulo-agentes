import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Rotation } from '../../core/rotation';
import type { SpeechChunk } from '../../core/read-aloud/chunks';
import type { TextLayerHandle } from '../../engine/text';
import { goToPage } from '../../state/navigation';
import { useReadAloud } from '../../state/read-aloud-actions';
import * as registry from './text-layer-registry';
import { rangeForMatch } from './SearchHighlights';
import './read-aloud-highlight.css';

/** Con el fragmento revelado, queda a esta fracción de la altura de la página bajo el borde del visor. */
const REVEAL_OFFSET = 0.3;

/** Fragmentos ya llevados a la vista: cada fragmento se revela como mucho una vez (aunque se vuelva a montar la página). */
const revealed = new WeakSet<SpeechChunk>();

export interface ReadAloudHighlightProps {
  /** Índice de la página (0-based). */
  readonly index: number;
  /** Zoom efectivo del visor. */
  readonly zoom: number;
  /** Rotación de vista (se suma a la de la página). */
  readonly rotation: Rotation;
}

/** Rectángulo en píxeles relativos a la página. */
interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** El fragmento en pantalla: su caja envolvente (una sola por fragmento) y el rectángulo de cada una de sus líneas. */
interface Highlight {
  readonly bounds: Box;
  readonly lines: readonly Box[];
}

/** Medidas del fragmento en la página: el resaltado, la primera línea (en pantalla) y el origen de la página. */
interface Measured {
  readonly highlight: Highlight;
  readonly first: DOMRect;
  readonly origin: DOMRect;
}

/**
 * Une los trozos de un mismo renglón (pdf.js parte la línea en varios nodos) para que cada línea se pinte una vez.
 * Dos trozos son del mismo renglón si su franja vertical se solapa en más de la mitad de su altura.
 */
function sameLine(a: DOMRect, b: DOMRect): boolean {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return overlap > Math.min(a.height, b.height) / 2;
}

function mergeLines(rects: readonly DOMRect[], origin: DOMRect): Box[] {
  const lines: { rect: DOMRect; left: number; right: number; top: number; bottom: number }[] = [];
  for (const rect of rects) {
    const last = lines.at(-1);
    if (last !== undefined && sameLine(last.rect, rect)) {
      last.left = Math.min(last.left, rect.left);
      last.right = Math.max(last.right, rect.right);
      last.top = Math.min(last.top, rect.top);
      last.bottom = Math.max(last.bottom, rect.bottom);
    } else {
      lines.push({ rect, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
    }
  }
  return lines.map((line) => ({
    left: line.left - origin.left,
    top: line.top - origin.top,
    width: line.right - line.left,
    height: line.bottom - line.top,
  }));
}

/** Cajas del fragmento `chunk` sobre la capa de texto de la página; `null` si no hay nada que medir. */
function measureLines(
  layer: TextLayerHandle | undefined,
  chunk: SpeechChunk | null,
  index: number,
  root: HTMLElement,
): Measured | null {
  if (layer === undefined || chunk === null) return null;
  const range = rangeForMatch(layer.textDivs, { pageIndex: index, start: chunk.start, end: chunk.end });
  if (range === null) return null;
  const origin = root.getBoundingClientRect();
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
  const first = rects[0];
  if (first === undefined) return null;
  const lines = mergeLines(rects, origin);
  const left = Math.min(...lines.map((line) => line.left));
  const top = Math.min(...lines.map((line) => line.top));
  const right = Math.max(...lines.map((line) => line.left + line.width));
  const bottom = Math.max(...lines.map((line) => line.top + line.height));
  return { highlight: { bounds: { left, top, width: right - left, height: bottom - top }, lines }, first, origin };
}

/**
 * Resaltado de la frase que se lee, en la página que la contiene (PDF-114). Un solo rango: el del fragmento en curso
 * (o el pausado). Si su primera línea queda fuera del visor, la página la lleva a la vista una sola vez.
 */
export function ReadAloudHighlight({ index, zoom, rotation }: ReadAloudHighlightProps) {
  const layer: TextLayerHandle | undefined = useSyncExternalStore(
    registry.subscribe,
    () => registry.get(index),
    () => undefined,
  );
  const chunk = useReadAloud((s) => (s.current?.pageIndex === index ? s.current : null));
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Recalcula los rectángulos con el fragmento, la capa, el zoom o la rotación (pdf.js recoloca el texto).
  useEffect(() => {
    const root = rootRef.current;
    const measured = root === null ? null : measureLines(layer, chunk, index, root);
    setHighlight(measured?.highlight ?? null);
    if (root === null || measured === null || chunk === null) return;

    // Revelación: si la primera línea queda fuera del visor, la página se lleva a la vista (una vez por fragmento).
    const viewer = root.closest<HTMLElement>('[data-testid="viewer"]');
    const first = measured.first;
    if (viewer === null || revealed.has(chunk) || root.clientHeight <= 0) return;
    const frame = viewer.getBoundingClientRect();
    if (first.top >= frame.top && first.bottom <= frame.bottom) return;
    revealed.add(chunk);
    goToPage(index, { yFraction: Math.max(0, (first.top - measured.origin.top) / root.clientHeight - REVEAL_OFFSET) });
  }, [layer, chunk, index, zoom, rotation]);

  return (
    <div ref={rootRef} className="read-aloud-highlight" aria-hidden="true">
      {highlight !== null && (
        // Una sola caja por fragmento; sus líneas van dentro, en coordenadas relativas a esa caja.
        <div
          className="read-aloud-current"
          style={{ left: highlight.bounds.left, top: highlight.bounds.top, width: highlight.bounds.width, height: highlight.bounds.height }}
        >
          {highlight.lines.map((line, k) => (
            <div
              key={k}
              className="read-aloud-line"
              style={{
                left: line.left - highlight.bounds.left,
                top: line.top - highlight.bounds.top,
                width: line.width,
                height: line.height,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

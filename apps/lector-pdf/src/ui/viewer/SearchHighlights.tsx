import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Rotation } from '../../core/rotation';
import type { SearchMatch } from '../../core/search/find';
import type { TextLayerHandle } from '../../engine/text';
import { goToPage } from '../../state/navigation';
import { useSearch } from '../../state/search-store';
import * as registry from './text-layer-registry';
import './search-highlights.css';

/** Con la coincidencia actual revelada, queda a este fracción de la altura de la página bajo el borde del visor. */
const REVEAL_OFFSET = 0.3;

/** Último `revealSeq` ya atendido en el visor. Es global porque la página puede montarse después de la petición. */
let revealedSeq = 0;

export interface SearchHighlightsProps {
  /** Índice de la página (0-based). */
  readonly index: number;
  /** Zoom efectivo del visor. */
  readonly zoom: number;
  /** Rotación de vista (se suma a la de la página). */
  readonly rotation: Rotation;
}

/** Rectángulo de un trozo de coincidencia, en píxeles relativos a la página. */
interface HitBox {
  readonly key: string;
  readonly current: boolean;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Rango del DOM que cubre una coincidencia. Inicio y fin apuntan a los nodos de texto de `textDivs`; si el fin
 * cae justo al principio de un ítem posterior, la coincidencia termina al final del ítem anterior.
 */
export function rangeForMatch(textDivs: readonly HTMLElement[], match: SearchMatch): Range | null {
  const startNode = textDivs[match.start.item]?.firstChild;
  if (startNode === undefined || startNode === null || startNode.nodeType !== Node.TEXT_NODE) return null;

  let endItem = match.end.item;
  let endOffset = match.end.offset;
  if (endOffset === 0 && endItem > match.start.item) {
    endItem -= 1;
    const previous = textDivs[endItem]?.firstChild;
    endOffset = previous?.nodeType === Node.TEXT_NODE ? (previous.textContent ?? '').length : 0;
  }
  const endNode = textDivs[endItem]?.firstChild;
  if (endNode === undefined || endNode === null || endNode.nodeType !== Node.TEXT_NODE) return null;

  const range = document.createRange();
  range.setStart(startNode, Math.min(match.start.offset, (startNode.textContent ?? '').length));
  range.setEnd(endNode, Math.min(endOffset, (endNode.textContent ?? '').length));
  return range.collapsed ? null : range;
}

/**
 * Resaltado de las coincidencias de una página, debajo de su capa de texto. Cada coincidencia es un `Range`
 * sobre los nodos de texto de la capa, así los rectángulos ya llevan el zoom y la rotación. Si la coincidencia
 * actual es nueva, la página la muestra con `goToPage` cuando el resaltado está listo.
 */
export function SearchHighlights({ index, zoom, rotation }: SearchHighlightsProps) {
  const layer: TextLayerHandle | undefined = useSyncExternalStore(
    registry.subscribe,
    () => registry.get(index),
    () => undefined,
  );
  const matches = useSearch((s) => s.matchesByPage.get(index));
  const currentIndex = useSearch((s) => (s.current?.page === index ? s.current.index : -1));
  const revealSeq = useSearch((s) => s.revealSeq);
  const [boxes, setBoxes] = useState<readonly HitBox[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  // Recalcula los rectángulos con las coincidencias, la capa, el zoom o la rotación (pdf.js recoloca el texto).
  useEffect(() => {
    const root = rootRef.current;
    if (layer === undefined || root === null || matches === undefined || matches.length === 0) {
      setBoxes([]);
      return;
    }
    const origin = root.getBoundingClientRect();
    const next: HitBox[] = [];
    matches.forEach((match, i) => {
      const range = rangeForMatch(layer.textDivs, match);
      if (range === null) return;
      Array.from(range.getClientRects()).forEach((rect, k) => {
        if (rect.width === 0 && rect.height === 0) return;
        next.push({
          key: `${String(i)}-${String(k)}`,
          current: i === currentIndex,
          left: rect.left - origin.left,
          top: rect.top - origin.top,
          width: rect.width,
          height: rect.height,
        });
      });
    });
    setBoxes(next);

    // Revelación: la coincidencia actual se lleva a la vista una vez por petición (`revealSeq`).
    const state = useSearch.getState();
    const first = next.find((box) => box.current);
    if (state.current?.page !== index || revealSeq === revealedSeq || first === undefined) return;
    if (root.clientHeight <= 0) return;
    revealedSeq = revealSeq;
    goToPage(index, { yFraction: Math.max(0, first.top / root.clientHeight - REVEAL_OFFSET) });
  }, [layer, matches, currentIndex, revealSeq, index, zoom, rotation]);

  return (
    <div ref={rootRef} className="search-highlights" aria-hidden="true">
      {boxes.map((box) => (
        <div
          key={box.key}
          className={box.current ? 'hit hit-current' : 'hit'}
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        />
      ))}
    </div>
  );
}

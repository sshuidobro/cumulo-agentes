// Adaptado de pdf.js, web/text_layer_builder.js, Apache-2.0 (comportamiento de selección de la capa de texto).
import { normalizeUnicode } from '../../engine/text';
import * as registry from './text-layer-registry';

const END_CLASS = 'endOfContent';
const SELECTING_CLASS = 'selecting';

/** Capas de texto con su marcador de fin de contenido. Los oyentes globales son compartidos por todas. */
const textLayers = new Map<HTMLElement, HTMLElement>();

interface GlobalListeners {
  readonly onPointerDown: () => void;
  readonly onPointerUp: () => void;
  readonly onBlur: () => void;
  readonly onKeyUp: () => void;
  readonly onSelectionChange: () => void;
}

let globalListeners: GlobalListeners | null = null;
/** Último rango visto, para saber qué extremo se ha movido (solo en navegadores antiguos). */
let prevRange: Range | null = null;
/** `undefined` hasta medirlo la primera vez: si el navegador ya selecciona bien, no hace falta el ajuste. */
let modernSelection: boolean | undefined;

function resetLayer(end: HTMLElement, layer: HTMLElement): void {
  layer.append(end);
  end.style.width = '';
  end.style.height = '';
  layer.classList.remove(SELECTING_CLASS);
}

function resetAll(): void {
  for (const [layer, end] of textLayers) resetLayer(end, layer);
}

/** Firefox y Chromium 148+ manejan bien la selección sobre la capa; el resto necesita el ajuste de `endOfContent`. */
function usesModernSelection(): boolean {
  if (modernSelection !== undefined) return modernSelection;
  const first = textLayers.keys().next().value;
  if (first === undefined) return false;
  if (getComputedStyle(first).getPropertyValue('-moz-user-select') === 'none') {
    modernSelection = true;
    return true;
  }
  const chromium = /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1];
  modernSelection = chromium !== undefined && Number.parseInt(chromium, 10) >= 148;
  return modernSelection;
}

/** Mueve `endOfContent` al punto donde empieza la selección para que el arrastre no salte al final de la página. */
function adjustEndOfContent(selection: Selection): void {
  const range = selection.getRangeAt(0);
  const modifyStart =
    prevRange !== null &&
    (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
      range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
  let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
  if (anchor !== null && anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
  if (anchor instanceof HTMLElement && anchor.classList.contains('highlight')) anchor = anchor.parentNode;
  if (anchor !== null && !modifyStart && range.endOffset === 0) {
    // Se sube hasta un nodo con hijos que esté antes del extremo.
    let node: Node | null = anchor;
    do {
      while (node !== null && node.previousSibling === null) node = node.parentNode;
      node = node?.previousSibling ?? null;
    } while (node !== null && node.childNodes.length === 0);
    anchor = node;
  }
  const parentLayer = anchor instanceof Element ? anchor.parentElement?.closest('.textLayer') : null;
  const end = parentLayer instanceof HTMLElement ? textLayers.get(parentLayer) : undefined;
  if (anchor instanceof Node && parentLayer instanceof HTMLElement && end !== undefined && anchor.parentElement !== null) {
    end.style.width = parentLayer.style.width;
    end.style.height = parentLayer.style.height;
    end.style.userSelect = 'text';
    anchor.parentElement.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
  }
  prevRange = range.cloneRange();
}

function onSelectionChange(): void {
  const selection = document.getSelection();
  if (selection === null || selection.rangeCount === 0) {
    resetAll();
    return;
  }
  const active = new Set<HTMLElement>();
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    for (const layer of textLayers.keys()) {
      if (!active.has(layer) && range.intersectsNode(layer)) active.add(layer);
    }
  }
  for (const [layer, end] of textLayers) {
    if (active.has(layer)) layer.classList.add(SELECTING_CLASS);
    else resetLayer(end, layer);
  }
  if (!usesModernSelection()) adjustEndOfContent(selection);
}

/** Oyentes compartidos por todas las capas: se añaden con la primera y se quitan con la última. */
function enableGlobalListeners(): void {
  if (globalListeners !== null) return;
  let isPointerDown = false;
  const listeners: GlobalListeners = {
    onPointerDown: () => {
      isPointerDown = true;
    },
    onPointerUp: () => {
      isPointerDown = false;
      resetAll();
    },
    onBlur: () => {
      isPointerDown = false;
      resetAll();
    },
    onKeyUp: () => {
      if (!isPointerDown) resetAll();
    },
    onSelectionChange,
  };
  document.addEventListener('pointerdown', listeners.onPointerDown);
  document.addEventListener('pointerup', listeners.onPointerUp);
  window.addEventListener('blur', listeners.onBlur);
  document.addEventListener('keyup', listeners.onKeyUp);
  document.addEventListener('selectionchange', listeners.onSelectionChange);
  globalListeners = listeners;
}

function disableGlobalListeners(): void {
  if (globalListeners === null) return;
  document.removeEventListener('pointerdown', globalListeners.onPointerDown);
  document.removeEventListener('pointerup', globalListeners.onPointerUp);
  window.removeEventListener('blur', globalListeners.onBlur);
  document.removeEventListener('keyup', globalListeners.onKeyUp);
  document.removeEventListener('selectionchange', globalListeners.onSelectionChange);
  globalListeners = null;
  prevRange = null;
}

/**
 * Dota a una capa de texto de su comportamiento de selección: añade `endOfContent`, marca `selecting` al
 * empezar a seleccionar y copia el texto normalizado (Unicode NFKC de pdf.js, sin caracteres nulos).
 * Devuelve la función que desregistra la capa; al quitar la última se retiran también los oyentes globales.
 */
export function attachSelectionBehavior(textLayerDiv: HTMLElement): () => void {
  const end = document.createElement('div');
  end.className = END_CLASS;
  textLayerDiv.append(end);

  const onMouseDown = (): void => {
    textLayerDiv.classList.add(SELECTING_CLASS);
  };
  const onCopy = (event: ClipboardEvent): void => {
    const text = document.getSelection()?.toString() ?? '';
    event.clipboardData?.setData('text/plain', normalizeUnicode(text).replace(/\0/g, ''));
    event.preventDefault();
  };
  textLayerDiv.addEventListener('mousedown', onMouseDown);
  textLayerDiv.addEventListener('copy', onCopy);
  textLayers.set(textLayerDiv, end);
  enableGlobalListeners();

  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    textLayerDiv.removeEventListener('mousedown', onMouseDown);
    textLayerDiv.removeEventListener('copy', onCopy);
    textLayers.delete(textLayerDiv);
    if (textLayers.size === 0) disableGlobalListeners();
  };
}

/**
 * Selecciona todo el texto de la página `pageIndex` (0-based), desde el primer hasta el último ítem.
 * Devuelve `false` si la página no tiene capa montada o no tiene texto.
 */
export function selectPageText(pageIndex: number): boolean {
  const divs = registry.get(pageIndex)?.textDivs ?? [];
  const first = divs[0];
  const last = divs[divs.length - 1];
  const selection = document.getSelection();
  if (first === undefined || last === undefined || selection === null) return false;
  const range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

import { TextLayer, type PDFPageProxy, type PageViewport, type TextContent } from './pdfjs';

export { normalizeUnicode } from './pdfjs';

/**
 * Parámetros de texto fijos para toda la app (PDF-013). La búsqueda (PDF-017) usa los mismos,
 * así los índices de los ítems coinciden con los de `TextLayer.textDivs`.
 */
export const TEXT_CONTENT_PARAMS = { includeMarkedContent: true, disableNormalization: true } as const;

/** Texto de una página con los parámetros fijos de la app. */
export function getPageTextContent(page: PDFPageProxy): Promise<TextContent> {
  return page.getTextContent(TEXT_CONTENT_PARAMS);
}

/** Capa de texto de una página dibujada sobre su contenedor (`div.textLayer`). */
export interface TextLayerHandle {
  /** Un `div` por ítem de texto, en el orden de `items`. */
  readonly textDivs: readonly HTMLElement[];
  /** Cadenas de los ítems de texto (`str`), en el mismo orden que `textDivs`. */
  readonly items: readonly string[];
  /** Contenedor de la capa (`div.textLayer`): su caja en la ventana sirve para situar la selección (PDF-032). */
  readonly container: HTMLElement;
  /** Viewport con el que está colocada la capa: el último que se le pasó en `update` (o el inicial). */
  readonly viewport: PageViewport;
  /** Crea los `div` de texto. Rechaza si la capa se cancela antes. */
  render(): Promise<void>;
  /** Recoloca el texto para un nuevo viewport (zoom o rotación). */
  update(viewport: PageViewport): void;
  /** Cancela el trabajo pendiente. No vacía el contenedor. */
  cancel(): void;
}

/** Crea la capa de texto de `page` dentro de `container`, alineada con `viewport`. */
export function createTextLayer(
  page: PDFPageProxy,
  container: HTMLElement,
  viewport: PageViewport,
): TextLayerHandle {
  const layer = new TextLayer({
    textContentSource: page.streamTextContent(TEXT_CONTENT_PARAMS),
    container,
    viewport,
  });
  let current = viewport;
  return {
    get textDivs(): readonly HTMLElement[] {
      return layer.textDivs;
    },
    get items(): readonly string[] {
      return layer.textContentItemsStr;
    },
    container,
    get viewport(): PageViewport {
      return current;
    },
    render: () => layer.render(),
    update: (next) => {
      current = next;
      layer.update({ viewport: next });
    },
    cancel: () => {
      layer.cancel();
    },
  };
}

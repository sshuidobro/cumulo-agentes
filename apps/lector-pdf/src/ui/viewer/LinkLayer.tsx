import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { createLogger } from '@suite/shared';
import type { LinkTarget } from '../../core/links';
import { normalizeRotation, type Rotation } from '../../core/rotation';
import { zoomToScale } from '../../core/zoom';
import { getPageLinks, type PageLink } from '../../engine/links';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from '../../engine/pdfjs';
import { navigateToDest, runNamedAction } from '../../state/history';
import { useViewer } from '../../state/viewer-store';
import { ConfirmExternalLink } from '../links/confirm-external';
import { msg } from '../messages';
import styles from './LinkLayer.module.css';

const log = createLogger('viewer');

export interface LinkLayerProps {
  /** Índice de la página (0-based). */
  readonly index: number;
  /** Zoom efectivo del visor. */
  readonly zoom: number;
  /** Rotación de vista (se suma a la de la página). */
  readonly rotation: Rotation;
}

/** Enlaces ya leídos de una página, con el documento y la página de los que salen. */
interface PageLinks {
  readonly doc: PDFDocumentProxy;
  readonly page: PDFPageProxy;
  readonly links: readonly PageLink[];
}

/** Rectángulo de un enlace en píxeles del visor. */
interface LinkBox {
  readonly key: number;
  readonly link: PageLink;
  readonly style: CSSProperties;
}

/**
 * Capa de enlaces de una página, encima de la capa de texto. Los internos y de acción navegan dentro del
 * documento; los externos piden confirmación antes de abrirse; los bloqueados no hacen nada.
 */
export function LinkLayer({ index, zoom, rotation }: LinkLayerProps) {
  const doc = useViewer((s) => s.pdf?.doc ?? null);
  const [loaded, setLoaded] = useState<PageLinks | null>(null);
  /** URL pendiente de confirmación, o null si no hay diálogo abierto. */
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  useEffect(() => {
    if (doc === null) return undefined;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const page = await doc.getPage(index + 1);
        const links = await getPageLinks(page);
        if (!cancelled) setLoaded({ doc, page, links });
      } catch (cause: unknown) {
        if (!cancelled) log.warn('no se han podido leer los enlaces de la página', { page: index + 1, error: cause });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [doc, index]);

  // Los rectángulos se recalculan con el zoom y la rotación, sin tocar el documento.
  const boxes = useMemo<readonly LinkBox[]>(() => {
    if (loaded === null || loaded.doc !== doc) return [];
    const viewport = loaded.page.getViewport({
      scale: zoomToScale(zoom),
      rotation: normalizeRotation(loaded.page.rotate + rotation),
    });
    return loaded.links.map((link, key) => ({ key, link, style: boxStyle(viewport, link) }));
  }, [loaded, doc, zoom, rotation]);

  const activate = (event: MouseEvent<HTMLAnchorElement>, target: LinkTarget): void => {
    event.preventDefault();
    switch (target.kind) {
      case 'internal':
        void navigateToDest(target.dest);
        break;
      case 'action':
        runNamedAction(target.action);
        break;
      case 'external':
        setPendingUrl(target.url);
        break;
      case 'blocked':
        break;
    }
  };

  return (
    <>
      <div className={styles.layer}>
        {boxes.map(({ key, link, style }) => {
          const { target } = link;
          if (target.kind === 'blocked') {
            return <span key={key} className={styles.blocked} style={style} title={msg.linkBlocked} />;
          }
          if (target.kind === 'external') {
            // El clic de rueda también abre el enlace: también debe pasar por la confirmación.
            const onExternal = (event: MouseEvent<HTMLAnchorElement>): void => {
              activate(event, target);
            };
            return (
              <a
                key={key}
                href={target.url}
                title={target.url}
                rel="noopener noreferrer"
                className={styles.link}
                style={style}
                onClick={onExternal}
                onAuxClick={onExternal}
              />
            );
          }
          return (
            <a
              key={key}
              href="#"
              aria-label={msg.internalLink}
              className={styles.link}
              style={style}
              onClick={(event) => {
                activate(event, target);
              }}
            />
          );
        })}
      </div>
      <ConfirmExternalLink
        url={pendingUrl}
        onClose={() => {
          setPendingUrl(null);
        }}
      />
    </>
  );
}

/**
 * Caja en píxeles del enlace: las cuatro esquinas del rectángulo en puntos PDF pasadas al viewport (que puede
 * estar girado) y su envolvente. pdf.js 6.4 no tiene `convertToViewportRectangle`, de ahí las esquinas.
 */
function boxStyle(viewport: PageViewport, link: PageLink): CSSProperties {
  const [x1, y1, x2, y2] = link.rect;
  const corners = [
    viewport.convertToViewportPoint(x1, y1),
    viewport.convertToViewportPoint(x2, y1),
    viewport.convertToViewportPoint(x2, y2),
    viewport.convertToViewportPoint(x1, y2),
  ].map((point) => point as readonly number[]);
  const xs = corners.map(([x = 0]) => x);
  const ys = corners.map(([, y = 0]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

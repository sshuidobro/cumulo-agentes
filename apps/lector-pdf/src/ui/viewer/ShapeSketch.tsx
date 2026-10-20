import type { ReactElement } from 'react';
import { arrowWings } from '../../core/annotations/shapes';
import type { PolygonSketch, ShapeSketch as Sketch } from './use-shape-tool';
import styles from './AnnotationLayer.module.css';

/**
 * Vista previa punteada de la forma que se arrastra (PDF-108). Va en coordenadas de página, dentro del grupo
 * transformado de la capa. La punta de una flecha se dibuja con la geometría de la apariencia final.
 */
export function ShapeSketch({ sketch, width }: { readonly sketch: Sketch; readonly width: number }): ReactElement {
  if ('points' in sketch) return <LineSketch kind={sketch.kind} points={sketch.points} width={width} />;
  const [x1, y1, x2, y2] = sketch.rect;
  if (sketch.kind === 'square') return <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} className={styles.sketch} />;
  return <ellipse cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={(x2 - x1) / 2} ry={(y2 - y1) / 2} className={styles.sketch} />;
}

/**
 * Polígono en curso (PDF-115): la polilínea de los vértices y el tramo punteado hasta el puntero. Va en coordenadas de
 * página, como las demás vistas previas.
 */
export function PolygonDraft({ polygon }: { readonly polygon: PolygonSketch }): ReactElement {
  const { vertices, cursor } = polygon;
  const points: string[] = [];
  for (let i = 0; i + 1 < vertices.length; i += 2) points.push(`${String(vertices[i])},${String(vertices[i + 1])}`);
  const n = vertices.length;
  return (
    <>
      <polyline points={points.join(' ')} className={styles.sketch} />
      {n >= 2 && <line x1={vertices[n - 2]} y1={vertices[n - 1]} x2={cursor[0]} y2={cursor[1]} className={styles.sketch} />}
    </>
  );
}

function LineSketch({
  kind,
  points,
  width,
}: {
  readonly kind: 'line' | 'arrow';
  readonly points: readonly [number, number, number, number];
  readonly width: number;
}): ReactElement {
  const [x1, y1, x2, y2] = points;
  const wings = kind === 'arrow' ? arrowWings([x2, y2], [x1, y1], width) : null;
  return (
    <>
      <line x1={x1} y1={y1} x2={x2} y2={y2} className={styles.sketch} />
      {wings !== null && (
        <polyline
          points={`${wings[0][0]},${wings[0][1]} ${x2},${y2} ${wings[1][0]},${wings[1][1]}`}
          className={styles.sketch}
        />
      )}
    </>
  );
}

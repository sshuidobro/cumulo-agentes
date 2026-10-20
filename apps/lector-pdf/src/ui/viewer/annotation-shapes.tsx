import type { ReactElement } from 'react';
import { FREETEXT_LEADING, FREETEXT_MARGIN_PT } from '../../core/annotations/freetext';
import type {
  Annotation,
  BoxShapeAnnotation,
  FreeTextAnnotation,
  LineShapeAnnotation,
  NoteAnnotation,
  PolygonAnnotation,
  Rgb,
  ShapeLineEnding,
  SignatureAnnotation,
  StampAnnotation,
  TextMarkupAnnotation,
} from '../../core/annotations/model';
import { arrowWings, STAMP_LABELS, stampTextBox } from '../../core/annotations/shapes';
import { wrapText } from '../../core/annotations/wrap';
import { cssColor, svgPathForQuads, svgPointsForPath } from './annotation-geometry';
import styles from './AnnotationLayer.module.css';
import { useSignatureImageUrl } from './signature-image';

/** Mismo valor que la apariencia de PDF-027, para que se vea igual en el visor y en otros programas. */
const NOTE_SIZE = 20;
const HELVETICA = 'Helvetica, Arial, sans-serif';

/** Dibujo de una anotación nueva o modificada (en puntos PDF; la capa aplica la matriz de la página). */
export function AnnotationShape({ a }: { readonly a: Annotation }): ReactElement {
  switch (a.type) {
    case 'highlight':
      return <HighlightShape a={a} />;
    case 'underline':
    case 'strikeout':
      return <LineMarkupShape a={a} middle={a.type === 'strikeout'} />;
    case 'note':
      return <NoteShape a={a} />;
    case 'freetext':
      return <FreeTextShape a={a} />;
    case 'ink':
      return (
        <g
          fill="none"
          stroke={cssColor(a.color)}
          strokeWidth={a.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={a.opacity}
        >
          {a.paths.map((path, i) => (
            <polyline key={i} points={svgPointsForPath(path)} />
          ))}
        </g>
      );
    case 'signature':
      return <SignatureShape a={a} />;
    case 'square':
    case 'circle':
      return <BoxShape a={a} />;
    case 'line':
      return <LineShape a={a} />;
    case 'polygon':
      return <PolygonShape a={a} />;
    case 'stamp':
      return <StampShape a={a} />;
    case 'reply':
    case 'review':
      // Respuestas y estados no se dibujan (PDF-058).
      return <></>;
  }
}

/** Zona activa de una anotación: el trazado que el ratón y el teclado pueden alcanzar. */
export function ZoneShape({ a }: { readonly a: Annotation }): ReactElement {
  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return <path d={svgPathForQuads(a.quads)} className={styles.zone} />;
    case 'note':
    case 'freetext':
    case 'signature':
    case 'square':
    case 'circle':
    case 'stamp':
      return <rect x={a.rect[0]} y={a.rect[1]} width={a.rect[2] - a.rect[0]} height={a.rect[3] - a.rect[1]} className={styles.zone} />;
    case 'ink':
      return (
        <>
          {a.paths.map((path, i) => (
            <polyline key={i} points={svgPointsForPath(path)} className={styles.zoneLine} />
          ))}
        </>
      );
    case 'line':
      return <line x1={a.points[0]} y1={a.points[1]} x2={a.points[2]} y2={a.points[3]} className={styles.zoneLine} />;
    case 'polygon':
      return <polygon points={svgPointsForPath(a.vertices)} className={styles.zoneLine} />;
    case 'reply':
    case 'review':
      return <></>;
  }
}

/**
 * Firma (ADR-0020). `ink`: trazos en su caja, escalada al `rect` como en la apariencia (el grosor también).
 * `image`: `<image>` en el `rect`; la capa voltea el eje Y, así que se vuelve a voltear para que se lea derecha.
 */
function SignatureShape({ a }: { readonly a: SignatureAnnotation }): ReactElement | null {
  const url = useSignatureImageUrl(a.art);
  const [x1, y1, x2, y2] = a.rect;
  if (a.art.kind === 'ink') {
    const [boxW, boxH] = a.art.box;
    return (
      <g
        transform={`translate(${x1} ${y1}) scale(${(x2 - x1) / boxW} ${(y2 - y1) / boxH})`}
        fill="none"
        stroke={cssColor(a.color)}
        strokeWidth={a.art.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={a.opacity}
      >
        {a.art.paths.map((path, i) => (
          <polyline key={i} points={svgPointsForPath(path)} />
        ))}
      </g>
    );
  }
  if (url === null) return null;
  return (
    <g transform={`translate(${x1} ${y2}) scale(1 -1)`} opacity={a.opacity}>
      <image x={0} y={0} width={x2 - x1} height={y2 - y1} href={url} preserveAspectRatio="none" />
    </g>
  );
}

/** Rectángulo o elipse: el trazo va por dentro de `rect` (como en la apariencia). Sin relleno si `interior` es `null`. */
function BoxShape({ a }: { readonly a: BoxShapeAnnotation }): ReactElement {
  const [x1, y1, x2, y2] = a.rect;
  const w = a.width;
  const style = {
    fill: a.interior === null ? 'none' : cssColor(a.interior),
    stroke: cssColor(a.color),
    strokeWidth: w,
    opacity: a.opacity,
  };
  if (a.type === 'square') {
    return <rect x={x1 + w / 2} y={y1 + w / 2} width={x2 - x1 - w} height={y2 - y1 - w} {...style} />;
  }
  return (
    <ellipse cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={(x2 - x1 - w) / 2} ry={(y2 - y1 - w) / 2} {...style} />
  );
}

/** Línea o flecha: el segmento y, en cada extremo con punta, las alas de la misma geometría que la apariencia. */
function LineShape({ a }: { readonly a: LineShapeAnnotation }): ReactElement {
  const [x1, y1, x2, y2] = a.points;
  return (
    <g stroke={cssColor(a.color)} strokeWidth={a.width} strokeLinecap="round" strokeLinejoin="round" opacity={a.opacity}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <ArrowHead tip={[x1, y1]} other={[x2, y2]} ending={a.endings[0]} width={a.width} interior={a.interior} />
      <ArrowHead tip={[x2, y2]} other={[x1, y1]} ending={a.endings[1]} width={a.width} interior={a.interior} />
    </g>
  );
}

function ArrowHead({
  tip,
  other,
  ending,
  width,
  interior,
}: {
  readonly tip: readonly [number, number];
  readonly other: readonly [number, number];
  readonly ending: ShapeLineEnding;
  readonly width: number;
  readonly interior: Rgb | null;
}): ReactElement | null {
  const wings = ending === 'None' ? null : arrowWings(tip, other, width);
  if (wings === null) return null;
  const points = `${wings[0][0]},${wings[0][1]} ${tip[0]},${tip[1]} ${wings[1][0]},${wings[1][1]}`;
  if (ending === 'OpenArrow') return <polyline points={points} fill="none" />;
  return <polygon points={points} fill={interior === null ? 'none' : cssColor(interior)} />;
}

/** Polígono cerrado con uniones redondeadas, como en la apariencia. */
function PolygonShape({ a }: { readonly a: PolygonAnnotation }): ReactElement {
  return (
    <polygon
      points={svgPointsForPath(a.vertices)}
      fill={a.interior === null ? 'none' : cssColor(a.interior)}
      stroke={cssColor(a.color)}
      strokeWidth={a.width}
      strokeLinejoin="round"
      opacity={a.opacity}
    />
  );
}

/** Sello: contorno redondeado de 2 pt a 1 pt del borde y texto en Helvetica volteado como el texto libre. */
function StampShape({ a }: { readonly a: StampAnnotation }): ReactElement {
  const [x1, y1, x2, y2] = a.rect;
  const color = cssColor(a.color);
  const text = stampTextBox(a.name, a.rect);
  return (
    <g opacity={a.opacity}>
      <rect x={x1 + 1} y={y1 + 1} width={x2 - x1 - 2} height={y2 - y1 - 2} rx={4} fill="none" stroke={color} strokeWidth={2} />
      <text
        transform={`translate(${text.x} ${text.y}) scale(1 -1)`}
        fontFamily={HELVETICA}
        fontSize={text.fontSize}
        fill={color}
      >
        {STAMP_LABELS[a.name]}
      </text>
    </g>
  );
}

function HighlightShape({ a }: { readonly a: TextMarkupAnnotation }): ReactElement {
  return (
    <path d={svgPathForQuads(a.quads)} fill={cssColor(a.color)} opacity={a.opacity} className={styles.highlight} />
  );
}

/** Subrayado o tachado: una línea por quad, con el mismo grosor y altura que la apariencia de PDF-027. */
function LineMarkupShape({ a, middle }: { readonly a: TextMarkupAnnotation; readonly middle: boolean }): ReactElement {
  return (
    <g stroke={cssColor(a.color)} opacity={a.opacity}>
      {a.quads.map((q, i) => {
        const yBottom = Math.min(q[1], q[3], q[5], q[7]);
        const yTop = Math.max(q[1], q[3], q[5], q[7]);
        const height = yTop - yBottom;
        const thickness = Math.max(1, height / 14);
        const y = middle ? yBottom + height / 2 : yBottom + thickness;
        const xLeft = Math.min(q[0], q[4]);
        const xRight = Math.max(q[2], q[6]);
        return <line key={i} x1={xLeft} y1={y} x2={xRight} y2={y} strokeWidth={thickness} />;
      })}
    </g>
  );
}

/** Icono de nota: bocadillo de borde negro relleno del color, anclado a la esquina superior izquierda. */
function NoteShape({ a }: { readonly a: NoteAnnotation }): ReactElement {
  const originX = a.rect[0];
  const originY = a.rect[3] - NOTE_SIZE;
  const p = (u: number, v: number): string => `${originX + u} ${originY + v}`;
  const bubble = `M ${p(1, 19)} L ${p(19, 19)} L ${p(19, 8)} L ${p(9, 8)} L ${p(4, 2)} L ${p(4, 8)} L ${p(1, 8)} Z`;
  const lines = `M ${p(4, 16)} L ${p(16, 16)} M ${p(4, 13)} L ${p(16, 13)} M ${p(4, 10)} L ${p(16, 10)}`;
  return (
    <g stroke="rgb(0 0 0)" strokeWidth={1} opacity={a.opacity}>
      <path d={bubble} fill={cssColor(a.color)} />
      <path d={lines} fill="none" />
    </g>
  );
}

/** Texto libre: borde de 1 pt, texto Helvetica ajustado al rectángulo y recortado a él. */
function FreeTextShape({ a }: { readonly a: FreeTextAnnotation }): ReactElement {
  const [x1, y1, x2, y2] = a.rect;
  const width = x2 - x1;
  const height = y2 - y1;
  const lines = wrapText(a.contents, width - 2 * FREETEXT_MARGIN_PT, a.fontSize);
  const leading = FREETEXT_LEADING * a.fontSize;
  const clipId = `clip-${a.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  let baseline = y2 - FREETEXT_MARGIN_PT - a.fontSize;
  const texts: ReactElement[] = [];
  lines.forEach((line, i) => {
    if (line !== '') {
      // `scale(1 -1)`: el texto va en coordenadas de página y se vuelve a voltear para leerse derecho.
      texts.push(
        <text
          key={i}
          transform={`translate(${x1 + FREETEXT_MARGIN_PT} ${baseline}) scale(1 -1)`}
          fontFamily={HELVETICA}
          fontSize={a.fontSize}
          fill={cssColor(a.textColor)}
        >
          {line}
        </text>,
      );
    }
    baseline -= leading;
  });
  return (
    <g opacity={a.opacity}>
      <rect x={x1 + 0.5} y={y1 + 0.5} width={width - 1} height={height - 1} fill="none" stroke={cssColor(a.color)} strokeWidth={1} />
      <clipPath id={clipId}>
        <rect x={x1} y={y1} width={width} height={height} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>{texts}</g>
    </g>
  );
}

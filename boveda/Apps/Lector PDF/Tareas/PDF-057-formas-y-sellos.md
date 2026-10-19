---
tipo: tarea
id: PDF-057
titulo: Formas y sellos - modelo, apariencias y escritura
app: pdf
estado: pendiente
depende_de: [PDF-039]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, anotaciones]
---

# PDF-057 · Formas y sellos: modelo, apariencias y escritura

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0029-formas-y-sellos]], [[ADR-0009-anotaciones-escritor-incremental]] · Paridad: [[Paridad Adobe Acrobat]] · Siguen: [[PDF-107-importar-formas-y-sellos]], [[PDF-108-herramientas-de-formas]], [[PDF-115-poligono-y-sellos]]

## Objetivo
El modelo de anotaciones admite rectángulo, elipse, línea/flecha, polígono y sello; cada tipo genera su `/AP`, se escribe como anotación estándar con el escritor incremental y se dibuja en la capa SVG. Sin herramientas todavía (PDF-108 y PDF-115): se prueba con tests.

## Contexto
- [[ADR-0029-formas-y-sellos]] («Decisión»): tipos, claves PDF, sellos y colores.
- `src/core/annotations/model.ts`: `Base`, `Annotation`, `translateAnnotation`, `isAnnotation`, validadores privados (`isRect`, `isRgb`, `isPositive`…).
- `src/core/annotations/appearance.ts`: `Drawing`, `withOpacity`, `colorOp`, `num`, `nums`, `pdfText`, `drawingOf`, `buildAppearance`.
- `src/core/annotations/to-pdf.ts`: `SUBTYPES`, `annotationDict`, `updatedDict`, `typeEntries`.
- `src/core/annotations/ink.ts` (patrón de fábrica), `helvetica-widths.ts` → `textWidth(s, fontSize)`.
- Registros exhaustivos por tipo que hay que completar: `commands.ts` (`ADD_LABEL`, `NOUN`), `comment-list.ts` (`SUPPORTED_LABELS`, `typeLabelOf`), `src/ui/messages.ts` (`annotationKinds`), `src/ui/viewer/annotation-shapes.tsx` (`AnnotationShape`, `ZoneShape`; patrón de texto volteado en `FreeTextShape`).
- Tests de referencia: `tests/unit/annotations/appearance.test.ts`, `to-pdf.test.ts`, `model.test.ts`, `tests/unit/pdf/interop.test.ts` (qpdf y pdf.js), `tests/unit/annotations/factories.ts`.

## Qué hay que hacer
1. `src/core/annotations/shapes.ts` (nuevo; de `model.ts` solo `import type`, para no crear ciclo):
```ts
export const STAMP_NAMES = ['Approved','NotApproved','Draft','Final','Confidential','ForComment','Expired',
  'NotForPublicRelease','ForPublicRelease','Experimental','AsIs','Departmental','TopSecret','Sold'] as const;
export type StampName = (typeof STAMP_NAMES)[number];
export const STAMP_LABELS: Readonly<Record<StampName, string>>; // APROBADO, NO APROBADO, BORRADOR, FINAL, CONFIDENCIAL,
  // PARA COMENTARIOS, CADUCADO, NO PUBLICAR, PARA PUBLICAR, EXPERIMENTAL, TAL CUAL, DEPARTAMENTAL, ALTO SECRETO, VENDIDO
export function stampColor(n: StampName): Rgb; // verde [0.13,0.55,0.13]: Approved, Final, ForPublicRelease;
  // rojo [0.8,0.1,0.1]: NotApproved, Confidential, TopSecret, Expired, NotForPublicRelease; azul [0.1,0.3,0.7]: el resto
export const STAMP_HEIGHT_PT = 36;
export const STAMP_FONT_SIZE_PT = 18;
export const SHAPE_LINE_ENDINGS = ['None', 'OpenArrow', 'ClosedArrow'] as const;
/** Longitud de la punta de flecha: max(6, 3 × width) pt; ángulo ±30°. */
export function arrowHeadSize(width: number): number;
/** Caja de una línea: puntos ampliados width/2, más arrowHeadSize si algún extremo no es 'None'. */
export function lineRect(points: readonly [number, number, number, number], width: number, endings: readonly [ShapeLineEnding, ShapeLineEnding]): RectPt;
/** Caja de los vértices ampliada width/2. */
export function verticesRect(vertices: readonly number[], width: number): RectPt;
/** Caja de un sello centrada en (cx, cy): alto 36, ancho textWidth(label, 18) + 24. */
export function stampRectAt(name: StampName, cx: number, cy: number): RectPt;
export interface NewShapeBase { readonly id: string; readonly pageIndex: number; readonly color: Rgb; readonly author: string; readonly now: string }
export function newBoxShape(i: NewShapeBase & { readonly kind: 'square' | 'circle'; readonly rect: RectPt; readonly width: number }): BoxShapeAnnotation;
export function newLineShape(i: NewShapeBase & { readonly points: readonly [number, number, number, number]; readonly arrow: boolean; readonly width: number }): LineShapeAnnotation; // arrow → endings ['None','OpenArrow']
export function newPolygonShape(i: NewShapeBase & { readonly vertices: readonly number[]; readonly width: number }): PolygonAnnotation;
export function newStamp(i: Omit<NewShapeBase, 'color'> & { readonly name: StampName; readonly center: readonly [number, number] }): StampAnnotation; // color = stampColor(name)
/** Nueva caja de rectángulo, elipse o sello (mismo tipo). */
export function resizeBox<T extends BoxShapeAnnotation | StampAnnotation>(a: T, rect: RectPt): T;
export function isShapeValid(v: Record<string, unknown>): boolean; // validación de los campos propios (para isAnnotation)
```
   Todas las nuevas: `opacity: 1`, `contents: ''`, `interior: null`, `created = modified = now`, `origin: { kind: 'new' }`.
2. `model.ts`: añade a la unión `Annotation`
```ts
export type ShapeLineEnding = 'None' | 'OpenArrow' | 'ClosedArrow';
export interface BoxShapeAnnotation extends Base { readonly type: 'square' | 'circle'; readonly width: number; readonly interior: Rgb | null }
export interface LineShapeAnnotation extends Base { readonly type: 'line'; readonly points: readonly [number, number, number, number]; readonly width: number; readonly endings: readonly [ShapeLineEnding, ShapeLineEnding]; readonly interior: Rgb | null }
export interface PolygonAnnotation extends Base { readonly type: 'polygon'; readonly vertices: readonly number[]; readonly width: number; readonly interior: Rgb | null }
export interface StampAnnotation extends Base { readonly type: 'stamp'; readonly name: StampName }
```
   `translateAnnotation`: `line` mueve `points`, `polygon` mueve `vertices`, el resto solo `rect`. `isAnnotation`: los cinco casos llaman a `isShapeValid` (vértices: ≥ 6 números y longitud par; `width` > 0; `interior` null o RGB; `endings` de `SHAPE_LINE_ENDINGS`; `name` de `STAMP_NAMES`).
3. `appearance.ts` (en `drawingOf`), coordenadas de página, con `withOpacity`:
   - `square`: `w` = width; `RG` del color; si `interior`, `rg`; `x1+w/2 y1+w/2 (W-w) (H-w) re` y `B` (con relleno) o `S`.
   - `circle`: elipse inscrita en el rect reducido w/2, 4 curvas Bézier con `k = 0.5523`, `h` y `B`/`S`.
   - `line`: `1 J 1 j w w`, `x1 y1 m x2 y2 l S`; por cada extremo ≠ `None` en su punto, punta de longitud `arrowHeadSize(w)` a ±30° apuntando hacia fuera: `OpenArrow` dos segmentos (`S`); `ClosedArrow` triángulo cerrado (`B` si `interior`, si no `s`).
   - `polygon`: `m`, `l`…, `h`, `B` o `S`, con `1 j`.
   - `stamp`: color del sello en `RG` y `rg`; `2 w`; rectángulo redondeado (radio 4) inset 1 pt con 4 Bézier, `S`; texto `STAMP_LABELS[name]` en `/Helv` (`font: true`) de tamaño `fs = min(18, H − 12, (W − 16) / textWidth(label, 1))`, centrado: `x = x1 + (W − textWidth(label, fs)) / 2`, `y = y1 + (H − 0.7·fs) / 2`.
4. `to-pdf.ts`: `SUBTYPES` (`Square`, `Circle`, `Line`, `Polygon`, `Stamp`). `typeEntries` pasa a devolver `Record<string, PdfValue | undefined>` (`undefined` = quitar la clave; `annotationDict` omite las `undefined`, `updatedDict` las pasa a `withEntries`):
   - formas: `BS: dict({ W: width, S: name('S') })`, `IC: interior ? [...] : undefined`, `RD: undefined`, `BE: undefined`;
   - `line`: además `L: [...points]`, `LE: [name(e0), name(e1)]`, `IT: algún extremo ≠ 'None' ? name('LineArrow') : undefined`;
   - `polygon`: además `Vertices: [...vertices]`;
   - `stamp`: `Name: name(a.name)`.
5. Etiquetas: `ADD_LABEL` («añadir rectángulo», «añadir elipse», «añadir línea», «añadir polígono», «añadir sello»), `NOUN`, `SUPPORTED_LABELS` y `msg.annotationKinds` («Rectángulo», «Elipse», «Línea», «Polígono», «Sello»). `typeLabelOf`: una `line` con algún extremo ≠ `None` → «Flecha».
6. `annotation-shapes.tsx`: `AnnotationShape` dibuja cada tipo igual que su apariencia (`<rect>`, `<ellipse>`, `<line>` + `<polyline>`/`<polygon>` de las puntas, `<polygon>`, sello = `<rect rx=4>` + `<text>` volteado como en `FreeTextShape`, `fill="none"` si no hay relleno). `ZoneShape`: rectángulo, elipse y sello → `<rect>` del `rect` con `styles.zone`; línea → `<line>` con `styles.zoneLine`; polígono → `<polygon>` con `styles.zoneLine`.
7. `tests/unit/annotations/factories.ts`: `newAnnotation(id, type, page)` acepta los tipos nuevos.
8. Tests: `tests/unit/annotations/shapes.test.ts` (fábricas, cajas, `isShapeValid`), casos nuevos en `appearance.test.ts` (operadores esperados exactos de un rectángulo 100×50 con `w=2`, una flecha horizontal y un sello `Approved`), `to-pdf.test.ts` (claves de cada tipo; `updatedDict` sobre un `/Square` con `/RD` y `/IC` los quita si `interior` es `null`), `model.test.ts` (`translateAnnotation` de `line` y `polygon`; `isAnnotation` rechaza 2 vértices, `endings` desconocido, sello `Foo`), y `tests/unit/annotations/shapes-interop.test.ts`.

## Criterios de aceptación
- [ ] `shapes-interop.test.ts`: sobre `basic-5.pdf`, `buildIncrementalUpdate` con un rectángulo con relleno, una elipse, una flecha, un polígono de 5 vértices y un sello `Draft` en la página 1 → `qpdf --check` código 0; pdf.js `getAnnotations()` da `Square`, `Circle`, `Line`, `Polygon`, `Stamp` con `hasAppearance: true`, el `rect` escrito y, en la línea, `lineEndings` `['None','OpenArrow']`; `qpdf --json` muestra `/L` en el orden escrito (inicio → fin), `/IC` solo en el rectángulo, `/Name /Draft` en el sello.
- [ ] Cada `/AP` decodificada (`decodeStreamData`) solo usa coordenadas dentro de su `/BBox` (= `rect`): test que extrae los números de los operadores `m`, `l`, `c`, `re` y comprueba que caen en la caja (la comprobación en píxeles se hace en el E2E de PDF-108).
- [ ] Mismo `a`, mismos bytes de `/AP` (dos llamadas a `buildAppearance` dan `data` idéntica).
- [ ] Un borrador con los cinco tipos pasa `fromDraft(toDraft(...))` sin pérdidas (`draft.ts`).
- [ ] `tests/ui/annotation-layer.test.tsx`: una forma nueva de cada tipo en `edits.upserts` se dibuja (elemento SVG esperado) y su zona tiene `aria-label` «Rectángulo de Usuario», «Flecha de Usuario»… (de `zoneLabel`).
- [ ] Cobertura de `shapes.ts` ≥ 90 % de líneas.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0; `pnpm perf` sin regresiones.

## Fuera de alcance
- Importar formas y sellos del fichero (PDF-107). Herramientas, mover, redimensionar, color y grosor desde la interfaz (PDF-108, PDF-115). Polilínea, nubes, cotas, borde discontinuo, sellos personalizados o con imagen, editar vértices.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

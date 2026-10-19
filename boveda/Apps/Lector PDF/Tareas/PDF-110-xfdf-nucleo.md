---
tipo: tarea
id: PDF-110
titulo: XFDF - parser XML seguro, exportar e importar comentarios (núcleo)
app: pdf
estado: en-test
depende_de: [PDF-058]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, anotaciones, formato]
---

# PDF-110 · XFDF: parser XML seguro, exportar e importar comentarios (núcleo)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0030-respuestas-estados-xfdf]] · Antes: [[PDF-058-respuestas-xfdf]] · Sigue: [[PDF-111-xfdf-interfaz]]

## Objetivo
Funciones puras de `core/` que convierten las anotaciones editables en un XFDF que Acrobat importa, y un XFDF (nuestro o de Acrobat) en anotaciones nuevas, sin pérdidas en la ida y vuelta.

## Contexto
- [[ADR-0030-respuestas-estados-xfdf]] («XFDF», «Parser XML»).
- `src/core/annotations/model.ts` (todos los tipos, incluidos los de PDF-057 y PDF-058), `isAnnotation`; `shapes.ts` (`STAMP_NAMES`, `SHAPE_LINE_ENDINGS`); `replies.ts`.
- `src/core/pdf-date.ts` → `toPdfDate(iso)`, `parsePdfDate(s)`; `src/core/annotations/to-pdf.ts` → `SIGNATURE_STAMP_NAME`.
- Referencia del formato: especificación XFDF 3.0 de Adobe (elementos en minúsculas, atributos de abajo).

## Qué hay que hacer
1. `src/core/xfdf/xml.ts`:
```ts
export interface XmlText { readonly kind: 'text'; readonly text: string }
export interface XmlElement { readonly kind: 'element'; readonly name: string; readonly attrs: ReadonlyMap<string, string>; readonly children: readonly (XmlElement | XmlText)[] }
export const MAX_XML_CHARS = 20_000_000;
export const MAX_XML_ELEMENTS = 200_000;
/** Raíz del documento. Errores → err con código 'xfdf-invalid'. Nunca lanza. */
export function parseXml(text: string): Result<XmlElement>;
export function escapeXml(s: string): string;            // & < > " ' → entidades
export function textOf(e: XmlElement): string;           // concatena el texto de todos los descendientes
export function child(e: XmlElement, name: string): XmlElement | undefined;
```
   Admite: declaración `<?xml …?>`, comentarios, CDATA, atributos con `"` o `'`, las 5 entidades predefinidas, `&#NN;` y `&#xHH;`. El nombre se guarda **sin prefijo de espacio de nombres** (`xfdf:annots` → `annots`). Rechaza (`xfdf-invalid`): `<!DOCTYPE`, `<!ENTITY`, entidades desconocidas, etiquetas sin cerrar o cruzadas, más de los límites. Sin recursión (pila explícita) para no desbordar con anidamientos profundos.
2. `src/core/errors.ts`: códigos `'xfdf-invalid'` «El fichero de comentarios no es un XFDF válido.» y `'xfdf-empty'` «El fichero no contiene comentarios que se puedan importar.».
3. `src/core/xfdf/xfdf.ts`:
```ts
export interface XfdfExportOptions { readonly fileName: string; readonly ids: readonly [string, string] | null } // ids hex de pdf.js `doc.fingerprints`
/** Exporta las anotaciones editables (sin firmas `signature`). Orden: el de `all`, con cada `reply`/`review` después de su padre. */
export function exportXfdf(all: ReadonlyMap<string, Annotation>, o: XfdfExportOptions): string;
export interface XfdfImportOptions {
  readonly existingIds: ReadonlySet<string>; // ids del documento (efectivas + borradas)
  readonly pageCount: number;
  readonly newId: () => string;              // suite-<uuid>
  readonly now: string;                      // modified si falta `date`
  readonly author: string;                   // si falta `title`
}
export interface XfdfImportResult { readonly annotations: readonly Annotation[]; readonly skipped: number; readonly duplicates: number }
export function importXfdf(xml: string, o: XfdfImportOptions): Result<XfdfImportResult>;
```
   Formato (atributos comunes en todos: `page` 0-based, `rect` «x1,y1,x2,y2», `color` «#RRGGBB», `opacity`, `title`, `name`, `date` y `creationdate` en fecha PDF, `flags` «print»; hijo `<contents>` con el texto):
   | Tipo | Elemento | Atributos / hijos propios |
   |---|---|---|
   | highlight / underline / strikeout | `highlight` / `underline` / `strikeout` | `coords` = 8 números por quad, separados por comas, en el orden de `Quad` |
   | note | `text` | `icon`; `<popup open="yes|no">` → `open` (al exportar, sin `popup`) |
   | reply | `text` | `inreplyto` = name del padre, `replyType="reply"`, `icon="Comment"` |
   | review | `text` | `inreplyto`, `state`, `statemodel="Review"`, `icon="Comment"` |
   | freetext | `freetext` | `<defaultappearance>/Helv 12 Tf 1 0 0 rg</defaultappearance>` (tamaño y color de texto) |
   | ink | `ink` | `width`; `<inklist><gesture>x,y;x,y;…</gesture>…</inklist>` |
   | square / circle | `square` / `circle` | `width`, `interior-color` |
   | line | `line` | `start="x,y"`, `end="x,y"`, `head` (extremo inicial) y `tail` (final), `width`, `interior-color` |
   | polygon | `polygon` | `width`, `interior-color`; `<vertices>x,y;x,y;…</vertices>` |
   | stamp | `stamp` | `icon` = `name` |
   - Exportar: números con como mucho 4 decimales (`Number(x.toFixed(4))`); color con dos dígitos hex por canal (`Math.round(c × 255)`); fechas con `toPdfDate`; `name` = `id`; texto con `escapeXml`. Cabecera `<?xml version="1.0" encoding="UTF-8"?>`, raíz `<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">`, luego `<annots>…</annots>`, `<f href="…"/>` y, si hay, `<ids original="…" modified="…"/>`.
   - Importar: raíz distinta de `xfdf` o sin `annots` → `xfdf-invalid`; ningún elemento importable → `xfdf-empty`. Cada elemento se valida con `isAnnotation`; inválido, tipo desconocido (`caret`, `fileattachment`, `squiggly`…) o `page` fuera de `[0, pageCount)` → `skipped += 1`. `name` que ya está en `existingIds` → `duplicates += 1`. Id: el `name` si cumple `/^suite-[A-Za-z0-9-]{1,80}$/` y no existe; si no, `newId()`. `origin: { kind: 'new' }`. `inreplyto` se traduce con el mapa `name → id` del propio XFDF o, si no está, contra `existingIds` (un `ref:…` del documento); si no se resuelve, la respuesta se omite (`skipped`). Sin `<contents>` pero con `<contents-richtext>` → su `textOf`.
4. Tests: `tests/unit/xfdf/xml.test.ts`, `tests/unit/xfdf/xfdf.test.ts` y una muestra de Acrobat escrita a mano en el test (un `highlight`, un `text` con `popup` y una respuesta, un `square` con `interior-color`) siguiendo el formato de la tabla.

## Criterios de aceptación
- [ ] Ida y vuelta: un mapa con una anotación de **cada** tipo (resaltado, subrayado, tachado, nota, texto libre, dibujo, rectángulo con relleno, elipse, flecha, polígono, sello, una respuesta y un estado) → `exportXfdf` → `importXfdf` con `existingIds` vacío → mismas anotaciones (`annotationEquals` de `diff.ts` y campos propios iguales, coordenadas con error ≤ 0,0001), mismos ids, la respuesta con el mismo `parentId`.
- [ ] Importar el mismo XFDF con `existingIds` = esos ids → `annotations` vacío, `duplicates` = 13, resultado `ok`.
- [ ] La muestra de Acrobat se importa: 3 anotaciones + 1 respuesta enlazada a su nota; `open` de la nota según `popup`.
- [ ] `parseXml` rechaza `<!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>`, `&foo;`, `<a><b></a></b>` y un texto de 20 000 001 caracteres; acepta CDATA, `&#233;`, `&#xE9;` y prefijos (`<xfdf:annots>`). Un anidamiento de 100 000 niveles no desborda la pila (devuelve `ok` o `xfdf-invalid`, sin lanzar).
- [ ] Elementos `caret` y `squiggly` → `skipped`; `page="99"` con 5 páginas → `skipped`; XFDF sin anotaciones importables → `xfdf-empty`.
- [ ] Las firmas (`signature`) y las ajenas no se exportan.
- [ ] Cobertura de `src/core/xfdf/` ≥ 90 % de líneas.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Interfaz (PDF-111). FDF binario. Valores de formulario (`<fields>`) del XFDF. Texto enriquecido (solo se importa su texto plano).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/xfdf/xfdf.ts` (completado; el código de `xml.ts` y `index.ts` ya estaba bien y no cambió), `apps/lector-pdf/tests/unit/xfdf/xfdf.test.ts` (muestra de Acrobat y una expectativa corregidas). `errors.ts` ya tenía los códigos `xfdf-invalid` y `xfdf-empty`.
- Qué he hecho: revisado el trabajo en curso y corregidos tres fallos. (1) Las notas abiertas perdían `open` al exportar: ahora se escribe `<popup open="yes"/>` solo si la nota está abierta, para cumplir la ida y vuelta. (2) La ficha dice «sin popup» al exportar, pero el criterio de ida y vuelta exige conservar `open`; he priorizado el criterio. Duda para el líder: confirmar esta interpretación. (3) El `color` de un sello importado se fija con `stampColor(name)`, como al crearlo en la app. La muestra de Acrobat pone `coords` como atributo de `highlight` (según la tabla), no como hijo.
- Comandos ejecutados y resultado: `pnpm lint` → 0 avisos. `vitest run tests/unit/xfdf` → 56/56 pasan; cobertura de `src/core/xfdf/xfdf.ts` 99,5 % líneas. `pnpm typecheck` → falla por ficheros que no son míos (`src/core/pdf/page-tree.ts`, `tests/ui/tab-bar.test.tsx`, `tests/unit/tab-close-guard.test.ts`, trabajo de otros programadores); ningún error en `core/xfdf/`. `pnpm coverage` completo: 2956 de 2958 tests pasan; fallan 2 de otros ficheros ajenos (`tests/ui/sidebar.test.tsx`, atajo F4 del panel lateral, en árbol de otros programadores), así que el comando sale con código 1. Cobertura de `core/xfdf/` ≥ 99 % líneas.
- Dudas o cosas que no he podido hacer: (a) conflicto ficha: «al exportar, sin popup» frente a la ida y vuelta de `open`; resuelto a favor de la ida y vuelta. (b) `pnpm typecheck` no pasa por los ficheros ajenos mencionados. (c) No se han hecho tests de `pnpm perf` ni e2e (no aplican a esta ficha). No se ha tocado git (sin commit, según instrucciones).

### [revisor] ronda 1 — 2026-10-19 — APROBADO
- Revisados `src/core/xfdf/{xml,xfdf,index}.ts`, códigos en `errors.ts` y tests. Vitest xfdf 56/56; cobertura de `core/xfdf/` 99,4 % líneas; eslint limpio; `tsc` sin errores en xfdf (los fallos de typecheck son de ficheros ajenos: page-tree, tab-bar).
- Parser sin recursión, rechaza DOCTYPE/entidades/cruzadas/límites. Ida y vuelta, duplicados, Acrobat, skipped y empty cubiertos.
1. (opcional) `xfdf.ts:109` — `<popup open="yes"/>` solo si la nota está abierta contradice «sin popup» de la ficha, pero es necesario para la ida y vuelta de `open`; decisión aceptada.
2. (opcional) `xfdf.ts:169` — el `throw RangeError` es inalcanzable; correcto como guarda de bug.

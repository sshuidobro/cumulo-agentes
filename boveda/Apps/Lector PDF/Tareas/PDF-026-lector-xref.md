---
tipo: tarea
id: PDF-026
titulo: Lector de la tabla de referencias cruzadas y de objetos por rangos
app: pdf
estado: pendiente
depende_de: [PDF-025, PDF-003]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, nucleo, formato]
---

# PDF-026 · Lector de xref y objetos

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]]

## Objetivo
Dado un `ByteSource`, encontrar la última sección xref, recorrer la cadena `/Prev`, y leer cualquier objeto por número **leyendo solo los bytes necesarios** (un PDF de 100 000 páginas no se carga entero). Soporta tabla clásica, *xref stream*, híbridos y *object streams*.

## Contexto
- Leer: `src/core/pdf/*` (PDF-025), `packages/platform/src/types.ts` (`ByteSource`), ISO 32000-1 §7.5.4 (tabla xref: entradas de 20 bytes `nnnnnnnnnn ggggg n\r\n`, toleraremos también 19/21), §7.5.5 (trailer), §7.5.6 (actualizaciones incrementales), §7.5.7 (*object streams*), §7.5.8 (*xref streams*: `/W`, `/Index`, tipos 0/1/2; `/W` con 0 en el primer campo → tipo 1 por defecto), §7.5.8.4 (híbridos `/XRefStm`), §7.4.4.4 (predictores PNG: `/DecodeParms << /Predictor 12 /Columns n >>`, filtros por fila 0-4).
- Dependencia nueva aprobada en [[ADR-0009-anotaciones-escritor-incremental]]: `fflate` versión exacta `0.8.3` (en `dependencies` de `apps/lector-pdf`). Usa `unzlibSync` (y `inflateSync` como reserva si la cabecera zlib es inválida).
- Fixtures: `basic-5.pdf` (tabla), `compressed.pdf` (xref stream + ObjStm), `incremental-updates.pdf` (3 secciones), `corrupt-bad-startxref.pdf`, `pages-100000.pdf`; corpus `7.10-t01-pass-a.pdf` (5 actualizaciones) y `7.18.4-t01-pass-a.pdf` (ObjStm).

## Qué hay que hacer
1. `src/core/pdf/filters.ts`:
   ```ts
   export function decodeStreamData(s: PdfStream): Uint8Array; // /Filter ausente o /FlateDecode (nombre o array de 1); /DecodeParms con /Predictor 1, 2 (TIFF, solo 8 bits) o 10-15 (PNG). Otros filtros → throw new PdfSyntaxError('Filtro no soportado: <nombre>', 0)
   export function flateEncode(data: Uint8Array): Uint8Array;   // zlibSync nivel 6 (lo usarán las apariencias)
   ```
2. `src/core/pdf/xref.ts`:
   ```ts
   export type XrefEntry = { readonly type: 'free' } | { readonly type: 'offset'; readonly offset: number; readonly gen: number } | { readonly type: 'compressed'; readonly objStm: number; readonly index: number };
   export interface XrefInfo {
     readonly entries: ReadonlyMap<number, XrefEntry>;  // vista fusionada: la sección más nueva gana
     readonly trailer: PdfDict;                          // trailer de la ÚLTIMA sección (para xref stream, su diccionario)
     readonly lastXrefOffset: number;                    // el valor del último startxref
     readonly lastKind: 'table' | 'stream';
     readonly size: number;                              // /Size del último trailer
     readonly sections: number;                          // cuántas secciones se leyeron
   }
   export async function readXref(src: ByteSource): Promise<XrefInfo>;
   ```
   - Lee los últimos 2 048 bytes (o todo si es menor), busca el **último** `startxref`, lee el número. Si apunta fuera del fichero o no hay `xref`/objeto `XRef` allí → `PdfSyntaxError('xref-unreadable')`.
   - Lee cada sección pidiendo bloques de 64 KB a partir del offset (amplía si la sección es más larga). Tabla: subsecciones `inicio cantidad`; entradas `n`/`f`. Trailer: `/Prev`, `/XRefStm` (híbrido: sus entradas se aplican **antes** que las de la tabla de la misma sección, es decir, la tabla gana). Stream: decodifica, recorre `/Index` (por defecto `[0 Size]`) con `/W`.
   - Cadena `/Prev`: offsets ya visitados → corta (bucle); máximo 1 000 secciones.
   - Si el trailer final tiene `/Encrypt` → `PdfSyntaxError('encrypted')`.
3. `src/core/pdf/object-reader.ts`:
   ```ts
   export class ObjectReader {
     static async open(src: ByteSource): Promise<ObjectReader>; // readXref + caché
     readonly xref: XrefInfo;
     get(r: PdfRef): Promise<PdfValue>;            // objetos libres o inexistentes → null (§7.3.10)
     resolve(v: PdfValue | undefined): Promise<PdfValue | undefined>; // si es ref, get; si no, el mismo valor
     getDict(r: PdfRef): Promise<PdfDict | null>;  // null si no es diccionario (o el dict de un stream)
     pageRefs(): Promise<readonly PdfRef[]>;       // recorre /Root /Pages en orden; detecta ciclos; cachea
   }
   ```
   - `get`: tipo `offset` → lee un bloque de 4 KB desde el offset (amplía hasta encontrar `endobj`; para streams usa `/Length`, resolviendo `/Length` indirecto con otra lectura) y comprueba que `num gen obj` coincide (si no → `PdfSyntaxError`). Tipo `compressed` → lee y decodifica el ObjStm (cacheado: un `Map` LRU de 16 ObjStm), cabecera `/N` pares `num offset` relativos a `/First`.
   - Caché de objetos: LRU de 2 000 entradas.
   - `pageRefs` en `pages-100000.pdf`: lee solo nodos `/Pages` y `/Kids`, nunca el contenido de las páginas.
4. Tests `tests/unit/pdf/xref.test.ts`, `object-reader.test.ts`, `filters.test.ts`. Usa un `ByteSource` de prueba que **cuenta** los bytes leídos (envuelve `memorySource`).

## Criterios de aceptación
- [ ] (T) `basic-5.pdf`: `lastKind 'table'`, `sections 1`; `pageRefs()` devuelve 5 refs y `getDict(pageRefs()[0])` tiene `/Type /Page`.
- [ ] (T) `compressed.pdf`: `lastKind 'stream'`; el catálogo (`/Root`) está dentro de un ObjStm y se lee; 50 `pageRefs`.
- [ ] (T) `incremental-updates.pdf`: `sections 3`; el `/Info` resuelto tiene `/Title` `Actualizado dos veces` (el objeto más nuevo gana).
- [ ] (T) Un PDF con `/Prev` que apunta a sí mismo (construido en el test con `appendIncrementalUpdate` y el offset alterado) termina sin colgarse.
- [ ] (T) `corrupt-bad-startxref.pdf` → `PdfSyntaxError` con mensaje `xref-unreadable`; un trailer con `/Encrypt 9 0 R` → `encrypted`.
- [ ] (T) Predictor PNG: un xref stream con `/DecodeParms << /Predictor 12 /Columns 7 >>` (filas con filtro Up) se lee igual que sin predictor.
- [ ] (T) Por rangos: en `pages-100000.pdf`, `ObjectReader.open` + `pageRefs()` + `getDict` de la página 99 999 leen < 25 % del fichero y tardan < 3 s (anota bytes y tiempo).
- [ ] (T) Corpus: los 7 PDFs veraPDF y los 3 de LibreOffice abren con `ObjectReader` y `pageRefs().length` coincide con `numPages` de pdf.js.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; `xref.ts`, `object-reader.ts`, `filters.ts` ≥ 90 % de líneas.

## Fuera de alcance
- Reconstruir xref dañadas (llegará con organizar páginas, PDF-052). Cifrado (PDF-047). Escribir (PDF-028).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

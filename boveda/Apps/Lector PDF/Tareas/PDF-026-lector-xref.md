---
tipo: tarea
id: PDF-026
titulo: Lector de la tabla de referencias cruzadas (xref) y filtros de streams
app: pdf
estado: cambios-pedidos
depende_de: [PDF-025, PDF-003]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, nucleo, formato]
---

# PDF-026 · Lector de xref y filtros

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]] · [[ADR-0014-localizar-paginas-por-count]] · [[ADR-0012-suite-de-rendimiento]]

> **Replanificada por el líder (2026-10-17).** La ficha original se ha partido: aquí quedan `filters.ts` y `xref.ts`; `ObjectReader`, la caché de bloques y la localización de páginas pasan a [[PDF-068-lector-objetos]]. El criterio imposible (< 25 % con `pageRefs()` completo) desaparece; ver [[ADR-0014-localizar-paginas-por-count]].

## Objetivo
Dado un `ByteSource`, encontrar la última sección xref, recorrer la cadena `/Prev` y devolver la vista fusionada de entradas, **sin leer los objetos** del fichero. Soporta tabla clásica, *xref stream*, híbridos (`/XRefStm`) y predictores PNG.

## Contexto
- Leer: `src/core/pdf/*` (PDF-025: `parseValue`, `parseIndirectObject`, `PdfSyntaxError`, `dictGet`), `packages/platform/src/types.ts` (`ByteSource`), `tests/helpers/pdfjs-node.ts` (`countingSource`, reutilízalo), `tests/perf/measure.ts`, ISO 32000-1 §7.5.4 (tabla: entradas de 20 bytes `nnnnnnnnnn ggggg n\r\n`; tolera también 19/21), §7.5.5 (trailer), §7.5.6 (incrementales), §7.5.8 (*xref streams*: `/W`, `/Index`, tipos 0/1/2; `/W` con 0 en el primer campo → tipo 1 por defecto; sus valores son siempre directos, así que se analizan con `parseIndirectObject` sin resolver nada), §7.5.8.4 (híbridos), §7.4.4.4 (predictores PNG, filtros por fila 0-4).
- Dependencia ya instalada (sin commit, consérvala): `fflate` `0.8.3` en `dependencies` de `apps/lector-pdf` ([[ADR-0009-anotaciones-escritor-incremental]]). Usa `unzlibSync` y `inflateSync` como reserva si la cabecera zlib es inválida.
- Fixtures: `basic-5.pdf`, `compressed.pdf` (xref stream + ObjStm), `incremental-updates.pdf` (3 secciones), `corrupt-bad-startxref.pdf`, `pages-100000.pdf`; corpus `7.10-t01-pass-a.pdf` (5 actualizaciones) y `7.18.4-t01-pass-a.pdf` (ObjStm).

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
   - Lee los últimos 2 048 bytes (o todo si es menor), busca el **último** `startxref` y lee el número. Si apunta fuera del fichero o allí no hay `xref` ni un objeto `/Type /XRef` → `PdfSyntaxError('xref-unreadable', offset)`.
   - Lee cada sección con bloques de 64 KB desde su offset (pide otro bloque si la sección sigue). Tabla: subsecciones `inicio cantidad`; entradas `n`/`f`. Trailer: `/Prev`, `/XRefStm` (híbrido: sus entradas se aplican **antes** que las de la tabla de la misma sección; la tabla gana). Stream: `decodeStreamData`, recorre `/Index` (por defecto `[0 Size]`) con `/W`.
   - Fusión: se recorren las secciones de la más nueva a la más antigua y una entrada solo se añade si el número aún no está en el mapa.
   - Reglas fijadas por el líder (dudas del programador, ronda 1): entrada `n` con offset 0 → `free`; `/Prev` que apunta fuera del fichero o a algo que no es xref → `PdfSyntaxError('xref-unreadable')`; `/Prev` a un offset ya visitado → se corta la cadena **sin error**; más de 1 000 secciones → `PdfSyntaxError('xref-unreadable')`.
   - Si el trailer final tiene `/Encrypt` → `PdfSyntaxError('encrypted', 0)`.
   - Exporta `filters.ts` y `xref.ts` desde `src/core/pdf/index.ts`.
3. Tests `tests/unit/pdf/filters.test.ts`, `tests/unit/pdf/xref.test.ts` (con `countingSource(memorySource(bytes))`) y `tests/perf/xref.perf.test.ts` (tiempo, con `measureBest`).

## Criterios de aceptación
- [ ] (T) `basic-5.pdf`: `lastKind 'table'`, `sections 1`, `entries.size === size`, la entrada de `/Root` es `offset` y los bytes en ese offset empiezan por `<num> <gen> obj`.
- [ ] (T) `compressed.pdf`: `lastKind 'stream'`; la entrada del objeto `/Root` es de tipo `compressed` con `objStm` cuya entrada es `offset`.
- [ ] (T) `incremental-updates.pdf`: `sections 3`; la entrada de `/Info` apunta a un objeto cuyos bytes contienen `Actualizado dos veces` (gana la sección más nueva).
- [ ] (T) `/Prev` que apunta a sí mismo (construido en el test con `appendIncrementalUpdate` y el offset alterado) termina sin colgarse y sin error; `/Prev 999999999` → `xref-unreadable`.
- [ ] (T) `corrupt-bad-startxref.pdf` → `PdfSyntaxError` con mensaje `xref-unreadable`; un trailer con `/Encrypt 9 0 R` → `encrypted`.
- [ ] (T) Predictor PNG: un xref stream con `/DecodeParms << /Predictor 12 /Columns 7 >>` (filas con filtro Up) da las mismas entradas que sin predictor; `decodeStreamData(flate(x)) === x` y `/Filter /LZWDecode` → `Filtro no soportado: LZWDecode`.
- [ ] (T) Por rangos: `readXref` sobre `pages-100000.pdf` lee **< 14 %** del fichero (la tabla ocupa el 13,1 %; anota bytes y % en el Registro). `entries.size === 203232`.
- [ ] (T, perf) `tests/perf/xref.perf.test.ts`: `readXref(pages-100000.pdf)` < 1 s (mejor de 5). Ningún `performance.now` en `tests/unit/`.
- [ ] (T) Corpus: los 7 PDFs veraPDF y los 3 de LibreOffice → `readXref` no lanza y `size` > 0; `7.10-t01-pass-a.pdf` → `sections` ≥ 5.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm perf`, `pnpm coverage` con código 0; `xref.ts` y `filters.ts` ≥ 90 % de líneas.

## Fuera de alcance
- `ObjectReader`, lectura de objetos y localización de páginas ([[PDF-068-lector-objetos]]). Tabla xref perezosa (ver [[ADR-0014-localizar-paginas-por-count]]). Reconstruir xref dañadas (PDF-052). Cifrado (PDF-047). Escribir (PDF-028).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/package.json` (añadida `"fflate": "0.8.3"` en `dependencies`, según ADR-0009), `pnpm-lock.yaml`. Sin código de `src/core/pdf/` todavía (ficha bloqueada antes de implementar).
- Qué he hecho: (1) Lint y typecheck de `tests/unit/pdf/fuzz-roundtrip.test.ts` no reproducen errores (`eslint --max-warnings 0` y `tsc` salen con 0; el test pasa 4/4); lo he commiteado como `ecf7c2a` ("PDF-025: Tests de ida y vuelta (fuzz)..."). (2) Preparé PDF-026 (`en-curso`) y comprobé el criterio de rango sobre el fixture real.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm exec vitest run .../fuzz-roundtrip.test.ts` 4/4 OK; medición con node sobre `fixtures/pdf/generated/pages-100000.pdf` (31 101 661 bytes): 100 000 páginas hoja (`/Type /Page`) ocupan 11 788 910 bytes (**37,9 %** del fichero); tabla xref 13,1 %; 3 228 nodos `/Pages`.
- Dudas o cosas que no he podido hacer:
  1. **Criterio imposible tal como está escrito.** El criterio (T) "`ObjectReader.open` + `pageRefs()` + `getDict` de la página 99 999 leen < 25 % del fichero" no se puede cumplir con un `pageRefs` correcto. Para saber si un `Kid` es hoja o nodo hay que leer su diccionario (`/Kids` solo aparece en los nodos), y solo las hojas ya suman el 37,9 % del fichero (más la tabla xref, 13,1 %). Cualquier implementación que lea las hojas incumple el 25 %; clasificar sin leerlas sería adivinar.
  2. Opciones para el líder (decisión de criterio, no mía): (a) cambiar el presupuesto (p. ej. medir solo los bytes de `pageRefs` y de la página 99 999 y dar otro umbral); (b) regenerar `pages-100000.pdf` con las páginas dentro de object streams comprimidos (PDF-003), con lo que el coste medido baja mucho; (c) aceptar que `pageRefs` lea las hojas y medir el presupuesto solo sobre `getDict` de la página 99 999.
  3. Dudas de diseño menores que tomaría si se confirma la ficha (las anoto para que el líder las valide): `getDict` de un stream devuelve su diccionario; una referencia con `gen` distinto del de la entrada `offset` se trata como `null`; una entrada `n` con offset 0 se trata como libre; `/Prev` roto o más de 1 000 secciones → `PdfSyntaxError`.
  4. No he escrito `filters.ts`, `xref.ts` ni `object-reader.ts`, porque el criterio de rango debe decidirse antes de implementar el lector por rangos. Cambios sin commit (dependencia `fflate` ya aprobada en ADR-0009; si el líder prefiere, se revierte).

Estado: `bloqueada` a la espera de la decisión sobre el criterio de rango.

### [líder] replanificación — 2026-10-17
- Análisis del programador correcto: con `pageRefs()` completo el < 25 % era imposible (hojas 37,9 % + xref 13,1 %).
- Decisión técnica: [[ADR-0014-localizar-paginas-por-count]]. El escritor solo necesita las páginas tocadas → `pageRef(index)` por descenso con `/Count` + caché de bloques de 4 KB. Simulado sobre los fixtures: 13,2 % para la página 99 999.
- Ficha partida: aquí quedan `filters.ts` + `xref.ts`; `ObjectReader` pasa a [[PDF-068-lector-objetos]] (depende de esta). Criterio de rango nuevo: solo `readXref` < 14 %. Tiempos a `tests/perf/` (ADR-0012).
- Dudas menores del programador resueltas en «Qué hay que hacer» (offset 0 → libre; `/Prev` roto o > 1 000 secciones → `xref-unreadable`; bucle → corta sin error). `getDict` de stream y `gen` distinto → ver PDF-068 (aceptadas tal como las propuso).
- `fflate@0.8.3` en `package.json`/`pnpm-lock.yaml` se conserva (ADR-0009); se commitea con esta ficha.
- Estado → `cambios-pedidos` (no cuenta como rechazo; `intentos` sigue en 0).

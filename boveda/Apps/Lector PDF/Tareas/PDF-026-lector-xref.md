---
tipo: tarea
id: PDF-026
titulo: Lector de la tabla de referencias cruzadas (xref) y filtros de streams
app: pdf
estado: hecha
depende_de: [PDF-025, PDF-003]
intentos: 1
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

### [programador] ronda 2 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/src/core/pdf/filters.ts` (nuevo), `apps/lector-pdf/src/core/pdf/xref.ts` (nuevo), `apps/lector-pdf/src/core/pdf/index.ts` (exporta ambos), `apps/lector-pdf/tests/unit/pdf/filters.test.ts`, `apps/lector-pdf/tests/unit/pdf/xref.test.ts`, `apps/lector-pdf/tests/perf/xref.perf.test.ts`. Dependencia `fflate` 0.8.3 (`package.json` y `pnpm-lock.yaml`) sin cambios nuevos.
- Qué he hecho: `filters.ts` con `decodeStreamData` (sin filtro, FlateDecode con zlib y reserva deflate crudo, predictores TIFF 2 y PNG 10-15; otros filtros → `Filtro no soportado: <nombre>`) y `flateEncode` (zlib nivel 6). `xref.ts` con `readXref`: tabla clásica (tolera 19/20/21 bytes), xref stream (`/W`, `/Index`, tipos 0/1/2), híbridos (`/XRefStm`, la tabla gana), cadena `/Prev` con las reglas de la ficha y `/Encrypt` → `encrypted`. Lee por bloques de 64 KB; la ventana crece solo si una estructura no cabe.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm test` 69 ficheros / 892 tests OK; `pnpm coverage` OK (`xref.ts` 92,5 % líneas, `filters.ts` 94,0 %); `pnpm perf` OK (9 ficheros / 14 tests, incluido `xref.perf.test.ts`). Medido con `countingSource` sobre `pages-100000.pdf` (31 101 661 bytes): **4 201 652 bytes leídos (13,51 %)** en 68 lecturas; 203 232 entradas; una pasada de `readXref` ≈ 142 ms.
- Dudas o cosas que no he podido hacer:
  1. Decisiones menores que he tomado y conviene validar: (a) una entrada `1` de xref stream con offset 0 se conserva como `offset` (la regla de offset 0 solo se aplica a la tabla clásica); (b) tipos desconocidos en xref stream → `free`; (c) xref stream sin `/Type /XRef` → `xref-unreadable`; (d) filas incompletas al final de un xref stream se ignoran en silencio; (e) `/Filter` con más de un filtro → `Filtro no soportado` con la lista.
  2. Las fichas PDF-009 y PDF-021, mencionadas en el encargo en paralelo, no las he tocado: no son de esta ficha.
  3. El fichero `apps/lector-pdf/tests/ui/tauri-integration.test.tsx` (sin commit, de otro agente) dio un error de tipos en una pasada anterior; en la última pasada `pnpm typecheck` salió limpio. No lo he modificado.

Estado: `en-revision`.

### [revisor] ronda 1 — 2026-10-17 — APROBADO
Lint, typecheck, tests de xref/filters (35/35) y `pnpm perf` (14/14) en verde. Cobertura: `xref.ts` 92,5 % y `filters.ts` 94,0 % de líneas. Cada criterio de la ficha tiene su test. La lectura de `pages-100000.pdf` cumple el límite del 14 % (13,51 % según el programador). Las decisiones menores del programador (tipos desconocidos → `free`, filas incompletas ignoradas, varios filtros → error) son razonables.
1. (opcional) `filters.ts:54` — `unzlibSync` no limita el tamaño descomprimido, así que un xref stream malicioso podría hacer una bomba de descompresión — poner un tope cuando llegue el endurecimiento (PDF-052 o similar).
2. (opcional) `tests/perf/xref.perf.test.ts` — duplica `measureBest` en versión asíncrona — extraer una variante asíncrona a `tests/perf/measure.ts`.

### [tester] ronda 1 — 2026-10-17 — FALLA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Comparación con qpdf | PASA | Script temporal: `readXref` vs `qpdf --show-xref` (qpdf 11.9.0) sobre los 23 PDF no corruptos de generated/, verapdf y libreoffice: mismas entradas (offset/gen y objStm/index) en los 23 |
| Criterios (T) de la ficha, lint, typecheck, `pnpm test` | PASA | lint y typecheck OK; 69 ficheros / 892 tests OK |
| `pnpm perf` | PASA | 9 ficheros / 14 tests OK |
| Robustez: truncados, bytes corrompidos (1 200 casos), vacío, 1 byte | PASA | `xref-robustness.test.ts`: solo `PdfSyntaxError`, sin cuelgues |
| Robustez: bomba de descompresión | FALLA | defecto de seguridad (abajo) |

**Defecto (seguridad, rechazo según el encargo):** `filters.ts` `inflate()` llama a `unzlibSync` sin límite de tamaño de salida.
Reproducir: `pnpm exec vitest run apps/lector-pdf/tests/unit/pdf/xref-robustness.test.ts`. Un PDF de ~1 MB con un xref stream cuyo Flate expande a 1 GiB de ceros: `readXref` reserva 1 GiB, tarda ~16 s y devuelve un resultado en lugar de rechazar. Con unos 4 MB se agotaría la memoria del proceso. Lo mismo ocurre con `decodeStreamData`.
Arreglo esperado: tope de salida en `decodeStreamData` (para xref, p. ej. `size * suma(W)` según `/Index`/`/Size`, o un máximo absoluto) con `PdfSyntaxError`. Usar `Inflate`/`Zlib` en streaming de fflate o `unzlibSync` con `out` acotado. Ambos tests rojos están escritos y deben pasar.
Tests añadidos: `apps/lector-pdf/tests/unit/pdf/xref-robustness.test.ts` (5 tests; 2 rojos a propósito por la bomba).
Rendimiento: `pnpm perf` OK; el programador anotó 13,51 % de bytes y ~142 ms para `pages-100000.pdf`.

### [programador] ronda 3 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/src/core/pdf/filters.ts` (tope de descompresión), `apps/lector-pdf/src/core/pdf/xref.ts` (tope por xref stream), `apps/lector-pdf/tests/unit/pdf/filters.test.ts` (3 tests del tope), `apps/lector-pdf/tests/unit/pdf/xref-robustness.test.ts` (test del revisor-tester, sin cambios; ahora pasa).
- Qué he hecho: arreglo de la bomba de descompresión (defecto del tester). `inflate` pasa a ser en streaming (`Unzlib`/`Inflate` de fflate) y corta en cuanto la salida supera el tope, con `PdfSyntaxError('Flujo descomprimido demasiado grande (más de N bytes)')`; ya no se reserva el total antes de comprobarlo. **Límite elegido:** `MAX_DECODED_BYTES = 64 MiB` como tope absoluto de `decodeStreamData(s, maxBytes?)`. Para xref stream el tope es más estricto: (suma de `/W` + 1 byte de predictor) × número de entradas de `/Index` (o `/Size`), con un mínimo de una fila, y nunca más que el absoluto. Los tests de robustez no se han debilitado.
- Comandos ejecutados y resultado: `pnpm exec vitest run` sobre `filters`, `xref`, `xref-robustness` → 40/40 OK (la bomba de 1 GiB ahora da error controlado); `pnpm lint` OK; `pnpm typecheck` de `apps/lector-pdf` OK (la raíz falló una vez por `src/state/annotation-actions.ts`, fichero de otro agente en curso, no tocado); `pnpm test` 899/900, el único fallo (`tests/ui/open.test.tsx`, «scanAnnotations» no definido en el mock) es de código de PDF-030 en curso en el mismo árbol y pasa 10/10 aislado; `pnpm perf` `xref.perf` 1/1 OK; cobertura (`filters.test` + `xref.test`): `filters.ts` 95,0 % y `xref.ts` 93,0 % de líneas.
- Dudas o cosas que no he podido hacer: (1) el tope de 64 MiB es un criterio mío para documentar; si el líder prefiere otro valor, es una constante. (2) `PDF-010` y `PDF-030` (encargados en paralelo) no los he tocado: sus ficheros (`engine/render.ts`, `ui/viewer/PageView.tsx`, `state/annotation-actions.ts`, etc.) ya están en el árbol sin commit de otro agente y no los he modificado para no pisar ese trabajo. (3) El commit incluye solo los ficheros de esta ficha.

Estado: `en-revision`.

### [revisor] ronda 2 — 2026-10-17 — APROBADO
Lint y typecheck en verde; filters, xref y xref-robustness 43/43 (la bomba de 1 GiB ahora da `PdfSyntaxError` controlado). `inflateStream` corta en streaming al pasar el tope (`MAX_DECODED_BYTES` 64 MiB; en xref stream `(suma /W + 1) × entradas`, acotado), también en la reserva con deflate crudo. Los predictores no amplían la salida. Tests del tope en el límite exacto (n y n-1), tope por defecto y mensaje. Sin problemas bloqueantes.
1. (opcional) `tests/perf/xref.perf.test.ts` — sigue duplicando `measureBest` asíncrono — extraer a `tests/perf/measure.ts`.

### [tester] ronda 2 — 2026-10-17 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Bomba de descompresión (defecto ronda 1) | PASA | `xref-robustness.test.ts` 5/5: `readXref` y `decodeStreamData` lanzan `PdfSyntaxError` ante Flate de 72 MiB de ceros |
| lint, typecheck | PASA | `pnpm lint` y `pnpm typecheck` con código 0 |
| `pnpm test` | PASA | 74 ficheros / 923 tests OK |
| `pnpm perf` | PASA | 9 ficheros / 14 tests OK (incluye `xref.perf`) |
| Cobertura (directorio propio, filters+xref+robustness) | PASA | `filters.ts` 95,04 % y `xref.ts` 96,51 % de líneas (>= 90 %); 43/43 tests |
| Criterios (T) de la ficha | PASA | cubiertos por `xref.test.ts`/`filters.test.ts`; 13,51 % de bytes leídos en `pages-100000.pdf` (dato del programador, test < 14 % verde) |

Observación y ajuste mío: el test de la bomba de ronda 1 generaba 1 GiB comprimiéndolo (~13 s + ~15 s) y expiraba (60 s) con `--coverage`. Lo he sustituido por una bomba de 72 MiB (supera el tope de 64 MiB) generada una sola vez; mantiene la comprobación y ahora tarda segundos con cobertura.
Tests añadidos/modificados: `apps/lector-pdf/tests/unit/pdf/xref-robustness.test.ts`.
Rendimiento: `pnpm perf` OK; `readXref` de `pages-100000.pdf` ≈ 142 ms (programador), presupuesto < 1 s.

---
tipo: tarea
id: PDF-068
titulo: Lector de objetos por rangos y localización de páginas por /Count
app: pdf
estado: en-curso
depende_de: [PDF-026]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, nucleo, formato]
---

# PDF-068 · Lector de objetos y páginas

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]] · [[ADR-0014-localizar-paginas-por-count]] · [[ADR-0012-suite-de-rendimiento]] · Origen: [[PDF-026-lector-xref]] (partida)

## Objetivo
`ObjectReader` lee cualquier objeto por número **leyendo solo los bytes necesarios** (a través de una caché de bloques) y localiza la referencia de la página `i` bajando por el árbol `/Pages` con `/Count`, sin leer las demás hojas. Es lo que usa el escritor incremental ([[PDF-028-escritor-incremental]]).

## Contexto
- Leer: `src/core/pdf/xref.ts` y `filters.ts` (PDF-026), `src/core/pdf/parser.ts` (`parseValue`, `parseIndirectObject`, `LengthResolver` es **síncrono**), `objects.ts` (`PdfSyntaxError`, `dictGet`, `ref`), `packages/platform/src/types.ts` (`ByteSource`), `tests/helpers/pdfjs-node.ts` (`countingSource`), `tests/perf/measure.ts`, ISO 32000-1 §7.3.10 (objetos indirectos; ref a objeto libre = `null`), §7.5.7 (*object streams*: `/N`, `/First`, pares `num offset`), §7.7.3 (árbol de páginas: `/Kids`, `/Count`, `/Parent`).
- Fixtures: `basic-5.pdf`, `compressed.pdf` (catálogo dentro de ObjStm, 50 páginas), `incremental-updates.pdf`, `pages-5000.pdf`, `pages-100000.pdf` (fanout 32), `pages-20000-flat.pdf`, corpus veraPDF (7) y LibreOffice (3).
- Medición previa del líder (simulación, ver ADR-0014): abrir + `pageRef(99 998)` en `pages-100000.pdf` ≈ 13,2 % (casi todo la xref).

## Qué hay que hacer
1. `src/core/pdf/block-cache.ts`:
   ```ts
   export class BlockCache implements ByteSource {
     constructor(src: ByteSource, opts?: { readonly blockSize?: number; readonly maxBlocks?: number }); // por defecto 4096 y 256
     readonly size: number;
     read(begin: number, end: number): Promise<Uint8Array>; // recorta end a size
   }
   ```
   - Bloques alineados (`k * blockSize`). Los bloques que faltan y son **contiguos** se piden en **una** sola llamada a `src.read`. LRU por bloque (un `Map` reordenado al usar).
   - Peticiones de más de 64 KB van directas a `src` sin pasar por la caché.
2. `src/core/pdf/object-reader.ts`:
   ```ts
   export class ObjectReader {
     static async open(src: ByteSource): Promise<ObjectReader>; // readXref(src) + new BlockCache(src)
     readonly xref: XrefInfo;
     get(r: PdfRef): Promise<PdfValue>;            // libre, inexistente o gen distinto de la entrada → null
     resolve(v: PdfValue | undefined): Promise<PdfValue | undefined>; // ref → get; si no, el mismo valor
     getDict(r: PdfRef): Promise<PdfDict | null>;  // dict, o el dict de un stream; otra cosa → null
     pageCount(): Promise<number>;                 // /Count del nodo raíz si es entero ≥ 0; si no, (await pageRefs()).length
     pageRef(index: number): Promise<PdfRef>;      // ver pseudocódigo; no existe → PdfSyntaxError('page-not-found', 0)
     pageRefs(): Promise<readonly PdfRef[]>;       // recorrido completo en orden (lee todas las hojas); cacheado
   }
   ```
   - `get` tipo `offset`: lee 4 KB desde el offset por la caché (dobla la ventana hasta encontrar `endobj`, máximo hasta el final del fichero). Comprueba que `num gen obj` coincide; si no → `PdfSyntaxError('object-mismatch', offset)`. Stream con `/Length N G R`: analiza primero el diccionario con `parseValue` (justo tras `obj`), `await get(lengthRef)` y llama a `parseIndirectObject(bytes, 0, () => length)`; si `/Length` no es entero válido, resolver `null` (el analizador busca `endstream`).
   - `get` tipo `compressed`: lee el ObjStm con `get`, `decodeStreamData`, cabecera de `/N` pares `num offset` relativos a `/First`; valor con `parseValue`. Caché de ObjStm decodificados: LRU de 16.
   - Caché de objetos: LRU de 2 000 entradas (clave `num`).
   - `pageRef(index)`, pseudocódigo obligatorio:
     ```
     node = ref de /Root → /Pages; rem = index; mustBeOne = false; visited = Set()
     loop:
       si node no es ref o visited tiene node.num → return fallback(index); visited.add
       d = getDict(node); si null → fallback
       kids = resolve(d./Kids)
       si kids no es array:                         // hoja
         return rem === 0 ? node : fallback
       count = d./Count
       si mustBeOne y count !== 1 → fallback
       si count es entero y count === kids.length:  // atajo: cada hijo es 1 página
         node = kids[rem]; rem = 0; mustBeOne = true; continue   // kids[rem] undefined → fallback
       mustBeOne = false; elegido = null
       para cada kid de kids:
         kd = getDict(kid); si null → continue
         n = (kd tiene /Kids) ? (/Count entero ≥ 0 ? /Count : return fallback) : 1
         si rem < n → elegido = kid; break
         rem -= n
       si elegido null → fallback; node = elegido
     fallback(i) = (await pageRefs())[i] ?? throw PdfSyntaxError('page-not-found', 0)
     ```
   - `pageRefs()`: recorrido en profundidad iterativo (pila), en orden de `/Kids`; un nodo sin `/Kids` es hoja; nodo ya visitado → se salta (ciclos); refs que no resuelven a dict → se saltan.
3. Exporta `BlockCache` y `ObjectReader` desde `src/core/pdf/index.ts`.
4. Tests `tests/unit/pdf/block-cache.test.ts`, `tests/unit/pdf/object-reader.test.ts`, `tests/perf/object-reader.perf.test.ts`. Los PDFs con árbol incoherente se construyen en el test con `serializeIndirect` y una tabla xref escrita a mano (helper en `tests/unit/pdf/helpers.ts`).

## Criterios de aceptación
- [ ] (T) `BlockCache`: dos lecturas en el mismo bloque → 1 llamada a `src.read`; una lectura que cruza 3 bloques sin cachear → 1 llamada; con `maxBlocks 2`, el bloque menos usado se descarta; lectura de 100 KB → directa; `read(size - 10, size + 50)` devuelve 10 bytes.
- [ ] (T) `basic-5.pdf`: `pageCount() === 5`; `pageRefs()` 5 refs; `getDict(pageRef(0))` tiene `/Type /Page`; `pageRef(i)` igual a `pageRefs()[i]` para todo `i`; `pageRef(5)` y `pageRef(-1)` → `page-not-found`.
- [ ] (T) `compressed.pdf`: el catálogo (en ObjStm) se lee; `pageCount() === 50`; `pageRef(49)` igual a `pageRefs()[49]`.
- [ ] (T) `incremental-updates.pdf`: `resolve(trailer /Info)` tiene `/Title` `Actualizado dos veces`.
- [ ] (T) `get` de un objeto libre, de un número > `size` y de una ref con `gen` distinto → `null`; offset que apunta a otro objeto → `object-mismatch`; stream con `/Length` indirecto se lee completo.
- [ ] (T) Árbol incoherente: `/Count` del raíz mentiroso (dice 10, hay 3 páginas) → `pageRef(2)` correcto (vía fallback) y `pageRef(5)` → `page-not-found`; `/Count` = número de hijos pero un hijo es un `/Pages` con 2 páginas y otro un `/Pages` vacío → `pageRef` igual a `pageRefs()` para todo `i`; ciclo en `/Kids` → `pageRefs()` y `pageRef` terminan.
- [ ] (T) Por rangos: `pages-100000.pdf` con `countingSource`: `ObjectReader.open` + `pageRef(99998)` + `getDict` de esa página leen **< 15 %** del fichero; el dict tiene `/Type /Page`. Además, 10 `pageRef` a índices fijos repartidos (`[0, 12345, 25000, 37777, 50000, 62500, 75000, 87654, 99000, 99999]`) dejan el total < 16 %. Anota bytes y % en el Registro.
- [ ] (T) `pages-20000-flat.pdf` (un solo `/Pages` con 20 000 hijos): `pageRef(19999)` usa el atajo y devuelve lo mismo que el hijo 19 999 del raíz.
- [ ] (T, perf) `tests/perf/object-reader.perf.test.ts`: abrir + `pageRef(99998)` + `getDict` en `pages-100000.pdf` < 1,5 s; `pageRefs()` de `pages-5000.pdf` < 1 s (mejor de 5). Ningún `performance.now` en `tests/unit/`.
- [ ] (T) Corpus: los 7 PDFs veraPDF y los 3 de LibreOffice → `pageRefs().length` y `pageCount()` coinciden con `numPages` de pdf.js, y `pageRef(i)` = `pageRefs()[i]` para todo `i`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm perf`, `pnpm coverage` con código 0; `object-reader.ts` y `block-cache.ts` ≥ 90 % de líneas.

## Fuera de alcance
- Tabla xref perezosa ([[ADR-0014-localizar-paginas-por-count]]). Reconstruir xref dañadas (PDF-052). Cifrado (PDF-047). Escribir (PDF-028). Índice inverso página → número (no hace falta en esta iteración).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

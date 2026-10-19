---
tipo: tarea
id: PDF-054
titulo: Extraer y dividir - planes y operaciones del núcleo
app: pdf
estado: en-revision
depende_de: [PDF-123, PDF-118]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-5, organizar, nucleo]
---

# PDF-054 · Extraer y dividir: planes y operaciones del núcleo

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0035-organizar-en-la-app]], [[ADR-0028-reescribir-pdfs]], [[ADR-0032-exportar-imagenes-y-texto]] (nombres y ZIP) · Paridad: [[Paridad Adobe Acrobat]] · Antes: [[PDF-121-documento-nuevo]], [[PDF-122-destinos-e-indice-al-copiar]], [[PDF-123-formularios-al-copiar]] · Sigue: [[PDF-127-extraer-dividir-interfaz]]

## Objetivo
Extraer un rango de páginas a un PDF nuevo y dividir un PDF por número de páginas, por marcadores de primer nivel o por tamaño máximo de fichero, como operaciones del Worker que devuelven el PDF o un ZIP con las partes.

## Contexto
- `src/core/pdf/new-document.ts` → `buildNewDocument` (con formularios y destinos, PDF-121 a PDF-123).
- `src/core/pdf/outline-copy.ts` → `readTopLevelOutline` (PDF-122).
- `src/core/pdf/object-copier.ts` → `ObjectCopier`, `drain`; `src/core/pdf/serialize.ts` → `serializeIndirect` (para medir).
- `src/core/export/plan.ts` → `exportBaseName`, `buildZip`, `MAX_ZIP_BYTES`.
- `src/core/doc-ops/ops/index.ts` → `DOC_OPS`; `src/core/pdf/incremental.ts` → `openForSave`.

## Qué hay que hacer
1. `src/core/organize/split.ts`:
```ts
export type SplitMode =
  | { readonly kind: 'pages'; readonly every: number }        // entero ≥ 1
  | { readonly kind: 'bookmarks' }
  | { readonly kind: 'size'; readonly maxBytes: number };    // ≥ 100 000
export const SPLIT_SIZES_MB = [1, 2, 5, 10, 25, 50, 100] as const;
/** Grupos consecutivos de `every` páginas (el último puede ser menor). */
export function splitByPageCount(n: number, every: number): readonly (readonly number[])[];
/** Cortes en las páginas de las entradas de primer nivel (sin repetir, ordenadas, sin null); si la primera no es 0, el primer grupo empieza en 0. Sin cortes → un grupo con todas. */
export function splitByBookmarks(top: readonly OutlineTop[], n: number): readonly (readonly number[])[];
/** Medida voraz: añade páginas a la parte actual mientras el tamaño estimado no supere `maxBytes`; una página sola mayor que el máximo va en su propia parte (`oversized` la cuenta). */
export async function splitBySize(reader: ObjectReader, maxBytes: number, signal?: AbortSignal): Promise<{ readonly groups: readonly (readonly number[])[]; readonly oversized: number }>;
/** «informe-parte-01.pdf»… (cifras = max(2, cifras de count)). */
export function splitPartNames(base: string, count: number): readonly string[];
/** Páginas 0-based → «informe-paginas-3-7.pdf» si son consecutivas, «informe-paginas-3.pdf» si es una, «informe-extracto.pdf» si no. */
export function extractFileName(base: string, pages: readonly number[]): string;
export function splitZipName(base: string): string;   // «informe-partes.zip»
```
   Tamaño estimado de una parte = 2 048 bytes + suma de `serializeIndirect` de cada objeto que su `ObjectCopier` copia (un copier nuevo por parte: los recursos compartidos cuentan una vez por parte) + 20 bytes por objeto (xref) + **64 bytes por página** (`PAGE_TREE_OVERHEAD`, exportada: `/Parent`, entrada en `/Kids` y nodos `/Pages` intermedios; medido ≈ 27, se deja margen).
   **Red de seguridad (solo modo `size`, en la op `'split'`)**: tras `buildNewDocument` de un grupo, si `bytes.length > maxBytes` y el grupo tiene más de 1 página, se parte el grupo en dos mitades (`g.slice(0, ceil(len/2))`, resto) y se construye cada mitad con la misma regla (recursivo); las partes resultantes sustituyen al grupo en orden. Un grupo de 1 página que supera el máximo se queda como está y cuenta en `oversized` (si no estaba contado ya).
   Exporta además `export function checkZipBudget(sizes: readonly number[], limit: number): boolean` (true si la suma ≤ `limit`), que usa la op para decidir `split-too-big`.
2. Ops en `DOC_OPS`:
   - `'extract'`: args `{ password: string | null; pages: readonly number[]; now: string; title: string }` → `buildNewDocument` con una parte (giro 0 = el que tenga la página: usa `readPageRotations` para conservar el giro efectivo) → `ok({ bytes })`.
   - `'split'`: args `{ password: string | null; mode: SplitMode; baseName: string; now: string }` → grupos según el modo (`bookmarks` usa `readTopLevelOutline`; sin índice → `err` con código nuevo `'split-no-bookmarks'`) → un `buildNewDocument` por grupo (progreso = páginas escritas en total) → si la suma de bytes supera `MAX_ZIP_BYTES` → `err('split-too-big')`; si no, `buildZip` con `splitPartNames` → `ok({ zip, parts, oversized })`.
3. `src/core/errors.ts`: `'split-no-bookmarks'` → «Este PDF no tiene marcadores para dividirlo.»; `'split-too-big'` → «Las partes ocupan demasiado para guardarlas juntas: divide un rango más pequeño.».
4. Tests `tests/unit/organize/split.test.ts` y `tests/unit/doc-ops/split-ops.test.ts` (ops con el cliente en el mismo hilo).

## Criterios de aceptación
- [ ] `splitByPageCount(5, 2)` → `[[0,1],[2,3],[4]]`; `every` 0 o no entero → `RangeError`.
- [ ] **Criterio original**: dividir `outline.pdf` por marcadores → ZIP con 4 PDF (`outline-parte-01.pdf` … `-04.pdf`) de 10, 10, 9 y 1 páginas (capítulos en 1, 11, 21 y el anexo en 30); cada uno pasa `qpdf --check`.
- [ ] Dividir `basic-5.pdf` por marcadores → `split-no-bookmarks`.
- [ ] `splitBySize` con `pages-5000.pdf` y 100 000 bytes → todas las partes, escritas, miden ≤ 100 000 bytes salvo las contadas en `oversized`, y la suma de páginas es 5 000.
- [ ] `'split'` modo `size` con `pages-5000.pdf` y 100 000 bytes → todas las partes del ZIP miden ≤ 100 000 bytes (salvo `oversized`), páginas en orden y suma 5 000. Test de la red de seguridad: con un `maxBytes` que el estimador subestime (p. ej. espiar `buildNewDocument` o un grupo forzado) el grupo se parte en dos.
- [ ] `checkZipBudget([600, 500], 1000)` → `false`; `checkZipBudget([500, 500], 1000)` → `true`.
- [ ] `'extract'` de `[2,3,4,5,6]` de `outline.pdf` → 5 páginas «Página 3 de 30»…; nombre `extractFileName('outline', …)` = `outline-paginas-3-7.pdf`.
- [ ] `'extract'` de `encrypted-aes-256.pdf` con `usuario` → PDF sin cifrar y legible.
- [ ] Cancelar `'split'` a mitad → `cancelled`.
- [ ] `pnpm perf`: dividir `pages-5000.pdf` cada 100 páginas (50 partes) < 5 000 ms.
- [ ] Cobertura de `split.ts` ≥ 90 %. `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Interfaz ([[PDF-127-extraer-dividir-interfaz]]). «Borrar páginas tras extraer». Dividir por páginas en blanco o por texto.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [líder] detalle — 2026-10-19
- Ficha detallada con [[ADR-0035-organizar-en-la-app]]: este núcleo + interfaz en [[PDF-127-extraer-dividir-interfaz]]. Dependencias nuevas: PDF-123 (cadena del documento nuevo) y PDF-118 (Worker). Se quita la dependencia de PDF-053.

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/organize/split.ts` (nuevo), `apps/lector-pdf/src/core/organize/index.ts`, `apps/lector-pdf/src/core/errors.ts`, `apps/lector-pdf/src/core/doc-ops/ops/index.ts` (ops `extract` y `split`), `apps/lector-pdf/tests/unit/organize/split.test.ts`, `apps/lector-pdf/tests/unit/doc-ops/split-ops.test.ts`, `apps/lector-pdf/tests/perf/split.perf.test.ts`.
- Qué he hecho: funciones de planes (`splitByPageCount`, `splitByBookmarks`, `splitBySize`, nombres) y ops `extract` y `split` según la ficha, con códigos `split-no-bookmarks` y `split-too-big`. Criterios cumplidos: conteo, marcadores (10/10/9/1 con qpdf), `split-no-bookmarks`, extract con AES-256 y contraseña de usuario, cancelación, perf (50 partes: 3,9 s < 5 s) y cobertura de `split.ts` al 100 %.
- Comandos ejecutados y resultado: `pnpm --filter lector-pdf typecheck` OK; `pnpm coverage` código 0 (1 fallo transitorio por timeout del test de 44 MB, corregido con timeout explícito); `pnpm exec vitest run --config vitest.perf.config.ts split` OK; `pnpm lint` falla por ficheros que no son míos (`src/core/pdf/incremental.ts`: imports sin uso; `src/state/annotation-actions.ts`: `import()`), sin errores en los míos.
- Dudas o cosas que no he podido hacer: **bloqueada por una contradicción de la ficha.** El criterio «partes ≤ 100 000 bytes» no se cumple con la fórmula de la ficha: con `pages-5000.pdf` a 100 000 bytes, las partes de ~370 páginas miden 110 019–110 227 bytes reales. La causa medida es que la fórmula no cuenta lo que `buildNewDocument` añade por página (`/Parent N 0 R`, unos 14 bytes, y la entrada en `/Kids`, unos 8 bytes) ni los nodos `/Pages` intermedios. Hace falta decidir: (a) añadir un coste fijo por página a la fórmula (cifra a fijar) o (b) otro criterio. No lo he inventado; el test de ese criterio no está escrito. Otros puntos: `split-too-big` no tiene test (exige más de 1 GB); el campo `parts` de `ok` es un número; en modo marcadores, un índice sin ningún destino de página da `split-no-bookmarks`; el test de cancelación llama a `DOC_OPS.split` directamente porque el canal en el mismo hilo no entrega el aborto antes de que termine la operación.

### [líder] desbloqueo — 2026-10-19
- Decisión técnica: se mantiene el criterio ≤ `maxBytes` (es lo que promete la función al usuario) y se corrige la fórmula: base 2 048 B y **64 B por página** (`PAGE_TREE_OVERHEAD`) por `/Parent`, `/Kids` y nodos intermedios. Como el estimador no puede ser exacto, la op añade una red de seguridad: si una parte escrita supera el máximo, se parte en mitades y se reconstruye.
- `split-too-big`: se prueba con la función pura `checkZipBudget`, sin generar 1 GB.
- Se aceptan: `parts` como número; índice sin destinos → `split-no-bookmarks`; test de cancelación llamando a `DOC_OPS.split` directamente.
- Los fallos de `pnpm lint` en `incremental.ts` y `annotation-actions.ts` no son de esta ficha; no bloquean su revisión si los ficheros propios pasan lint.

### [programador] ronda 2 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/organize/split.ts` (base 2 048 B, `PAGE_TREE_OVERHEAD` = 64 B por página, `checkZipBudget`), `apps/lector-pdf/src/core/doc-ops/ops/index.ts` (op `split`: red de seguridad en modo `size`, `split-too-big` con `checkZipBudget`, `oversized` contado sobre las partes escritas), `apps/lector-pdf/tests/unit/organize/split.test.ts` (tests de `checkZipBudget`), `apps/lector-pdf/tests/unit/doc-ops/split-ops.test.ts` (tamaños ≤ 100 000 B con `pages-5000.pdf` y test de la red de seguridad con espía sobre `buildNewDocument`).
- Qué he hecho: aplicado el desbloqueo del líder. La estimación de tamaño incluye 64 B por página; si una parte escrita supera el máximo y tiene más de una página, se parte en mitades recursivamente. `oversized` en modo `size` cuenta las partes de una página que superan el máximo al escribirlas (sustituye al recuento del planificador, que solo estima).
- Comandos ejecutados y resultado: `pnpm --filter lector-pdf typecheck` OK; `pnpm coverage` con el resumen sin fallos, `split.ts` al 100 % de líneas y ramas; `pnpm perf` 25 ficheros y 41 tests OK (incluye `split.perf.test.ts`); `eslint` sobre los 4 ficheros tocados sin errores. No he ejecutado el `pnpm lint` completo (los fallos de `incremental.ts` y `annotation-actions.ts` vienen de antes).
- Dudas o cosas que no he podido hacer: no he medido con `qpdf --check` las partes de la red de seguridad (solo el test de recuento y páginas). `split-too-big` se prueba con `checkZipBudget`, como pide el desbloqueo. No he hecho commit.

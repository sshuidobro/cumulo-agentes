---
tipo: tarea
id: PDF-127
titulo: Extraer y dividir - diálogos, progreso y guardado
app: pdf
estado: en-revision
depende_de: [PDF-054, PDF-126, COM-018]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-5, organizar, ui]
---

# PDF-127 · Extraer y dividir: diálogos, progreso y guardado

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0035-organizar-en-la-app]] (puntos 4, 6 y 7), [[ADR-0027-dialogos-diferidos]] · Antes: [[PDF-054-extraer-dividir]], [[PDF-126-organizar-arrastrar-e2e]], [[COM-018-exportar-fichero]]

## Objetivo
«Más acciones → Extraer páginas…» guarda un rango como PDF nuevo y «Más acciones → Dividir documento…» guarda las partes en un ZIP; desde la vista Organizar, «Extraer» guarda las páginas seleccionadas. Con progreso cancelable, cambios sin guardar incluidos y permisos respetados.

## Contexto
- Ops `'extract'` y `'split'` (PDF-054); `src/core/organize/split.ts` (nombres, `SPLIT_SIZES_MB`, `splitByPageCount`, `splitByBookmarks`).
- **Patrón a copiar**: `src/state/export-actions.ts`, `src/ui/export/ExportDialog.tsx` y su progreso (PDF-113); `src/core/print/range.ts` → `parsePageRange`.
- `src/state/save-actions.ts` → `buildCurrentDelta`; `src/core/pdf/concat-source.ts`; `src/state/doc-ops.ts` → `runDocOp`; `src/state/document-actions.ts` → `currentPassword`, `PDF_FILTERS`.
- `services().platform.saveAs` y `exportFile`; `useViewer` → `permissions`, `pdf.numPages`, `file`; `src/engine/outline.ts` / estado del índice (para saber si hay marcadores).
- `src/ui/organize/OrganizeToolbar.tsx` (PDF-125), `src/ui/toolbar/DocumentMenu.tsx`, `src/ui/App.tsx`.

## Qué hay que hacer
1. `src/ui/kit/DocOpProgress.tsx` (genérico, para esta y las siguientes operaciones): `{ label: string; done: number; total: number; onCancel: () => void }`, `role="progressbar"` con `aria-valuenow/max`, botón «Cancelar». Si ya existe uno equivalente de PDF-113 que acepte texto propio, reutilízalo y no crees otro.
2. `src/state/extract-actions.ts`:
```ts
export interface ExtractForm { readonly pages: 'current' | 'range'; readonly range: string }
export type SplitForm = { readonly mode: 'pages'; readonly every: number } | { readonly mode: 'bookmarks' } | { readonly mode: 'size'; readonly mb: (typeof SPLIT_SIZES_MB)[number] };
export const useExtractDialog: UseBoundStore<StoreApi<{ readonly open: 'extract' | 'split' | null; readonly extract: ExtractForm; readonly split: SplitForm }>>;
export const useDocOpJob: UseBoundStore<StoreApi<{ readonly label: string | null; readonly done: number; readonly total: number }>>;  // compartido por las operaciones de documento
export function openExtractDialog(): void; export function openSplitDialog(): void; export function closeExtractDialogs(): void;
export async function extractPages(pages: readonly number[]): Promise<'saved' | 'downloaded' | 'cancelled' | 'failed'>;
export async function splitDocument(form: SplitForm): Promise<'saved' | 'downloaded' | 'cancelled' | 'failed'>;
export function cancelDocOp(): void;
```
   - Sin permiso de copia (`!permissions.copy`) → no hace nada y avisa `organizeMsg.extractBlocked`.
   - Fuente: `concatSource(file.source, prefix)` con `prefix` de `buildCurrentDelta` (si falla, se usa el original y se avisa `organizeMsg.unsavedNotIncluded`).
   - Extraer → op `'extract'` → `platform.saveAs(extractFileName(...), PDF_FILTERS, { kind: 'bytes', bytes })`; `'saved'` → aviso «Páginas extraídas en “nombre”.» (el documento abierto no cambia).
   - Dividir → op `'split'` → `platform.exportFile(splitZipName(base), [{ name: 'ZIP', extensions: ['zip'] }], zip)`; aviso «Documento dividido en N partes.»; si `oversized > 0`, aviso «N páginas superan el tamaño máximo y van solas en su parte.».
   - Si el original está cifrado, el diálogo muestra `organizeMsg.newIsUnprotected` «El PDF nuevo no tendrá contraseña.».
3. `src/ui/organize/ExtractDialog.tsx` y `SplitDialog.tsx` (+ CSS), diferidos con `lazy` en `App.tsx`:
   - Extraer: «Página actual (n)» / «Rango» con campo (`parsePageRange`; botón «Extraer» deshabilitado si no es válido) y el nombre que se propondrá.
   - Dividir: radios «Cada [N] páginas» (número 1..numPages), «Por marcadores de primer nivel» (deshabilitado con explicación si el documento no tiene índice), «Por tamaño máximo [select MB]»; texto «Se crearán N archivos» para los dos primeros modos.
4. `DocumentMenu.tsx`: «Extraer páginas…» y «Dividir documento…» (deshabilitadas sin permiso de copia, con `title`). `OrganizeToolbar.tsx`: botón «Extraer» (selección de huecos `original`, en orden del plan; deshabilitado si la selección tiene huecos en blanco).
5. `organizeMsg`: `extract`, `extractTitle` «Extraer páginas», `split`, `splitTitle` «Dividir documento», `everyPages`, `byBookmarks`, `bySize`, `noBookmarks` «Este PDF no tiene marcadores.», `filesToCreate(n)`, `extracted(name)`, `splitDone(n)`, `oversized(n)`, `extractBlocked`, `newIsUnprotected`, `unsavedNotIncluded`, `progressExtract(done, total)` «Copiando páginas: X de Y…».
6. Tests: `tests/unit/extract-actions.test.ts` (FakePlatform + `inProcessDocOps`), `tests/ui/extract-dialogs.test.tsx`, `tests/e2e/extract-split.spec.ts`.

## Criterios de aceptación
- [ ] E2E `outline.pdf`: Extraer el rango «3-7» → se descarga `outline-paginas-3-7.pdf` con 5 páginas cuyo primer texto es «Página 3 de 30».
- [ ] E2E `outline.pdf`: Dividir por marcadores → se descarga `outline-partes.zip` con 4 PDF de 10, 10, 9 y 1 páginas (descomprimir en la prueba con `fflate`).
- [ ] E2E `basic-5.pdf` con un resaltado sin guardar en la página 2: extraer «2» → el PDF extraído tiene el resaltado (pdf.js `getAnnotations`).
- [ ] E2E: en la vista Organizar, seleccionar las páginas 4 y 2 (en ese orden del plan tras mover) y «Extraer» → PDF con esas dos en el orden del plan.
- [ ] E2E `encrypted-owner-only.pdf`: «Extraer páginas…» y «Dividir documento…» deshabilitadas con su explicación.
- [ ] Unit: cancelar a mitad → nada guardado; error de op → aviso en español; `exportFile` recibe el ZIP con el nombre esperado.
- [ ] Teclado y accesibilidad: los diálogos se abren con Intro desde el menú, foco en el primer control, Escape cierra; axe sin violaciones; tema oscuro.
- [ ] `pnpm --filter lector-pdf bundle:check` dentro del presupuesto.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Elegir carpeta de destino para las partes (van en ZIP). Abrir automáticamente el PDF extraído.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/state/extract-actions.ts` (nuevo), `src/ui/kit/DocOpProgress.tsx` y `.module.css` (nuevos), `src/ui/organize/ExtractDialog.tsx`, `SplitDialog.tsx` y `ExtractDialog.module.css` (nuevos), `src/ui/organize/OrganizeToolbar.tsx`, `src/ui/toolbar/DocumentMenu.tsx`, `src/ui/App.tsx` (diálogos en diferido y progreso), `src/ui/messages-organize.ts`; tests nuevos `tests/unit/extract-actions.test.ts`, `tests/ui/extract-dialogs.test.tsx`, `tests/e2e/extract-split.spec.ts`.
- Qué he hecho: acciones de extraer y dividir sobre las ops `extract` y `split` de PDF-054 (cambios sin guardar incluidos con `concatSource`, cancelables, aviso en español), diálogos «Extraer páginas» y «Dividir documento» con teclado y aviso de cifrado, botón «Extraer» en Organizar y entradas del menú «Más acciones» deshabilitadas sin permiso de copia. Progreso genérico `DocOpProgress` con Cancelar.
- Comandos ejecutados y resultado:
  - `pnpm lint`: sin errores en mis ficheros (en el último intento falló por `dist-e2e-full`, que ya he borrado).
  - `pnpm --filter lector-pdf exec tsc -p tsconfig.json`: solo falla `tests/e2e/iteration4-performance.spec.ts` (fichero sin seguimiento que no es mío: `Page`/`TestInfo` no exportados desde `perf-fixture.ts`).
  - `pnpm coverage`: código 0, todos los tests en verde (cobertura global: líneas 98,33 %, ramas 89,74 %).
  - `vitest` unitario y de componentes de la ficha: 10 + 12 tests en verde.
  - `playwright test tests/e2e/extract-split.spec.ts` (puerto propio `LECTOR_E2E_PORT=4311`): 6/6 en verde (outline 3-7, outline por marcadores 10/10/9/1, resaltado sin guardar en la página 2, Organizar 4 y 2, encrypted-owner-only deshabilitadas, teclado + axe en tema oscuro).
  - E2E completo: 328 pasados; 4 `@perf` fallaron por CPU ocupada por otros procesos; al repetirlos en reposo, 9 de 10 pasan. El que falla (`iteration4-performance.spec.ts`, cifrado AES-256, ratio 2,10 frente a máximo 1,5) es de un fichero que no es mío y no toca estas rutas.
  - `node tests/bundle/check-bundle.ts dist-extract` tras `vite build`: arranque 591 191 bytes de 600 000 máximo.
- Dudas o cosas que no he podido hacer:
  1. **Giros del plan no se aplican al extraer desde Organizar.** La op `extract` (PDF-054) solo recibe índices de página y usa los giros del original; si el usuario ha girado una página en la vista Organizar, el PDF extraído no lo lleva. Hace falta decidir si la op acepta giros (cambio en PDF-054) o si se extrae sin giros. No he tomado esa decisión.
  2. Los huecos «imported» (PDF-128, aún no implementada) deshabilitan «Extraer» igual que los «blank», no solo los en blanco que pide la ficha.
  3. El progreso reutiliza `organizeMsg.progressExtract` («Copiando páginas: X de Y…») también para dividir.
  4. Los fallos del `tsc` y los ficheros `tests/e2e/iteration4-*.spec.ts` y `zz-debug-tmp.spec.ts` no son de esta ficha; no los he tocado.

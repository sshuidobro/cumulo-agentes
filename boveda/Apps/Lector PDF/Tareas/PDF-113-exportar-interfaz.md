---
tipo: tarea
id: PDF-113
titulo: Exportar - diálogo, progreso, permisos y guardado
app: pdf
estado: en-test
depende_de: [PDF-064, COM-018, PDF-048, PDF-095, PDF-097]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-6, exportar, ui]
---

# PDF-113 · Exportar: diálogo, progreso, permisos y guardado

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0032-exportar-imagenes-y-texto]], [[ADR-0027-dialogos-diferidos]] · Antes: [[PDF-064-exportar]], [[COM-018-exportar-fichero]]

## Objetivo
«Más acciones → Exportar…» abre un diálogo para exportar páginas a PNG o JPEG (resolución y comentarios) o el texto a TXT, con rango de páginas, progreso cancelable y guardado con el diálogo del sistema, sin entrar en «Recientes».

## Contexto
- [[ADR-0032-exportar-imagenes-y-texto]].
- `src/core/export/plan.ts` y `src/engine/print-render.ts` → `renderPageImage` (PDF-064); `src/engine/search-source.ts` → `createPageTextSource` (ítems de texto por página).
- **Patrón a copiar**: `src/state/print-actions.ts` (`usePrintDialog`, `usePrintJob`, `startPrint`, `cancelPrint`, `pageIndicesFor`, preferencias de opciones), `src/state/print-source.ts` → `openPrintSource` (documento con los cambios sin guardar), `src/ui/print/PrintDialog.tsx` + `PrintDialog.module.css`, `src/ui/print/PrintProgress.tsx`, `src/core/print/range.ts` → `parsePageRange`.
- `useViewer.permissions` (PDF-048) y `securityMsg`; `services().platform.exportFile` (COM-018).
- `src/ui/App.tsx` (`lazy` de `PrintDialog`), `src/ui/toolbar/DocumentMenu.tsx`.

## Qué hay que hacer
1. `src/state/export-actions.ts`:
```ts
export interface ExportOptions {
  readonly format: ExportFormat;                 // 'png' | 'jpeg' | 'txt'
  readonly dpi: (typeof EXPORT_DPIS)[number];
  readonly withComments: boolean;
  readonly pages: 'all' | 'current' | 'range';
  readonly range: string;
}
export const EXPORT_OPTIONS_PREF = 'export-options';
export const useExportDialog: UseBoundStore<StoreApi<{ readonly open: boolean; readonly form: ExportOptions }>>;
export const useExportJob: UseBoundStore<StoreApi<{ readonly job: { readonly status: 'idle' } | { readonly status: 'running'; readonly done: number; readonly total: number } }>>;
export function openExportDialog(): void;   // carga las opciones guardadas (por defecto png, 150, comentarios sí, todas)
export function closeExportDialog(): void;
export function setExportForm(patch: Partial<ExportOptions>): void;
export async function startExport(o: ExportOptions): Promise<'saved' | 'downloaded' | 'cancelled' | 'failed'>;
export function cancelExport(): void;
```
   - Rango con `parsePageRange` (inválido → aviso como imprimir). Sin permiso de copia (`!permissions.copy`) → no hace nada y avisa `exportMsg.blocked`.
   - Imágenes: documento de `openPrintSource()` (incluye cambios sin guardar; si no se pudieron incluir, aviso como imprimir); por página `renderPageImage` → bytes; una página → `exportFile(imageFileName(..., false), filtro PNG/JPEG, bytes)`; varias → antes de empezar, `estimateImagesBytes` > `MAX_ZIP_BYTES` → aviso `exportMsg.tooBig` y nada; si no, `buildZip` → `exportFile(zipFileName, filtro ZIP, zip)`. Si alguna página salió con `dpi` menor, aviso `exportMsg.reduced(dpiReal)`.
   - Texto: del documento abierto; `createPageTextSource` → `pageTextForExport` por página → `buildTxt` → `exportFile(txtFileName, filtro TXT, bytes)`.
   - Progreso `done/total`, cede el hilo entre páginas (`await` de cada render ya lo hace; para texto, `setTimeout(0)` cada 50 páginas). Cancelar → `'cancelled'`, sin guardar nada y liberando el documento temporal (`dispose`).
   - Más de 200 páginas en imágenes → confirmación previa con `askChoice` («Vas a exportar N páginas como imágenes. Puede tardar varios minutos.»).
   - Resultado `'saved'` → aviso «Exportación terminada.»; error de plataforma → aviso con su mensaje.
2. `src/ui/messages-export.ts` (`exportMsg`): `menuItem` «Exportar…», `title` «Exportar», `formatLegend` «Formato», `png` «Imagen PNG», `jpeg` «Imagen JPEG», `txt` «Texto (.txt)», `resolution` «Resolución», `dpiOption(n)` «N ppp», `withComments` «Incluir comentarios», `pagesLegend`/`allPages`/`currentPage(n)`/`rangePages`/`rangeField` (como imprimir), `export` «Exportar», `cancel` «Cancelar», `progress(done, total)` «Exportando página X de Y…», `done` «Exportación terminada.», `tooBig` «Demasiado grande: reduce el rango o la resolución.», `reduced(dpi)` «Algunas páginas se han exportado a N ppp porque eran demasiado grandes.», `blocked` «El autor de este PDF no permite copiar su contenido.», `many(n)`.
3. `src/ui/export/ExportDialog.tsx` (+ CSS), diferido con `lazy` en `App.tsx`: radios de formato; «Resolución» (select con `EXPORT_DPIS`) y «Incluir comentarios» solo para imágenes; páginas como imprimir; botón «Exportar» deshabilitado con rango inválido. Durante el trabajo, barra de progreso con «Cancelar» (reutiliza `PrintProgress` si admite texto propio; si no, `ExportProgress.tsx` con la misma estructura).
4. `DocumentMenu.tsx`: entrada «Exportar…» (deshabilitada con `title` `exportMsg.blocked` si no hay permiso de copia).
5. Tests: `tests/unit/export-actions.test.ts`, `tests/ui/export-dialog.test.tsx`, `tests/e2e/export.spec.ts`.

## Criterios de aceptación
- [ ] E2E (`basic-5.pdf`): exportar páginas 1-3 en PNG a 150 ppp → se descarga `basic-5-imagenes.zip` con `basic-5-p0001.png`…`p0003.png`; cada PNG decodificado mide 1275×1650.
- [ ] E2E: exportar la página actual en JPEG a 72 ppp → `basic-5-p1.jpg` de 612×792; con un resaltado sin guardar y «Incluir comentarios», la imagen tiene píxeles amarillos en su zona; sin la casilla, no.
- [ ] E2E: exportar texto → `basic-5.txt` empieza por BOM, contiene «Página 1 de 5» antes de «Página 2 de 5» y 4 separadores `\f`.
- [ ] E2E: `encrypted-owner-only.pdf` → «Exportar…» deshabilitado con su explicación.
- [ ] E2E `@perf`: exportar 20 páginas de `pages-5000.pdf` a 150 ppp sin *long tasks* > 100 ms; «Cancelar» a mitad no descarga nada.
- [ ] Unit: opciones recordadas entre aperturas del diálogo; estimación > 1 GB → aviso y `exportFile` no llamado; exportar no cambia `recentFiles()` (FakePlatform).
- [ ] Teclado: el diálogo se abre desde el menú con Intro, foco en el primer control, Escape cierra, Intro exporta; axe sin violaciones; tema oscuro.
- [ ] `pnpm --filter lector-pdf bundle:check` dentro del presupuesto (diálogo diferido).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- DOCX y otros formatos. Elegir carpeta para ficheros sueltos. Exportar a imágenes en un Worker (se mide aquí; si falla el presupuesto, se replanifica).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/ui/kit/MenuButton.tsx` (prop `disabledReason` en `MenuActionSpec`; el `title` de una entrada deshabilitada muestra la explicación), `apps/lector-pdf/src/ui/toolbar/DocumentMenu.tsx` (`disabledReason: exportMsg.blocked`), nuevos `apps/lector-pdf/tests/unit/export-actions.test.ts`, `apps/lector-pdf/tests/ui/export-dialog.test.tsx`, `apps/lector-pdf/tests/e2e/export.spec.ts`. El núcleo (`state/export-actions.ts`, `core/export/plan.ts`, `ui/export/*`, `ui/messages-export.ts`, cambios en `App.tsx` y `DocumentMenu.tsx`) ya estaba en el commit `da503d7` (trabajo previo sin ficha cerrada); lo he revisado contra la ficha y lo he dejado tal cual.
- Qué he hecho: añadido el test unitario (PNG suelto con número, ZIP sin recomprimir, aviso de ppp reducidos, >1 GB sin guardar, >200 páginas con confirmación y cancelación, cancelar a mitad con `dispose`, TXT con BOM y `\f`, rango inválido, sin permiso de copia, recientes intactas, opciones recordadas), tests de componente (foco inicial, Escape, campos según formato, rango inválido, Intro exporta) y E2E (PNG 1-3 a 1275×1650 en ZIP; JPEG 72 ppp 612×792 con/sin comentarios y píxeles amarillos; TXT; axe en el diálogo; teclado; tema oscuro; «Exportar…» deshabilitado en `encrypted-owner-only.pdf`; @perf de 20 páginas sin long tasks > 100 ms y cancelación sin descarga).
- Comandos ejecutados y resultado:
  - `pnpm exec vitest run tests/unit/export-actions.test.ts tests/ui/export-dialog.test.tsx` (en `apps/lector-pdf`): 15/15 OK.
  - `pnpm exec playwright test tests/e2e/export.spec.ts --project=chromium`: 6/6 OK.
  - `... --project=chromium-perf --no-deps`: 2/2 OK.
  - `pnpm --filter lector-pdf bundle:check`: OK (508 103 bytes de arranque, máximo 600 000; sobre el `dist` existente, sin `build` porque tsc falla por cambios ajenos).
  - ESLint sobre los ficheros de esta ficha: sin errores. `pnpm lint` global: falla por `src/ui/viewer/AnnotationLayer.tsx:690` (parse error, fichero de otro programador en curso).
  - `pnpm typecheck`: 12 errores, todos fuera de esta ficha (`src/core/signature/digital/p12.ts`, `src/ui/toolbar/CommentToolbar.tsx` con el tipo «stamp»). En mis ficheros: ninguno.
  - `pnpm coverage` (raíz): 3581 OK, 2 KO en `tests/ui/comment-toolbar.test.tsx` (flechas y foco de la barra «Comentar»; el test espera la herramienta «Flecha» de trabajo ajeno en curso). No están relacionados con mis cambios (`MenuButton` solo añade `title` a entradas deshabilitadas).
- Dudas o cosas que no he podido hacer:
  - `pnpm coverage` y `pnpm lint` no quedan en verde por código ajeno (ver arriba); conviene volver a correrlos cuando el resto del árbol esté estable.
  - La prueba de «Cancelar» (@perf) comprueba la ausencia de descarga y del aviso «Exportación terminada.»; no hay forma determinista de ver que el navegador no ha descargado nada después, así que es una comprobación razonable pero no total.
  - El criterio de tema oscuro se comprueba como «fondo del diálogo distinto de blanco» más axe; no hay captura de referencia.
  - `pnpm --filter lector-pdf build` no se ha ejecutado (falla por tipos ajenos), así que el presupuesto se ha medido sobre el `dist` anterior.
  - No he hecho commit (lo pide la instrucción del equipo; el árbol tiene cambios ajenos).

### [revisor] ronda 1 — 2026-10-20 — APROBADO
- Revisados solo los ficheros de esta ficha. Verificado: vitest de export (15/15), E2E chromium de export (6/6), ESLint sin errores en los ficheros de la ficha, typecheck sin errores en ellos. `lint`/`typecheck`/`coverage` globales fallan por código ajeno (PDF-115, PDF-066), como indica el programador.
- Núcleo conforme a la ficha: permisos, rango, límite de 1 GB, confirmación con más de 200 páginas, cancelación con `dispose`, recientes intactas, opciones recordadas.
- (opcional) `MenuButton.tsx` mezcla el cambio `fromKeyboard` de PDF-115 con `disabledReason`: conviene que cada ficha lo incluya en su propio commit.
- Pendiente para el tester: `@perf` (20 páginas de `pages-5000.pdf`), `bundle:check` tras un build limpio y `lint`/`coverage` globales con el árbol estable.

---
tipo: tarea
id: PDF-113
titulo: Exportar - diálogo, progreso, permisos y guardado
app: pdf
estado: en-curso
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

---
tipo: tarea
id: PDF-129
titulo: Crear PDF desde imágenes - diálogo y guardado
app: pdf
estado: pendiente
depende_de: [PDF-056, PDF-128]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-5, organizar, ui]
---

# PDF-129 · Crear PDF desde imágenes: diálogo y guardado

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0035-organizar-en-la-app]] · Antes: [[PDF-056-pdf-desde-imagenes]], [[PDF-128-insertar-combinar-interfaz]] (usa `importFiles` de [[COM-019-importar-varios-ficheros]])

## Objetivo
Desde la pantalla de inicio o «Más acciones», «Crear PDF desde imágenes…» deja elegir varias imágenes, ordenarlas, elegir tamaño de página y margen, y guarda el PDF resultante y lo abre.

## Contexto
- Op `'images-to-pdf'` y tipos `ImageInput`, `PageSizeMode` (PDF-056).
- `src/core/signature/image-art.ts` → `isJpegBytes`; `src/core/pdf/image.ts` → `readJpegInfo`.
- **Patrón a copiar**: `src/state/combine-actions.ts` y `src/ui/organize/CombineDialog.tsx` (PDF-128); `src/ui/signature/image-art.ts` (decodificar una imagen del usuario en el navegador).
- `services().platform.importFiles`, `saveAs`; `src/state/document-actions.ts` → `openRequested`, `PDF_FILTERS`; `src/ui/kit/DocOpProgress.tsx`.
- `src/ui/open/EmptyState.tsx`, `src/ui/toolbar/DocumentMenu.tsx`, `src/ui/App.tsx`.

## Qué hay que hacer
1. `src/state/images-pdf-actions.ts`:
```ts
export const IMAGE_FILTERS: readonly FileFilter[];   // [{ name: 'Imágenes', extensions: ['jpg','jpeg','png','gif','webp','bmp'] }]
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGES = 500;
export const MAX_IMAGE_PIXELS = 50_000_000;
export interface ImageItem { readonly id: string; readonly name: string; readonly bytes: Uint8Array; readonly previewUrl: string }
export const useImagesDialog: UseBoundStore<StoreApi<{ readonly open: boolean; readonly items: readonly ImageItem[]; readonly pageSize: PageSizeMode; readonly margin: 0 | 18 | 36 }>>;
export function openImagesDialog(): Promise<void>;   // abre y lanza addImages()
export async function addImages(): Promise<void>;
export function moveImage(id: string, delta: -1 | 1): void;
export function removeImage(id: string): void;       // revoca su previewUrl
export async function createPdfFromImages(): Promise<'saved' | 'downloaded' | 'cancelled' | 'failed'>;
```
   - Preferencias recordadas (`pageSize`, `margin`) con `platform.prefs` bajo `images-pdf-options` (por defecto `a4` y 18).
   - Al crear: cada JPEG válido (`isJpegBytes` + `readJpegInfo` no nulo) va como `{ kind: 'jpeg' }`; el resto se decodifica con `createImageBitmap(new Blob([bytes]))` y un `OffscreenCanvas` (o `canvas`) → `getImageData` → `{ kind: 'rgba' }`; más de `MAX_IMAGE_PIXELS` o fallo de decodificación → aviso `imagesMsg.cannotRead(nombre)` y se para sin crear nada. Se cede el hilo entre imágenes (`await` de `createImageBitmap` y `setTimeout(0)`).
   - Op `'images-to-pdf'` con progreso y cancelar (`useDocOpJob`) → `saveAs('<primera>.pdf', PDF_FILTERS, { kind: 'bytes', bytes })` → `'saved'` → `openRequested(file)`; `'downloaded'` → aviso.
   - Cerrar el diálogo revoca todas las `previewUrl`.
2. `src/ui/organize/ImagesDialog.tsx` (+ CSS, `lazy`): lista con miniatura (`<img alt="">` con `previewUrl`), nombre, «Subir», «Bajar», «Quitar» (Alt+↑/↓ como en Combinar); «Añadir imágenes…»; «Tamaño de página»: Ajustar a cada imagen / A4 / Carta; «Margen»: Sin margen / Pequeño / Normal (deshabilitado con «Ajustar»); «Crear PDF» deshabilitado sin imágenes.
3. Entradas: `EmptyState.tsx` → botón «Crear PDF desde imágenes…»; `DocumentMenu.tsx` → misma entrada.
4. `src/ui/messages-images.ts` (`imagesMsg`): `menuItem`, `title` «Crear PDF desde imágenes», `add`, `pageSize`, `fit` «Ajustar a cada imagen», `a4`, `letter` «Carta», `margin`, `none` «Sin margen», `small` «Pequeño», `normal` «Normal», `create` «Crear PDF», `cannotRead(name)` «No se puede leer la imagen “nombre”.», `tooMany` «Puedes añadir como mucho 500 imágenes.», `tooBig` «Cada imagen puede ocupar como mucho 50 MB.», `progress(done, total)` «Creando PDF: imagen X de Y…», `created(name)`.
5. Tests: `tests/unit/images-pdf-actions.test.ts` (decodificación simulada), `tests/ui/images-dialog.test.tsx`, `tests/e2e/images-pdf.spec.ts` (imágenes de prueba generadas en el propio test con `page.evaluate` y `canvas.toBlob`, o ficheros pequeños en `tests/e2e/assets/`).

## Criterios de aceptación
- [ ] E2E: crear desde 3 imágenes (2 JPEG, 1 PNG con transparencia) en A4 → se descarga un PDF de 3 páginas que la app abre; el orden es el de la lista tras «Bajar» la primera.
- [ ] E2E: un JPEG del lote sale con sus bytes intactos (la prueba busca la secuencia de bytes del JPEG dentro del PDF descargado).
- [ ] E2E: un fichero `.png` corrupto → aviso «No se puede leer la imagen “…”.» y no se descarga nada.
- [ ] Unit: más de 500 imágenes o una > 50 MB → aviso y nada añadido; cancelar a mitad → nada guardado; las `previewUrl` se revocan al cerrar (espía `URL.revokeObjectURL`).
- [ ] E2E `@perf`: crear desde 20 JPEG de ~2 MB sin *long tasks* > 100 ms.
- [ ] Teclado y accesibilidad: diálogo operable solo con teclado; axe sin violaciones; tema oscuro.
- [ ] `pnpm --filter lector-pdf bundle:check` dentro del presupuesto.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- HEIC y TIFF multipágina. Arrastrar imágenes a la ventana. Recortar o girar imágenes en el diálogo. OCR automático.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

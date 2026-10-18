---
tipo: tarea
id: PDF-086
titulo: Crear firma (dibujar, escribir o imagen) y firmas guardadas
app: pdf
estado: pendiente
depende_de: [PDF-085]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, firma, ui]
---

# PDF-086 · Crear firma (dibujar, escribir o imagen) y firmas guardadas

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Decisiones: [[ADR-0020-firma-visual]]

## Objetivo
Diálogo «Crear firma» con tres pestañas (Dibujar, Escribir, Imagen) que produce un `SignatureArt`, y almacén local de hasta 5 firmas guardadas para reutilizarlas. Nada sale del equipo.

## Contexto
- Leer: `src/ui/kit/Dialog.tsx` (diálogo modal accesible), `src/core/annotations/model.ts` (`SignatureArt`, PDF-085), `src/core/annotations/simplify.ts` (`simplifyPath`), `src/ui/viewer/ink-preview.ts` (dibujo incremental en canvas), `packages/platform/src/types.ts` (`KeyValueStore`), `src/state/annotation-actions.ts` (patrón de preferencias con `guard`).
- Dependencia nueva aprobada por el líder: `@fontsource/dancing-script@5.3.0` (versión exacta, OFL-1.1). Importa su CSS (`@fontsource/dancing-script/400.css`) solo desde `SignatureDialog.tsx`.
- Textos en `src/ui/messages-signature.ts` (`signatureMsg`).

## Qué hay que hacer
1. `src/core/signature/stored.ts` (puro):
```ts
export interface StoredSignature { readonly id: string; readonly createdAt: string; readonly art: SignatureArt }
export const MAX_STORED_SIGNATURES = 5;
export function isStoredSignatures(v: unknown): v is readonly StoredSignature[]; // valida art como isAnnotation
export function addStored(list: readonly StoredSignature[], s: StoredSignature): readonly StoredSignature[]; // al principio; si pasa de 5 quita la más antigua
export function removeStored(list: readonly StoredSignature[], id: string): readonly StoredSignature[];
/** Normaliza trazos dibujados (px del lienzo, origen arriba-izquierda) a `ink` con caja ajustada + margen de 2 px y eje Y hacia arriba. */
export function inkArtFromStrokes(strokes: readonly (readonly number[])[], width: number): SignatureArt | null; // null si no hay ningún trazo de ≥ 2 puntos
```
2. `src/state/signature-actions.ts`: `useSignatures` (zustand, `{ list: readonly StoredSignature[] }` leído de la preferencia `signatures`), `saveSignature(art): StoredSignature`, `deleteSignature(id)`. Errores de cuota de preferencias: aviso `signatureMsg.storeFailed` («No se ha podido guardar la firma para otra vez.») y la firma se usa igualmente.
3. `src/ui/signature/SignatureDialog.tsx` (+ `.module.css`): `export function SignatureDialog({ open, onDone, onCancel }: { open: boolean; onDone: (art: SignatureArt) => void; onCancel: () => void })`.
   - Pestañas (`role="tablist"`, flechas ←/→): **Dibujar**: lienzo de 480×160 px CSS, trazos con puntero (ratón, lápiz, táctil), botón «Borrar»; `inkArtFromStrokes` con `simplifyPath` (tolerancia 0,5 px) y grosor 2. **Escribir**: campo de texto (máx. 60 caracteres) con vista previa en Dancing Script 48 px; al aceptar se rasteriza a 4× en un `canvas` del tamaño justo del texto (`measureText`) → RGBA → `deflateSync` → `{ kind:'image', format:'rgba-deflate', … }`. **Imagen**: botón «Elegir imagen…» (`<input type="file" accept="image/png,image/jpeg">`); JPEG ≤ 1 200 px de ancho → `format:'jpeg'` con los bytes tal cual; si no (PNG o JPEG mayor), `createImageBitmap` → canvas reducido a ≤ 1 200 px de ancho → `rgba-deflate`. Imagen inválida → mensaje del error `invalid-image`.
   - Casilla «Guardar esta firma para otras veces» (marcada por defecto). Botones «Aceptar» (deshabilitado sin firma) y «Cancelar»; Esc cancela.
4. `src/ui/signature/SignatureMenu.tsx`: menú (sobre `MenuButton` de `ui/kit`) que lista las firmas guardadas como miniaturas (`<img alt="Firma guardada n">`), «Crear firma…» y, por cada guardada, «Borrar firma guardada n». Devuelve la elegida por `onPick(art)`. No se monta en la barra en esta ficha (lo hace PDF-043).
5. Tests: `tests/unit/signature-stored.test.ts` y `tests/ui/signature-dialog.test.tsx` (jsdom: pestañas con teclado, Aceptar deshabilitado, Esc). El E2E con navegador real lo hace PDF-043, que monta el menú en la barra.

## Criterios de aceptación
- [ ] `inkArtFromStrokes([[10,10, 50,40]], 2)` → `box` `[44, 34]`, trazo `[2, 32, 42, 2]` (eje Y invertido, margen 2); sin trazos → `null`.
- [ ] `addStored` con 5 guardadas añade la nueva al principio y quita la más antigua; `isStoredSignatures` rechaza una lista con un `art` inválido.
- [ ] UI: «Aceptar» deshabilitado al abrir; tras dibujar un trazo con eventos de puntero simulados se habilita y `onDone` recibe `kind:'ink'`; Esc → `onCancel`; ←/→ cambian de pestaña y el foco va a la pestaña activa (`aria-selected`).
- [ ] UI: pestaña Escribir con «Ana Pérez» → `onDone` con `kind:'image'`, `format:'rgba-deflate'` (en jsdom, `canvas` simulado: comprobar solo forma y que `pixelWidth > 0`).
- [ ] UI: con «Guardar esta firma» marcada, `useSignatures.getState().list.length` sube en 1 y la preferencia `signatures` contiene la firma; desmarcada, no.
- [ ] Ninguna llamada de red: el CSS de la fuente se resuelve a ficheros del propio bundle (`pnpm --filter lector-pdf build` y `grep -r "fonts.googleapis" dist` sin resultados).
- [ ] `pnpm --filter lector-pdf build` (incluye `bundle:check`) con código 0: el JavaScript de arranque sigue ≤ 500 000 bytes.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Colocar la firma en la página (PDF-043). Iniciales separadas de la firma (se pueden guardar como otra firma).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

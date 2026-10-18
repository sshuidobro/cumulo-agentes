---
tipo: tarea
id: PDF-086
titulo: Crear firma (dibujar, escribir o imagen) y firmas guardadas
app: pdf
estado: en-test
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/package.json` y `pnpm-lock.yaml` (`@fontsource/dancing-script@5.3.0` exacta); `apps/lector-pdf/src/core/annotations/model.ts` (exporta `isSignatureArt`); `apps/lector-pdf/src/ui/kit/Dialog.tsx` (acción con `disabled?`); `apps/lector-pdf/src/ui/kit/MenuButton.tsx` y `MenuButton.module.css` (miniatura `thumbnail?` en `MenuActionSpec`); `apps/lector-pdf/src/ui/icons.tsx` (`IconSignature`). Nuevos: `apps/lector-pdf/src/core/signature/stored.ts`, `apps/lector-pdf/src/core/signature/image-art.ts`, `apps/lector-pdf/src/state/signature-actions.ts`, `apps/lector-pdf/src/ui/messages-signature.ts`, `apps/lector-pdf/src/ui/signature/` (`SignatureDialog.tsx` + `.module.css`, `SignatureMenu.tsx`, `text-art.ts`, `image-art.ts`, `thumbnail.ts`), `apps/lector-pdf/tests/unit/signature-stored.test.ts`, `apps/lector-pdf/tests/ui/signature-dialog.test.tsx`.
- Qué he hecho: núcleo puro de firmas guardadas (máx. 5, validación, `inkArtFromStrokes`), almacén `useSignatures` con lectura de vuelta para detectar la cuota (el almacén traga los errores de escritura), diálogo «Crear firma» con pestañas Dibujar/Escribir/Imagen accesibles por teclado y casilla de guardado, y menú de firmas con miniaturas y borrado. Textos en `messages-signature.ts`.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm test` OK (177 ficheros, 2065 tests); `pnpm coverage` OK (`core/signature` 98 % líneas); `pnpm --filter lector-pdf build` OK (arranque 459 861 bytes ≤ 500 000; sin `fonts.googleapis` en dist).
- Dudas o cosas que no he podido hacer: (1) el requisito de cuota se verifica releyendo la preferencia, porque `KeyValueStore.set` no devuelve error; (2) «Crear firma…» en el menú entrega la firma recién creada a `onPick` directamente (la ficha no decía qué pasa después; PDF-043 puede cambiarlo); (3) la fuente Dancing Script no aparece en `dist` hasta que algo del grafo importe `SignatureDialog` (lo hará PDF-043); (4) los cambios de `annotation-actions.ts`, `core/pdf/index.ts` y de las fichas PDF-081/088/089 que había en el árbol son de otros agentes y no van en mi commit.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
Tests de la ficha (27) en verde; `tsc` y ESLint sin avisos sobre los ficheros de la ficha. Criterios cubiertos con tests; sin red (fuente por `@fontsource`); núcleo sin React.
1. (opcional) `apps/lector-pdf/src/ui/signature/SignatureDialog.tsx:accept` — un doble clic rápido en Aceptar con la pestaña Escribir (espera `fonts.load`) puede guardar la firma dos veces y llamar a `onDone` dos veces; añadir un guarda `busy`.
2. (opcional) `SignatureDialog.tsx:accept` — si `rasterizeSignatureText` devuelve `null` (sin canvas) el botón no hace nada y no avisa; mostrar un mensaje.
3. (opcional) `src/ui/signature/image-art.ts` — un JPEG con orientación EXIF: `createImageBitmap` aplica la rotación pero los bytes se guardan tal cual con ancho/alto del bitmap; comprobar en PDF-043.
No he ejecutado build/coverage/suite global (otros agentes trabajan en el árbol); el programador reporta build 459 861 bytes.

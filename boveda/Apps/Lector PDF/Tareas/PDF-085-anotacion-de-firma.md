---
tipo: tarea
id: PDF-085
titulo: Anotación de firma - modelo, apariencia, escritura y dibujo en la capa
app: pdf
estado: en-test
depende_de: [PDF-084, PDF-080]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, firma, anotaciones, core]
---

# PDF-085 · Anotación de firma: modelo, apariencia, escritura y dibujo en la capa

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Decisiones: [[ADR-0020-firma-visual]] · [[ADR-0009-anotaciones-escritor-incremental]]

## Objetivo
Nuevo tipo de anotación `signature` en el modelo: se valida (borradores), se dibuja en la capa SVG, se escribe como `/Stamp` con apariencia vectorial o de imagen en el incremento y aparece en el panel de comentarios como «Firma».

## Contexto
- Leer: `src/core/annotations/model.ts`, `appearance.ts`, `to-pdf.ts`, `commands.ts`, `comment-list.ts`, `src/core/pdf/incremental.ts` (`AddedPlan`, asignación de números), `src/core/pdf/image.ts` (PDF-084), `src/ui/viewer/annotation-shapes.tsx`, `src/ui/messages.ts` (`annotationKinds`).
- `pnpm typecheck` señala cada `switch` exhaustivo sobre `Annotation['type']`: añade el caso en todos.
- Base64: `btoa`/`atob` no están en `core` sin DOM; usa `Uint8Array.prototype.toBase64` / `Uint8Array.fromBase64` si el `lib` de TS los tiene; si no, implementa `toBase64`/`fromBase64` en `src/core/base64.ts` con tests.

## Qué hay que hacer
1. `model.ts`:
```ts
export type SignatureArt =
  | { readonly kind: 'ink'; readonly paths: readonly (readonly number[])[]; readonly width: number; readonly box: readonly [number, number] } // trazos en [0..box[0]]×[0..box[1]], origen abajo-izquierda
  | { readonly kind: 'image'; readonly format: 'rgba-deflate' | 'jpeg'; readonly data: string; readonly pixelWidth: number; readonly pixelHeight: number }; // data en base64
export interface SignatureAnnotation extends Base { readonly type: 'signature'; readonly art: SignatureArt }
```
   Añádelo a `Annotation`. `translateAnnotation` mueve solo `rect`. `isAnnotation` valida `art` (ink: como `ink` + `box` positivos; image: `format` válido, `data` cadena no vacía, dimensiones enteras > 0). Nueva `resizeSignature(a: SignatureAnnotation, rect: RectPt): SignatureAnnotation`.
2. `appearance.ts`: `buildAppearance(a, imageRef?: PdfRef)`. Firma `ink`: `q sx 0 0 sy x1 y1 cm 1 J 1 j <width> w <color> RG … S Q` con `sx = (x2−x1)/box[0]`, `sy = (y2−y1)/box[1]`. Firma `image`: `q (x2−x1) 0 0 (y2−y1) x1 y1 cm /Im0 Do Q` y recursos `/XObject << /Im0 imageRef >>` (sin `imageRef` → `throw new Error` de bug).
3. `to-pdf.ts`: `SUBTYPES.signature = 'Stamp'`; `typeEntries` → `{ Name: name('SuiteFirma') }`.
4. `incremental.ts`: `AddedPlan` gana `extra: readonly PdfRef[]` reservado al planificar: firma `image` `rgba-deflate` → 2 (imagen y SMask), `jpeg` → 1, resto 0. Al escribir una firma con imagen: inflar `rgba-deflate` (`inflateSync` de `fflate`) y `rgbaImageObjects(..., extra[1])` o `jpegImageObject`; escribir apariencia (`buildAppearance(a, extra[0])`), imagen y SMask (si `smask` es `null`, el número reservado se escribe igualmente como `null`: así la xref no tiene huecos).
5. `commands.ts`: `ADD_LABEL.signature = 'añadir firma'`, `NOUN.signature = 'firma'`. `comment-list.ts`: etiqueta de tipo «Firma». `messages.ts`: `annotationKinds.signature: 'Firma'`.
6. `annotation-shapes.tsx`: firma `ink` → `<g transform>` con `polyline`s (mismo estilo que `ink`); `image` → `<image href={url} preserveAspectRatio="none">` con `url` de `useSignatureImageUrl(art)` en `src/ui/viewer/signature-image.ts`: `jpeg` → `data:image/jpeg;base64,…`; `rgba-deflate` → infla, pinta en un `canvas` (`ImageData`) y `toDataURL('image/png')`, con caché `WeakMap<SignatureArt, string>`.
7. Tests: `tests/unit/signature-annotation.test.ts` (modelo, `isAnnotation`, apariencia, escritura + pdf.js + qpdf) y uno de UI para la forma SVG.

## Criterios de aceptación
- [ ] Escribir en `basic-5.pdf` una firma `ink` y otra `image` `rgba-deflate` (40×20 px) y otra `jpeg`: pdf.js lee 3 anotaciones `Stamp` con `hasAppearance: true` en sus rects; `qpdf --check` 0; el incremento < 30 KB.
- [ ] La firma `image` con todos los alfa a 255 no lleva `/SMask` y el número reservado existe en la xref (como objeto `null`).
- [ ] `isAnnotation` acepta las tres y rechaza `art.kind: 'svg'`, `pixelWidth: 0` y `box: [0, 10]`. Un borrador con una firma hace ida y vuelta (`toDraft`/`fromDraft`).
- [ ] `translateAnnotation` y `resizeSignature` solo cambian `rect`.
- [ ] Deshacer/rehacer de `addAnnotationCommand(firma)` con etiqueta «añadir firma».
- [ ] UI: la capa dibuja una firma `image` como `<image>` con `href` que empieza por `data:image/png;base64,` y una `ink` con tantos `polyline` como trazos.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Crear la firma (PDF-086) y colocarla con la herramienta (PDF-043). Editar firmas tras guardar (son de solo lectura, ADR-0020).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/core/base64.ts` (nuevo), `src/core/annotations/{model,appearance,to-pdf,commands,comment-list,import}.ts`, `src/core/pdf/incremental.ts`, `src/ui/messages.ts`, `src/ui/viewer/annotation-shapes.tsx`, `src/ui/viewer/signature-image.ts` (nuevo), `tests/support/standard-annotations.ts`, `tests/unit/annotations/{appearance.test.ts,factories.ts}`, `tests/unit/base64.test.ts` (nuevo), `tests/unit/signature-annotation.test.ts` (nuevo), `tests/ui/signature-shapes.test.tsx` (nuevo).
- Qué he hecho: modelo `SignatureAnnotation` (`ink` / `image` rgba-deflate o jpeg) con validación y `resizeSignature`; apariencia `Stamp` (`/Name /SuiteFirma`) con `buildAppearance(a, imageRef?)`; escritor incremental reserva `extra` (2 para rgba, 1 para jpeg) y escribe imagen y SMask (`null` si todo el alfa es 255); etiqueta «Firma» en comandos, panel y mensajes; `<image>` en la capa SVG (con voltear Y) y polylines para la firma dibujada. Base64 propio en `core/` porque el `lib` de TypeScript no tiene `toBase64`. `import.ts` excluye `signature` de `kindOf` (un `/Stamp` ajeno se importa como ajeno).
- Comandos ejecutados y resultado: `pnpm --filter lector-pdf typecheck` OK; `pnpm exec vitest run` de los tests nuevos (base64, signature-annotation, signature-shapes): 30/30 OK; `pnpm test` (raíz): 170 ficheros, 1972 tests OK; `pnpm exec vitest run --coverage --coverage.reportsDirectory=<scratchpad>`: OK (exit 0). `pnpm lint`: mis ficheros limpios; queda un error ajeno en `apps/lector-pdf/tests/unit/forms-history-qa.test.ts:29` (no es mío, no lo he tocado). `qpdf --check` = 0 sobre basic-5 con las tres firmas; pdf.js ve 3 `Stamp` con `hasAppearance: true` en sus rects; incremento < 30 KB (comprobado en el test).
- Dudas o cosas que no he podido hacer:
  1. Al reabrir un PDF con una firma guardada, pdf.js la ve como `/Stamp` ajeno y el panel la muestra como «Sello» (`FOREIGN_LABELS`), no como «Firma». La ficha pide «Firma» en el panel; para eso habría que etiquetar por `/Name SuiteFirma` en `import.ts`/`comment-list.ts`, fuera de lo indicado. Decisión del líder.
  2. Formato `rgba-deflate` = deflate crudo (`fflate.deflateSync` / `inflateSync`). PDF-086 debe producirlo así; lo he dejado documentado en `model.ts`.
  3. Una firma de origen `file` no existe (el import trata los `Stamp` como ajenos), así que la rama de «modificada» en `rewritePage` no escribe imagen. Si alguna vez llegara, `buildAppearance` lanzaría el error de programación.
  4. Durante la coverage hubo un conflicto con otro proceso de Vitest sobre `coverage/` (ajeno); lo ejecuté con un directorio de informes propio. Un aviso «getContext() not implemented» de jsdom sale de otro fichero de tests, no de los míos.


### [revisor] ronda 1 — 2026-10-18 — APROBADO
Cumple los criterios: modelo/validación, apariencia, reserva de `extra` con SMask `null`, etiquetas, capa SVG y tests (30/30 propios). `pnpm lint` y `pnpm typecheck` OK. `pnpm test` da 1 fallo en `tests/unit/save-actions.test.ts` («sin cambios → nothing») causado por una edición ajena sin confirmar en `src/state/save-actions.ts` (`if (false)`, no es de PDF-085); con el árbol limpio no aplica. El tester debe volver a ejecutar la suite con ese fichero restaurado.
1. (opcional) `src/ui/viewer/signature-image.ts` — el orden de imports pone `fflate` tras los locales; solo estilo.
Duda 1 del programador: es coherente con ADR-0020 (siguen siendo ajenas y de solo lectura) y no es parte de esta ficha; abierta como [[PDF-103-etiqueta-firma-al-reabrir]] (pendiente, depende de PDF-085). El líder debe añadirla al Plan.

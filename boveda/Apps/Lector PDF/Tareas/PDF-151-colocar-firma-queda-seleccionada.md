---
tipo: tarea
id: PDF-151
titulo: Que la firma o imagen recién colocada quede seleccionada con su tirador
app: pdf
estado: en-revision
depende_de: []
intentos: 0
skills: [stack-typescript-react, calidad-profesional]
creado: 2026-10-20
actualizado: 2026-10-20
tags: [tarea, pdf, firma, anotaciones, bug]
---

# PDF-151 · Que la firma o imagen recién colocada quede seleccionada con su tirador

Plan: [[Apps/Lector PDF/Plan|Plan]] · Relacionadas: [[PDF-043-firma-visual]], [[PDF-130-anadir-texto-imagen-interfaz]] (donde se detectó)

## Objetivo
Tras colocar una firma («Firmar») o una imagen («Añadir imagen») con un clic, la anotación queda **seleccionada** y se ve su tirador de tamaño, como en Acrobat. Hoy el mismo clic la deselecciona.

## Contexto
- Causa (ya diagnosticada): `AnnotationLayer.tsx` → `createSignatureAt` (l. ~355-368) llama a `placeSignature`, que hace `select(id)`. El `pointerdown` sigue subiendo hasta `Viewer.tsx` → `onPointerDown` (l. ~450), que llama a `clearAnnotationSelection(event.target)` (l. 94-97); el destino es el `svg` de la capa (sin `data-annot-id`), así que hace `select(null)`.
- `src/state/annotation-actions.ts` → `placeSignature` (l. 954) no cambia.

## Qué hay que hacer
1. En `createSignatureAt`, justo después de `event.preventDefault()`, añadir `event.stopPropagation();` con un comentario: «el clic que coloca no debe llegar al visor, que deseleccionaría la firma recién puesta (PDF-151)». No cambiar `clearAnnotationSelection` ni las demás herramientas.
2. Test de interacción en `tests/ui/` (fichero existente de firma si lo hay; si no, `tests/ui/place-signature-selection.test.tsx`): con firma pendiente y herramienta `'signature'`, un `pointerdown` en la capa deja `useAnnotations.getState().selectedId` igual al id devuelto y el tirador de tamaño está en el DOM. Repetir con `'page-image'`.
3. E2E: en `tests/e2e/edit-content.spec.ts` (imagen) y en la prueba E2E de firma existente, quitar el clic extra sobre la anotación que hoy hace falta antes de redimensionar, de modo que el tirador se use justo tras colocar. No borrar ninguna aserción.

## Criterios de aceptación
- [ ] Colocar firma o imagen con un clic → seleccionada, tirador visible; un clic posterior en zona vacía la deselecciona (comportamiento actual intacto).
- [ ] Colocar con teclado (`placeSignatureFromKeyboard`) sigue dejándola seleccionada.
- [ ] Ctrl+Z tras colocar quita la firma/imagen en un paso.
- [ ] Tests nuevos del paso 2 pasan; E2E de firma e imagen pasan sin el clic extra.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` con código 0; `pnpm --filter lector-pdf e2e` sin fallos nuevos.

## Fuera de alcance
- Cambiar cómo se seleccionan o deseleccionan las demás anotaciones.
- El fallo E2E de exportación ([[PDF-150-exportar-cancelar-a-mitad]]).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/ui/viewer/AnnotationLayer.tsx` (`createSignatureAt`: `stopPropagation`), `apps/lector-pdf/tests/ui/signature-layer.test.tsx` (3 tests nuevos PDF-151), `apps/lector-pdf/tests/e2e/edit-content.spec.ts` (quitado el clic extra antes del tirador; aserciones intactas).
- Qué he hecho: el clic que coloca la firma o imagen ya no llega al visor, así que queda seleccionada con su tirador. Los tests nuevos fallaban antes del arreglo (rojo) y pasan después. Un clic posterior en zona vacía sigue deseleccionando. `tests/e2e/signature.spec.ts` no tenía clic extra antes del tirador (ahí se mueve arrastrando la firma), así que no se ha tocado.
- Comandos ejecutados y resultado: `pnpm lint` (0); `pnpm typecheck` (0); `pnpm coverage` (0; 310 ficheros, 4025 tests en verde); `LECTOR_E2E_PORT=4151 LECTOR_E2E_OUTDIR=dist-pdf151 pnpm --filter lector-pdf e2e tests/e2e/edit-content.spec.ts tests/e2e/signature.spec.ts` (9/9 OK). El puerto por defecto 4173 estaba ocupado por el E2E de otro agente, por eso el puerto propio.
- Dudas o cosas que no he podido hacer: el test de interacción replica el manejador de `Viewer` (`clearAnnotationSelection`, no exportado) con un wrapper en `signature-layer.test.tsx`, porque montar `Viewer` completo con una página renderizada es complejo. El E2E sí recorre el visor real. No he ejecutado `pnpm --filter lector-pdf e2e` completo (lo hace el tester o el coordinador).

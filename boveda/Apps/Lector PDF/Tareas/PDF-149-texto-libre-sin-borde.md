---
tipo: tarea
id: PDF-149
titulo: Texto libre sin borde (campo borderless en el modelo)
app: pdf
estado: en-revision
depende_de: []
intentos: 0
skills: [stack-typescript-react, formatos-ofimatica]
creado: 2026-10-20
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-6, edicion, nucleo]
---

# PDF-149 · Texto libre sin borde

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0036-anadir-contenido-aplanando]] · La necesita: [[PDF-130-anadir-texto-imagen-interfaz]]

## Objetivo
`FreeTextAnnotation` admite un campo opcional `borderless?: true`. Con él, ni la vista ni el dibujo al guardar (apariencia y aplanado) pintan el rectángulo de borde. Sin él, todo queda exactamente igual que ahora. El texto añadido como contenido de la página ([[PDF-130-anadir-texto-imagen-interfaz]]) lo usa para no tener borde ni fondo.

## Decisión del líder
- Campo explícito `borderless?: true` (mismo estilo que `flatten?: true`, compatible con `exactOptionalPropertyTypes`). No se liga a `flatten`: son cosas distintas (aspecto y forma de guardar).
- El fondo ya es transparente en el texto libre; no hace falta nada para el fondo.

## Contexto
- `src/core/annotations/model.ts:56-65` (`FreeTextAnnotation`), `:252-287` (`isAnnotation`, `isFlattenValid`).
- `src/core/annotations/appearance.ts:144-172` → `freeTextDrawing`.
- `src/ui/viewer/annotation-shapes.tsx:259-300` → `FreeTextShape`.
- `src/core/annotations/freetext.ts:85-120` → `NewFreeTextInput`, `newFreeTextAnnotation`.

## Qué hay que hacer
1. `model.ts`: en `FreeTextAnnotation` añade `readonly borderless?: true;` con comentario JSDoc «Sin rectángulo de borde (texto añadido a la página, PDF-130)». Añade `function isBorderlessValid(v: Record<string, unknown>): boolean`: `undefined` → `true`; si no, `v.borderless === true && v.type === 'freetext'`. Llámala en `isAnnotation` junto a `isFlattenValid`.
2. `freetext.ts`: `NewFreeTextInput` gana `readonly borderless?: true`; `newFreeTextAnnotation` lo copia solo si es `true` (no escribir la clave con `undefined`).
3. `appearance.ts` → `freeTextDrawing`: las tres primeras operaciones (`'1 w'`, color `RG`, `re S`) solo si `a.borderless !== true`. Actualiza el comentario de la función.
4. `annotation-shapes.tsx` → `FreeTextShape`: el `<rect>` del borde solo si `a.borderless !== true`.
5. Tests (casos nuevos en los ficheros existentes de `tests/unit/` de modelo, apariencia, texto libre y formas; localízalos con `node scripts/indice-codigo.mjs apps/lector-pdf/tests --buscar freeText`).

## Criterios de aceptación
- [ ] Unit: `isAnnotation` acepta un texto libre con `borderless: true`; rechaza `borderless: false`, `borderless: 'x'` y `borderless: true` en una nota o una firma.
- [ ] Unit: el dibujo de `freeTextDrawing` para un texto libre con `borderless: true` no contiene `re S` ni `RG`; sin el campo, sí los contiene (igual que antes).
- [ ] Unit (Testing Library): `FreeTextShape`/`AnnotationShape` con `borderless: true` no renderiza el `<rect>` con `stroke`; sin el campo, sí.
- [ ] Unit: `newFreeTextAnnotation({ ..., borderless: true })` devuelve `borderless: true`; sin él, el objeto no tiene la clave `borderless` (`'borderless' in a === false`).
- [ ] Un borrador de recuperación con un texto libre `borderless: true` se restaura (la validación lo acepta).
- [ ] `pnpm lint`, `pnpm typecheck` y `pnpm coverage` con código 0; sin cambios en los tests existentes salvo añadir casos.

## Fuera de alcance
- Interfaz, barra «Editar» y herramienta `'page-text'` ([[PDF-130-anadir-texto-imagen-interfaz]]).
- Leer `borderless` de PDFs ajenos (`import.ts`) o escribir `/BS` en la anotación exportada: el aspecto lo da la apariencia (`/AP`), y el texto de página siempre se aplana.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/core/annotations/model.ts`, `freetext.ts`, `appearance.ts`, `apps/lector-pdf/src/ui/viewer/annotation-shapes.tsx`; tests en `apps/lector-pdf/tests/unit/annotations/{model,appearance,freetext,draft}.test.ts` y `apps/lector-pdf/tests/ui/freetext-editor.test.tsx`.
- Qué he hecho: campo `borderless?: true` en `FreeTextAnnotation` con validación `isBorderlessValid` (solo texto libre) y su uso en `isAnnotation`; `NewFreeTextInput.borderless` que se copia solo si es `true`; `freeTextDrawing` y `FreeTextShape` omiten el borde si `borderless`. Casos nuevos en los tests existentes (sin tocar los previos).
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK (tras corregir tipado en un test de borrador); `pnpm coverage` código 0, 307 ficheros y 3981 tests pasados, líneas 98,33 %.
- Dudas o cosas que no he podido hacer: ninguna.

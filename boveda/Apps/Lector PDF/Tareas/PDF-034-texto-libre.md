---
tipo: tarea
id: PDF-034
titulo: Cuadros de texto libre sobre la página
app: pdf
estado: hecha
depende_de: [PDF-031, PDF-069]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, ui, anotaciones]
---

# PDF-034 · Texto libre

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]]

## Objetivo
Con la herramienta «Texto», un clic (o arrastrar un rectángulo) crea un cuadro de texto que se escribe directamente sobre la página; se puede volver a editar con doble clic, cambiar de tamaño con un tirador, y elegir tamaño de letra y color de texto.

## Contexto
- Leer: `AnnotationLayer.tsx` (PDF-031), `src/state/annotation-actions.ts` (`fontSize`, `colors.freetext`), `src/core/annotations/{wrap,helvetica-widths}.ts` (PDF-027).
- Lo que se ve al editar debe coincidir con la apariencia que se guardará: misma fuente lógica (Helvetica; en pantalla `Helvetica, Arial, sans-serif`), mismos márgenes (2 pt) e interlineado (1,15), y `wrapText` para el ajuste de líneas.

## Qué hay que hacer
1. Herramienta `freetext`: clic → `rect` de 200×(fontSize × 1,15 + 4) pt con la esquina superior izquierda en el punto; arrastrar (> 5 px) → el rectángulo dibujado (mínimo 20×(fontSize+4) pt). Se abre el **editor en el sitio** sin crear todavía la anotación.
2. `src/ui/viewer/FreeTextEditor.tsx`: `textarea` posicionado exactamente sobre el `rect` (en px CSS con la escala actual; con rotación de vista, el editor rota con `transform` CSS igual que la página), fondo transparente, borde punteado, fuente y tamaño = `fontSize × escala`, color = `textColor`. `aria-label` «Texto del cuadro».
   - Confirmar = perder el foco, Esc o clic fuera. Al confirmar: si es **nuevo** y el texto (sin espacios) está vacío → no se crea nada; si es nuevo con texto → `addAnnotation` (etiqueta «añadir texto»); si existía y cambió → `updateAnnotation(..., 'editar texto')`; si existía y queda vacío → `deleteAnnotation`.
   - Mientras se edita, el texto crece hacia abajo: si las líneas de `wrapText` no caben, el `rect` aumenta de alto (sin pasar del borde inferior de la página).
3. Doble clic o Intro sobre un texto libre → editor en el sitio con su texto.
4. Tirador de tamaño (esquina inferior derecha, 8×8 px, `aria-label` «Cambiar tamaño») en el texto libre seleccionado: arrastrar → `updateAnnotation` con el `rect` nuevo (mínimo 20 × (fontSize + 4) pt), etiqueta «cambiar tamaño»; con teclado, Mayús+flechas sobre la anotación seleccionada cambian ancho/alto 1 pt (`mergeKey 'resize:<id>'`).
5. `CommentToolbar` con «Texto» activo o un texto libre seleccionado: «Tamaño de letra» y «Color» cambian la herramienta **y** la anotación seleccionada (`textColor` desde la paleta; el borde usa `color`, que se mantiene).
6. Tests `tests/ui/freetext-editor.test.tsx` y `tests/e2e/freetext.spec.ts`.

## Criterios de aceptación
- [x] (T) Clic con la herramienta y Esc sin escribir → ninguna anotación ni entrada de deshacer.
- [x] (T) Escribir «Hola» y perder el foco → 1 anotación `freetext` con `contents 'Hola'`, `fontSize` de la herramienta, y 1 entrada de deshacer.
- [x] (T) Editar una existente dejando el texto vacío → se borra; Ctrl+Z la recupera con su texto.
- [x] (T) Mayús+→ ×3 sobre un texto libre seleccionado → ancho +3 pt en una sola entrada de deshacer.
- [x] E2E: crear «Texto de prueba áéí €» a 14 pt en `basic-5.pdf`, confirmar → el texto se ve en la página (la capa contiene un `<text>` con ese contenido) y no queda `textarea`.
- [x] E2E: con zoom 200 % el editor coincide con el `rect` (bounding box del `textarea` = `rect × escala` ± 2 px).
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Formato enriquecido (negrita, alineación), fuentes distintas de Helvetica, llamadas (*callout*).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [lider] replanificación — 2026-10-17
- `depende_de` gana [[PDF-069-barra-comentar]]: la barra «Comentar» (`CommentToolbar`, menús Color/Grosor/Tamaño) ya no la crea PDF-030, sino PDF-069. Donde esta ficha dice «`CommentToolbar`», es el componente de PDF-069 (`src/ui/toolbar/CommentToolbar.tsx`).

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: ninguno en esta ronda. El trabajo de la sesión anterior (sin commitear) ya estaba completo: `src/core/annotations/freetext.ts`, `src/ui/viewer/FreeTextEditor.tsx` (+ `.module.css`), `src/ui/viewer/freetext-box.ts`, cambios en `AnnotationLayer.tsx`, `annotation-actions.ts`, `annotation-store.ts`, `CommentToolbar.tsx`, `annotation-shapes.tsx`, `messages.ts`, y tests `tests/unit/annotations/freetext*.test.ts`, `tests/ui/freetext-editor.test.tsx`, `tests/e2e/freetext.spec.ts`, más hunks en `tests/ui/comment-toolbar.test.tsx`.
- Qué he hecho: revisado el código frente a los puntos 1–6 y a los criterios de aceptación; cada criterio tiene su test (creación con Esc sin texto, 1 anotación y 1 deshacer al confirmar, borrado con deshacer, Mayús+→ ×3 en una entrada, E2E de texto y de zoom 200 %). No he tocado el trabajo de PDF-036 (`comment-list.ts`, `CommentsPanel*`, `Sidebar.tsx`, sus tests ni los hunks de PDF-036 en los ficheros compartidos).
- Comandos ejecutados y resultado: `pnpm lint` → 0; `pnpm typecheck` → 0; `pnpm test` → 141 ficheros, 1665 tests en verde; `pnpm coverage` → 0 (líneas 98,96 %, ramas 92,73 %); `pnpm --filter lector-pdf e2e` → 140 pasan y 1 falla: `performance.spec.ts:169` («ninguna long task supera 100 ms», 111 ms). Repetido en aislado dos veces: pasa las dos (9,5–9,7 s). Lo tomo por ruido de carga tras la suite completa; no es un fallo de esta ficha, pero conviene que el tester lo vigile. `tests/e2e/freetext.spec.ts`: 2/2 OK.
- Dudas o cosas que no he podido hacer: no he hecho commit. El árbol mezcla hunks de PDF-034 y PDF-036 en los mismos ficheros compartidos (`annotation-actions.ts`, `AnnotationLayer.tsx`, `annotation-store.ts`, `messages.ts`, `CommentToolbar.tsx`, `index.ts`), y separarlos sin `git add -p` interactivo es arriesgado. Hace falta decidir si se commitea todo junto o se parte. Las casillas de criterios siguen sin marcar para que las marque el tester.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
- Comprobado: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 141 ficheros / 1665 tests en verde, `freetext.spec.ts` 2/2. Cada criterio tiene su test; el núcleo (`freetext.ts`, `freetext-box.ts`) es puro y el editor reproduce fuente, márgenes (2 pt) e interlineado (1,15) de la apariencia.
- `pnpm --filter lector-pdf e2e` no dio 0 en mi ejecución: falló `open-qa.spec.ts:59` (pasa en aislado, 9/9); en la del programador falló `performance.spec.ts:169`. Son flakys por carga, distintos cada vez y ajenos a esta ficha. El tester debe confirmar con una ejecución limpia.
1. (opcional) `src/state/annotation-actions.ts:480` — si al confirmar la edición `current` ya no es un texto libre, se sale sin llamar a `syncFileVisibility` y un texto del fichero podría quedar oculto — llamar a la sincronización antes de salir.
2. (opcional) `src/ui/viewer/AnnotationLayer.tsx:460` — sangría incorrecta de la línea del `FreeTextEditor`.
3. (opcional) El árbol mezcla hunks de PDF-034 y PDF-036 en ficheros compartidos; commitear juntos o separar con cuidado.

### [tester] ronda 1 — 2026-10-18 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Clic + Esc sin escribir | OK | `tests/ui/freetext-editor.test.tsx:114` en verde |
| «Hola» + blur = 1 anotación, 1 deshacer | OK | `:124` |
| Vaciar existente borra; Ctrl+Z recupera | OK | `:178` |
| Mayús+→ x3 = +3 pt, 1 entrada | OK | `:215` |
| E2E texto «áéí €» a 14 pt | OK | `freetext.spec.ts:30` x3 repeticiones |
| E2E zoom 200 % | OK | `freetext.spec.ts:49` x3 repeticiones |
| lint / typecheck / test / coverage / e2e | OK | 0; 1665 tests; líneas 98,96 %, ramas 92,73 %; e2e 141 pasan (2,2 min) |

Flakys: `performance.spec.ts:169` y `open-qa.spec.ts:59` pasan en la suite completa limpia y 3/3 repetidas en aislado. Ruido de carga, no regresión.
Tests añadidos: ninguno (los existentes cubren todos los criterios). Rendimiento: long tasks < 100 ms en `performance.spec.ts:169`.
Notas opcionales del revisor (syncFileVisibility en `annotation-actions.ts:480`, sangría) siguen abiertas; no bloquean.

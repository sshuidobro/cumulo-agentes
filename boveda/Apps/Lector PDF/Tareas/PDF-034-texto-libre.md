---
tipo: tarea
id: PDF-034
titulo: Cuadros de texto libre sobre la página
app: pdf
estado: pendiente
depende_de: [PDF-031]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
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
- [ ] (T) Clic con la herramienta y Esc sin escribir → ninguna anotación ni entrada de deshacer.
- [ ] (T) Escribir «Hola» y perder el foco → 1 anotación `freetext` con `contents 'Hola'`, `fontSize` de la herramienta, y 1 entrada de deshacer.
- [ ] (T) Editar una existente dejando el texto vacío → se borra; Ctrl+Z la recupera con su texto.
- [ ] (T) Mayús+→ ×3 sobre un texto libre seleccionado → ancho +3 pt en una sola entrada de deshacer.
- [ ] E2E: crear «Texto de prueba áéí €» a 14 pt en `basic-5.pdf`, confirmar → el texto se ve en la página (la capa contiene un `<text>` con ese contenido) y no queda `textarea`.
- [ ] E2E: con zoom 200 % el editor coincide con el `rect` (bounding box del `textarea` = `rect × escala` ± 2 px).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Formato enriquecido (negrita, alineación), fuentes distintas de Helvetica, llamadas (*callout*).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

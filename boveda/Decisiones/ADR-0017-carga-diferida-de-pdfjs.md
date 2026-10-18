---
tipo: decision
id: ADR-0017
app: pdf
estado: aceptada
fecha: 2026-10-18
creado: 2026-10-18
actualizado: 2026-10-18
tags: [decision, pdf, rendimiento, arranque]
---

# ADR-0017 · pdf.js se carga con `import()` diferido y el arranque tiene presupuesto de bundle

## Contexto
`render.spec.ts` «images-200…» falló con una *long task* de 101 ms ([[PDF-073-e2e-long-tasks-en-serie]], ronda 1). El líder lo midió con una traza de Chromium (4 ejecuciones aisladas, 2026-10-18): la única *long task* de la prueba ocurre a los 70-100 ms de cargar la página, **antes de abrir ningún PDF**, y es `v8.evaluateModule` del chunk de entrada `index-*.js` (917 KB minificado): 67, 93, 96 y 99 ms. No tiene que ver con las imágenes: es el arranque de la app, que congela la ventana casi 100 ms.

Reparto del chunk de entrada (por `sourcesContent` del mapa): `pdfjs-dist` ≈ 1 044 KB de fuente (≈ 50 % del minificado), `react-dom` 620 KB, código de la app ≈ 450 KB, `fflate` 88 KB. Todo el JavaScript se importa de forma estática desde `src/main.tsx`, así que se evalúa en una sola tarea.

Relacionado: [[ADR-0007-motor-y-visor-pdf]] (pdf.js solo se importa desde `src/engine/pdfjs.ts`), [[ADR-0013-pdfjs-build-legacy]] (build legacy), [[ADR-0016-e2e-long-tasks-en-serie]].

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| Dejarlo así | Nada que hacer | Arranque al borde del presupuesto de 100 ms; falla de forma intermitente | — |
| `manualChunks` (pdf.js en otro chunk, importado estático) | Sin cambios de código | Los chunks estáticos se evalúan igual antes de pintar: no reduce la tarea | — |
| `import()` diferido de pdf.js desde `src/engine/pdfjs.ts`, con precarga en reposo tras el primer render | La evaluación se parte en dos tareas (≈ mitad cada una); la ventana pinta antes; un solo punto de cambio (ADR-0007) | Las funciones del motor que usan valores de pdf.js deben llamarse después de cargarlo (invariante: solo con un documento abierto) | Apache-2.0 (pdf.js, ya en uso) |
| Mover pdf.js entero al worker (OffscreenCanvas) | Hilo principal libre | Reescritura grande del motor y de la capa de texto; fuera de esta iteración | — |

## Decisión
`src/engine/pdfjs.ts` deja de reexportar valores de pdf.js: exporta solo tipos, `loadPdfjs(): Promise<PdfjsModule>` (carga única y cacheada con `import()`) y `pdfjs(): PdfjsModule` (acceso síncrono; lanza si aún no se cargó, porque sería un bug). `loadPdf` espera a `loadPdfjs()` antes de abrir. `main.tsx` precarga pdf.js en reposo tras el primer render. Un script `pnpm --filter lector-pdf bundle:check` comprueba tras el build que pdf.js es un chunk diferido y que el JavaScript estático del arranque pesa ≤ 500 000 bytes.

## Consecuencias
- El arranque deja de ser una sola tarea de ~100 ms; la prueba «images-200…» gana margen sin tocar su umbral.
- Regla nueva para el motor: nunca usar valores de pdf.js en el nivel superior de un módulo; siempre `pdfjs().X` dentro de funciones. Los tipos siguen importándose de `./pdfjs`.
- Los tests de Vitest cargan pdf.js una vez en `tests/setup/setup.ts`.
- Vigilar: `bundle:check` falla si alguien vuelve a importar pdf.js de forma estática o si el arranque crece por encima del presupuesto (entonces se decide qué más diferir: `fflate`, diálogos, guardado).
- Fichas: [[PDF-074-presupuesto-bundle-arranque]], [[PDF-075-pdfjs-diferido]].

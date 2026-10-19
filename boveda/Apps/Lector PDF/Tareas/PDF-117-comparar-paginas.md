---
tipo: tarea
id: PDF-117
titulo: Comparar - páginas lado a lado con cambios resaltados y superposición
app: pdf
estado: pendiente
depende_de: [PDF-112]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, comparar, ui]
---

# PDF-117 · Comparar: páginas lado a lado con cambios resaltados y superposición

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0031-comparar-pdfs]] · Antes: [[PDF-112-comparar-interfaz]]

## Objetivo
Al seleccionar un cambio, la vista de comparación pinta la página de cada documento lado a lado con las palabras eliminadas (rojo), añadidas (verde) y sustituidas (amarillo) resaltadas, y permite cambiar a una superposición que muestra en color todo lo que difiere (también imágenes y formato).

## Contexto
- [[ADR-0031-comparar-pdfs]] («Superposición», «Vista»).
- `src/state/compare-actions.ts` (PDF-112): `useCompare`, `comparedDocument`; `useViewer.pdf` (documento A).
- `src/engine/render.ts` → `renderPageToCanvas`; `src/engine/text.ts` → `createTextLayer`, `TextLayerHandle`; `src/ui/viewer/SearchHighlights.tsx` → `rangeForMatch` (convierte `{ start, end }` en un `Range`).
- `src/core/print/plan.ts` → `printScale` (tope de píxeles); `src/core/canvas-size.ts`.
- `src/ui/compare/CompareView.tsx` (hueco `data-testid="compare-pages"`).

## Qué hay que hacer
1. `src/ui/compare/ComparePages.tsx`: para el cambio seleccionado (página `p`), dos columnas «Documento abierto» / «<nombre del otro>»; cada una con un lienzo (`renderPageToCanvas` a la escala que ajusta la página al ancho de la columna, `rotation` 0, `outputScale` = `devicePixelRatio` limitado por `printScale`) y encima una capa de texto oculta (`createTextLayer`, `opacity: 0`, sin selección) para medir; los resaltados son `div` absolutos con los `getClientRects()` del `Range` de cada palabra (`rangeForMatch(textDivs, { pageIndex: p, start, end })`). Colores con variables CSS (`--compare-removed`, `--compare-added`, `--compare-replaced`) en claro y oscuro, con 35 % de opacidad. Página que solo existe en un documento: la otra columna muestra «No existe en este documento».
2. Selector «Lado a lado / Superposición» (dos botones con `aria-pressed`). Superposición: un lienzo con la página A pintada, `globalCompositeOperation = 'difference'` y la página B pintada encima (las dos a la misma escala, la de A; si tamaños distintos, B anclada arriba a la izquierda); leyenda «Negro: igual. Color: diferente.».
3. Recursos: un render por columna a la vez; al cambiar de selección se cancela el anterior (`AbortController`) y los lienzos viejos se liberan (`width = height = 0`); `page.cleanup()` al desmontar.
4. Botones «Cambio anterior» / «Cambio siguiente» (también Alt+Flecha arriba/abajo con la vista abierta) que llaman a `selectChange`.
5. Tests `tests/ui/compare-pages.test.tsx` (con `renderPageToCanvas` y `createTextLayer` simulados) y casos nuevos en `tests/e2e/compare.spec.ts`.

## Criterios de aceptación
- [ ] E2E (`basic-5.pdf` frente a `basic-5-changed.pdf`): al seleccionar el cambio, la columna izquierda tiene exactamente un resaltado `[data-change="removed"]` o `replaced` sobre «página» y la derecha uno sobre «hoja» (el texto bajo cada resaltado, por coordenadas en la capa de texto, es esa palabra).
- [ ] E2E: en superposición, un píxel de una zona sin texto es negro (R, G, B < 16) y hay píxeles no negros dentro de la caja de la palabra cambiada.
- [ ] E2E `@perf`: comparar `pages-5000.pdf` con `pages-20000-flat.pdf` (cada página difiere en «de 5000» / «de 20000»; las 15 000 de más salen como `only-in-b`), dejar que termine o cancelar a las 200 páginas, y pulsar 20 veces «Cambio siguiente» → como mucho 3 `<canvas>` vivos dentro de la vista en todo momento y ninguna *long task* > 100 ms.
- [ ] UI: cambiar de selección cancela el render anterior (espía de `signal.aborted`).
- [ ] Teclado y lectores de pantalla: el selector y los botones tienen nombre accesible; los resaltados son `aria-hidden` y la lista ya describe el cambio.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Sincronizar el desplazamiento de documentos completos, zoom libre en la vista de comparación, exportar el informe.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

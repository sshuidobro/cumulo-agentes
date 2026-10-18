---
tipo: decision
id: ADR-0024
app: pdf
estado: aceptada
fecha: 2026-10-18
creado: 2026-10-18
actualizado: 2026-10-18
tags: [decision, pdf, visor]
---

# ADR-0024 · Modos de página: layout por filas, modo paginado como ventana del layout, pantalla completa por la plataforma

## Contexto
Adobe Reader ofrece: «Vista de una página», «Activar desplazamiento», «Vista de dos páginas», «Desplazamiento de dos páginas», «Mostrar portada en vista de dos páginas» y pantalla completa (Ctrl+L) ([[Paridad Adobe Acrobat]], área 1). Nuestro visor ([[ADR-0007-motor-y-visor-pdf]]) tiene un layout virtual de una columna (`core/layout.ts`: `tops`, `widths`, `heights`, escalado del scroll) que debe seguir igual de rápido con 100 000 páginas.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes |
|---|---|---|
| **A. Generalizar el layout a filas** (1 o 2 páginas por fila, `lefts` por página) y el modo «una página» como **ventana** del layout (scroll limitado a la fila actual) | Un solo camino de código; la virtualización y el escalado del scroll no cambian | `pageAtY` debe buscar por fila |
| B. Un componente de visor por modo | Simple por modo | Duplica virtualización, zoom, anclaje y atajos |
| C. Añadir desplazamiento horizontal (pdf.js) | — | Adobe no lo tiene; segundo eje virtual |

## Decisión
**Opción A** sin desplazamiento horizontal.
- `computeLayout(dims, params)` gana `params.spread: 'none' | 'pairs' | 'cover'` (`pairs`: 1-2, 3-4…; `cover`: 1, 2-3, 4-5…). Nuevos campos: `lefts` (px desde el borde izquierdo de la fila centrada), `rowOf` (página → fila), `rowTops`, `rowHeights`, `rowCount`. `tops[i]` es el top de la fila de la página (en una fila, las páginas se alinean arriba y se centran en el alto de la fila). `pageAtY` devuelve la primera página de la fila.
- `ViewMode = { scroll: 'continuous' | 'paged'; spread: 'none' | 'pairs' | 'cover' }` en `useViewer` y en las preferencias (por documento no: global). `paged` limita el scroll a `[rowTop, rowTop + rowHeight − alto del visor]`; la rueda o Av Pág al borde pasan a la fila siguiente.
- «Ajustar a la página» y «Ajustar al ancho» usan el ancho de la fila (dos páginas + hueco) en modo doble.
- **Pantalla completa** con `Platform.setFullscreen(on)` (web: Fullscreen API; Tauri: `Window.setFullscreen`, permiso `core:window:allow-set-fullscreen`): oculta barras y panel, modo `paged` + ajustar a la página; Esc o Ctrl+L salen; clic izquierdo/→/Av Pág avanzan; ←/Re Pág retroceden.

## Consecuencias
- Presupuestos de PDF-022 se verifican en cada modo con `pages-100000.pdf`.
- La rotación de vista, la búsqueda, los enlaces y el historial usan `pageAtY`/`tops`, que mantienen su significado.
- El desplazamiento horizontal queda fuera (no está en Adobe).

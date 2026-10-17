---
tipo: tarea
id: PDF-011
titulo: Zoom y rotación de vista en la interfaz (barra, atajos, Ctrl+rueda, anclaje)
app: pdf
estado: pendiente
depende_de: [PDF-010]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, ui, zoom]
---

# PDF-011 · Zoom y rotación de vista en la interfaz

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]]

## Objetivo
El usuario cambia el zoom con botones, un campo editable («125 %»), una lista de ajustes (Automático, Ajustar al ancho, Ajustar a la página, Tamaño real, porcentajes), atajos y Ctrl+rueda/pellizco (centrado en el cursor), y gira la vista 90° a izquierda o derecha. Lo que mira no se pierde al hacer zoom ni al girar.

## Contexto
- Leer: `src/core/zoom.ts` (PDF-007), `src/ui/viewer/Viewer.tsx` (anclaje, PDF-009), `src/ui/App.tsx`, `src/ui/shortcuts.ts`, `src/ui/use-shortcuts.ts`.
- Atajos (Adobe): Ctrl+0 ajustar página, Ctrl+1 tamaño real, Ctrl+2 ajustar ancho. Rotar en Adobe es Ctrl+Mayús++/-, que en teclado español no es fiable (Mayús cambia la tecla): usamos **Ctrl+Mayús+Flecha derecha/izquierda**. En navegador, Chrome no deja anular Ctrl+1/Ctrl+2 (cambian de pestaña): es aceptable; en escritorio funcionan.
- `preventDefault` en `keydown` de Ctrl++/-/0 y en `wheel` con Ctrl evita el zoom del navegador.

## Qué hay que hacer
1. Store: `zoomFocusY: number | null` (px desde el borde superior del visor del punto que no debe moverse en el próximo cambio de layout).
2. `src/state/view-actions.ts`:
   ```ts
   export function setZoomMode(mode: ZoomMode, focusY?: number): void;
   export function zoomIn(focusY?: number): void;            // custom: nextZoom(zoom, 1)
   export function zoomOut(focusY?: number): void;
   export function zoomWithWheel(deltaY: number, deltaMode: 0 | 1 | 2, focusY: number): void; // custom: wheelZoom(...)
   export function rotateView(direction: 1 | -1): void;      // rotation = normalizeRotation(rotation + 90*direction)
   ```
   Sin `focusY`, el foco es el centro del visor (lo resuelve el `Viewer` con su alto).
3. `Viewer.tsx`: el anclaje de PDF-009 se toma en `contentY + (zoomFocusY ?? 0)` y se restaura restando ese mismo desplazamiento; después pone `zoomFocusY` a `null`. Ajusta también `scrollLeft` proporcionalmente al cambio de ancho para mantener centrado el punto (el foco horizontal es el centro). `wheel` con `ctrlKey` (o `metaKey` en Mac) sobre el visor → `preventDefault` y `zoomWithWheel(..., e.clientY - rect.top)`; varias ruedas en el mismo frame se acumulan (un solo cambio por `requestAnimationFrame`).
4. `src/ui/toolbar/MainToolbar.tsx` (+ CSS Module): mueve aquí el botón Abrir de `App.tsx` y añade el grupo de zoom (`ZoomControls.tsx`) y el de rotación. Grupos separados con `role="separator"`. Solo se habilitan con documento abierto.
   - `ZoomControls.tsx`: `IconButton` «Reducir» y «Ampliar»; `<input type="text" aria-label={msg.zoomInput}>` que muestra `formatZoom(zoom)`, aplica con Intro (`parseZoomInput`; `null` → vuelve al valor anterior y muestra el borde de error 1 s) y revierte con Esc; `<select aria-label={msg.zoomPresets}>` con opciones `auto` «Automático», `fit-width` «Ajustar al ancho», `fit-page` «Ajustar a la página», `actual` «Tamaño real», y `50`, `75`, `100`, `125`, `150`, `200`, `300`, `400` «N %». El `select` refleja el modo actual (o queda en blanco si el zoom personalizado no coincide con ninguna opción).
   - Rotación: `IconButton` «Girar a la izquierda» y «Girar a la derecha».
   - Iconos nuevos en `icons.tsx`: `IconZoomIn`, `IconZoomOut`, `IconRotateLeft`, `IconRotateRight`.
5. `shortcuts.ts` añade: `zoom-in` `['Mod+Plus', 'Mod+=', 'Mod+code:NumpadAdd']`; `zoom-out` `['Mod+Minus', 'Mod+code:NumpadSubtract']`; `fit-page` `['Mod+0']`; `actual-size` `['Mod+1']`; `fit-width` `['Mod+2']`; `rotate-right` `['Mod+Shift+ArrowRight']`; `rotate-left` `['Mod+Shift+ArrowLeft']`. Conéctalos en `App.tsx` solo con documento abierto.
6. Mensajes: `zoomIn` «Ampliar», `zoomOut` «Reducir», `zoomInput` «Zoom», `zoomPresets` «Ajuste de zoom», `zoomAuto`, `fitWidth`, `fitPage`, `actualSize`, `rotateLeft`, `rotateRight`, `zoomInvalid` «Escribe un porcentaje entre 10 y 800».
7. Tests: `tests/unit/view-actions.test.ts`, `tests/ui/zoom-controls.test.tsx`, `tests/e2e/zoom.spec.ts`.

## Criterios de aceptación
- [ ] (T) Con zoom efectivo 1: `zoomIn()` → modo `custom` 1.1; `zoomOut()` desde 1.1 → 1; `rotateView(-1)` desde 0 → 270; cuatro `rotateView(1)` → 0.
- [ ] (T) UI: escribir `150` + Intro en el campo → `zoomMode { custom, 1.5 }`; escribir `abc` + Intro → el campo vuelve a mostrar el zoom anterior; Esc revierte lo escrito; elegir «Ajustar a la página» → `{ kind: 'fit-page' }`.
- [ ] (T) Atajos con `user-event`: `Ctrl+Plus`, `Ctrl+=`, `Ctrl+-`, `Ctrl+0`, `Ctrl+1`, `Ctrl+2`, `Ctrl+Mayús+Flecha derecha` cambian el estado como corresponde; dentro de un `<input>` de texto, `Ctrl+Mayús+Flecha derecha` **no** gira.
- [ ] (T) Los botones de icono tienen `aria-label` y `title` con su atajo (p. ej. «Ampliar (Ctrl++)»).
- [ ] E2E: en `basic-5.pdf`, elegir «Tamaño real» en la lista, ir a la página 3 a media altura y pulsar `Ctrl++` tres veces (100 → 110 → 125 → 150 %) → la página actual sigue siendo la 3, el campo muestra «150 %» y el ancho del marco de la página 3 es ×1,5 el inicial (tolerancia 2 %).
- [ ] E2E: `Ctrl` + rueda sobre la mitad inferior de la página 2 → el punto bajo el cursor se mantiene (la página bajo el cursor antes y después es la misma) y el zoom del navegador **no** cambia (`window.devicePixelRatio` igual).
- [ ] E2E: girar a la derecha en `basic-5.pdf` → el marco de la página 1 es más ancho que alto y la página se vuelve a dibujar (`data-rendered="true"`); la captura muestra el texto girado.
- [ ] Teclado: todos los controles alcanzables con Tab, foco visible, el `select` usable con flechas.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Recordar el zoom por documento (PDF-019). Zoom > 800 % nítido (PDF-051). Girar páginas **en el fichero** (PDF-053).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

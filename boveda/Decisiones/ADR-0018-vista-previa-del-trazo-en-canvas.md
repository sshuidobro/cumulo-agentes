---
tipo: decision
id: ADR-0018
app: pdf
estado: aceptada
fecha: 2026-10-18
creado: 2026-10-18
actualizado: 2026-10-19
tags: [decision, pdf, anotaciones, rendimiento]
---

# ADR-0018 · La vista previa del trazo a mano alzada se dibuja de forma incremental en un `<canvas>` temporal

## Contexto
`ink.spec.ts` «dibujar un trazo de 2 000 eventos no produce long tasks» falló una vez en serie con dos *long tasks* de 79 y 145 ms ([[PDF-073-e2e-long-tasks-en-serie]], ronda 1). El líder lo repitió 6 veces aislado (2026-10-18) sin ninguna *long task*: no es una regresión determinista, y en la máquina había otras baterías de agentes en marcha. Aun así, el código de [[PDF-035-dibujo-a-mano]] tiene dos costes que crecen con el trazo y con la página, y que bajo carga pueden producir pausas:
- Cada frame hace `setInkPreview(stroke.points.slice())`: React vuelve a renderizar **toda** `AnnotationLayer` (todas las anotaciones de la página) solo para mover la vista previa.
- Cada frame copia el trazo completo y genera la cadena `points` completa de la `<polyline>`: trabajo y basura O(n) por frame, O(n²) por trazo (con 2 000 puntos, millones de números y decenas de MB de cadenas → recolecciones de basura grandes).

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| Mantener la `<polyline>` en estado de React | Ya existe | O(n²) y re-render de toda la capa por frame | — |
| `<polyline>` imperativa (actualizar `points` con `setAttribute`) | Sin re-render | Sigue construyendo la cadena completa cada frame (O(n²)) | — |
| Un `<polyline>` nuevo por frame con solo los puntos nuevos | O(nuevos) por frame | Cientos de nodos SVG por trazo; uniones entre trozos | — |
| `<canvas>` temporal encima de la página, montado solo mientras se dibuja; cada frame dibuja solo los segmentos nuevos | O(nuevos) por frame, sin copias, sin re-render de la capa; el lienzo desaparece al soltar (no cuenta para el presupuesto de lienzos) | Hay que ajustar el lienzo al `devicePixelRatio` y a la transformación del viewport | — |

## Decisión
Canvas temporal incremental. Lógica de dibujo en `src/ui/viewer/ink-preview.ts` (`prepareInkCanvas`, `drawInkSegments`), sin React. `AnnotationLayer` solo cambia de estado al empezar y al terminar el trazo (montar/desmontar el lienzo); los puntos y el progreso del dibujo viven en el `useRef` del trazo. El dibujo confirmado sigue siendo la anotación SVG de siempre.

## Consecuencias
- Coste por frame constante respecto al largo del trazo y al número de anotaciones de la página.
- El test de UI de la vista previa pasa de buscar una `<polyline>` a buscar el lienzo `data-testid="ink-preview"` y sus llamadas de dibujo (jsdom no dibuja: se usa un contexto 2D simulado).
- Si la e2e vuelve a fallar tras este cambio, el diagnóstico de [[PDF-077-diagnostico-long-tasks]] dirá cuándo ocurrió la tarea y con qué carga de CPU.
- Ficha: [[PDF-076-vista-previa-trazo-canvas]].

## Revisión 2026-10-19
- Evidencia ([[PDF-090-e2e-iteracion-3]], ronda 3): 7/20 fallos de `ink.spec.ts` «2 000 eventos»; la *long task* (≈ 74 ms) es un `Commit` del compositor de ≈ 69 ms durante el trazo, sin GC ni código de la app.
- Decisión: el lienzo temporal se mantiene, pero se pasa a `OffscreenCanvas` con `transferControlToOffscreen()` (dibujado en el hilo principal; sin worker), con *fallback* al lienzo normal si no existe. Alternativas descartadas: subir el umbral (prohibido por [[ADR-0016-e2e-long-tasks-en-serie]]); dibujar en un Worker (más código y mensajes por frame, sin evidencia de que haga falta); lienzo recortado al rectángulo del trazo (cambia la geometría y las pruebas de posición).
- Antes del cambio se contrasta la hipótesis desactivando la vista previa; si sigue fallando, la causa no es el lienzo y se replantea. Ficha: [[PDF-105-vista-previa-trazo-offscreen]].

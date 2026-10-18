---
tipo: decision
id: ADR-0015
app: pdf
estado: aceptada
fecha: 2026-10-18
creado: 2026-10-18
actualizado: 2026-10-18
tags: [decision, pdf, render, tema, accesibilidad]
---

# ADR-0015 · Modo noche: transformar los píxeles del lienzo conservando las imágenes

## Contexto
[[PDF-020-tema-y-modo-noche]] quedó `bloqueada`. La ficha suponía que `render({ pageColors })` de pdf.js «no toca las imágenes». Es falso en pdf.js 6.4.299: `CanvasGraphics.#drawFilter` vuelve a dibujar **todo el lienzo** con un filtro de alto contraste (HCM) que asigna a cada píxel un tono entre el color de texto y el de fondo según su brillo. La imagen de `images-200.pdf` pasa de color (215/48/37) a gris (diferencia 225 en un canal). El criterio «la imagen conserva sus colores (tolerancia 10)» es imposible con `pageColors`.

La nota [[Paridad Adobe Acrobat]] ya preveía «CSS/canvas filter (propio)». Adobe («Reemplazar colores del documento») y los modos oscuros de Edge/Okular no invierten las fotos: es lo que espera el usuario.

Hallazgos en el código de pdf.js 6.4.299 (`legacy/build/pdf.mjs`):
- Las imágenes (`paintImageXObject`, `paintInlineImageXObject`, `paintImageXObjectRepeat`, `paintInlineImageXObjectGroup`) se dibujan siempre en el **cuadrado unidad** bajo la matriz actual (CTM). Las máscaras de imagen (`paintImageMask*`, `paintSolidColorImageMask`) se pintan con el color de relleno: son «tinta», no fotos.
- Existe `render({ recordImages: true })` + `page.imageCoordinates`, pero no está documentado, se calcula solo en el primer render de la página (no sigue a la rotación), no registra los grupos ni las repeticiones y guarda coordenadas en `Float16Array`. Demasiado frágil.
- `page.getOperatorList()` es API pública y estable, y ya la usan nuestros tests (`tests/unit/fixtures.test.ts`).

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| (a) Mantener `pageColors` y aceptar imágenes en gris | Cero código | Fotos, gráficos y logotipos ilegibles o feos; peor que Adobe | — |
| (b) Filtro CSS `invert(1) hue-rotate(180deg)` en el `<canvas>` + capa que «des-invierte» las imágenes | Barato en la GPU | Las imágenes salen en negativo salvo compensación con más elementos DOM por imagen; los píxeles del lienzo no cambian (las pruebas E2E y la impresión no lo ven); dos sitios que mantener alineados al hacer zoom/rotar | — |
| (c) `recordImages` de pdf.js + transformación de píxeles | Menos código propio | API interna, no sigue la rotación, no cubre grupos ni repeticiones | Apache-2.0 |
| **(d) Transformación de píxeles propia tras el render, con los rectángulos de las imágenes calculados desde `getOperatorList()`** | API pública; lógica pura y testeable en Node (`core/`); el lienzo final ya es el de noche (E2E, miniaturas y capturas lo ven igual); mantiene el tono de los colores | Una pasada de CPU por lienzo (≈ 2 M píxeles a 150 %) y un segundo análisis del contenido en el worker de pdf.js | Apache-2.0 (pdf.js) |

## Decisión
Opción **(d)**.
1. pdf.js dibuja la página **normal** (sin `pageColors`; deja de usarse en todo el proyecto).
2. En paralelo se pide `page.getOperatorList({ intent: 'display', annotationMode: AnnotationMode.ENABLE_STORAGE })` (mismo modo de anotaciones que el render). Un intérprete mínimo (`save`/`restore`/`transform`/formularios/grupos/anotaciones) calcula la CTM de cada imagen y su rectángulo en píxeles del lienzo (cuadrado unidad transformado, redondeado hacia fuera y recortado al lienzo).
3. Sobre los píxeles del lienzo se aplica la **inversión de luminosidad HSL conservando el tono** (`c' = c + 255 − max − min`) y después se lleva el resultado a la gama entre `NIGHT_PAGE_COLORS.background` (blanco → `#1f1f23`) y `NIGHT_PAGE_COLORS.foreground` (negro → `#e6e6e6`). Los píxeles dentro de los rectángulos de imagen se restauran sin cambios.
4. **Excepción de escaneados**: una imagen que cubre ≥ 85 % del lienzo se considera una página escaneada y **sí** se transforma (si no, un PDF escaneado seguiría blanco en modo noche).

## Consecuencias
- El modo noche funciona igual en web y en Tauri (Canvas 2D estándar, sin `ctx.filter`, que WebKit no garantiza).
- Coste: una pasada por píxel con tablas de consulta; presupuesto < 100 ms para 2 000 000 píxeles (`tests/perf/`, [[ADR-0012-suite-de-rendimiento]]). El análisis extra de pdf.js va en su worker, en paralelo con el dibujo.
- Limitaciones aceptadas (se documentan en el Manual): imágenes giradas conservan su rectángulo envolvente (con algo de fondo claro alrededor); imágenes con transparencia (PNG con fondo transparente, logotipos) conservan el blanco del papel dentro de su rectángulo; una foto a página completa se invierte (regla de escaneados).
- La impresión y la exportación nunca usan el modo noche (dibujan sin `night`).
- Si una versión futura de pdf.js estabiliza y documenta `imageCoordinates`, se puede sustituir el intérprete propio sin tocar `core/night.ts`.

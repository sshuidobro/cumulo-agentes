---
tipo: decision
id: ADR-0029
app: pdf
estado: aceptada
fecha: 2026-10-19
creado: 2026-10-19
actualizado: 2026-10-19
tags: [decision, pdf, anotaciones, formato]
---

# ADR-0029 · Formas y sellos: modelo propio, lectura con ObjectReader y apariencias generadas

## Contexto
La iteración 6 añade rectángulo, elipse, línea, flecha, polígono y sellos predefinidos ([[PDF-057-formas-y-sellos|PDF-057]], [[Paridad Adobe Acrobat]] área «Comentar»). Hoy esos subtipos se importan como «ajenos» de solo lectura. Base: [[ADR-0009-anotaciones-escritor-incremental]] (modelo propio, `/AP` generada, escritura incremental).

Comprobado en `pdfjs-dist@6.4.299` (`pdf.worker.mjs`): `page.getAnnotations()` da `lineCoordinates` **normalizadas** (pierde el sentido de la flecha), no expone `/IC` (relleno), `/LE` solo en algunos tipos, ni `/NM`. Ya leemos `/Name` de los sellos con `ObjectReader` ([[PDF-103-etiqueta-firma-al-reabrir|PDF-103]], `stamp-names.ts`).

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| **A. Tipos propios en el modelo; geometría leída del diccionario con `ObjectReader`; `/AP` generada por nosotros** | Datos exactos (sentido de la línea, relleno, extremos); mismo patrón que los sellos; misma apariencia en todos los visores | Una lectura de diccionario por forma ajena al importar | propia |
| B. Leer solo de pdf.js | Sin lecturas extra | Pierde sentido de flechas y relleno: ida y vuelta con pérdidas | Apache-2.0 |
| C. Editor de pdf.js (`AnnotationEditorLayer`) | Hecho para sello y tinta | No tiene formas; mezcla dos modelos y dos pilas de deshacer | Apache-2.0 |

## Decisión
**Opción A.**
- **Modelo** (`core/annotations/model.ts`): `square` y `circle` (`width`, `interior: Rgb | null`, trazo por dentro de `rect`), `line` (`points: [x1,y1,x2,y2]`, `endings: [inicio, fin]` con `'None' | 'OpenArrow' | 'ClosedArrow'`, `width`, `interior`), `polygon` (`vertices`, `width`, `interior`) y `stamp` (`name: StampName`). La flecha es una `line` con `endings ['None','OpenArrow']`.
- **PDF**: `/Square`, `/Circle`, `/Line` (`/L`, `/LE`, `/IT /LineArrow` si hay flecha), `/Polygon` (`/Vertices`), con `/BS << /W w /S /S >>` y `/IC` solo si hay relleno; `/Stamp` con `/Name` estándar de ISO 32000-1 §12.5.6.12. Al modificar una forma del fichero se quitan `/RD` y `/BE`.
- **Sellos**: los 14 nombres estándar con texto en español en mayúsculas («APROBADO», «BORRADOR»…), borde redondeado de 2 pt y Helvetica (sin incrustar, WinAnsi); verde para aprobado/final/publicar, rojo para no aprobado/confidencial/alto secreto/caducado/no publicar, azul el resto. En Adobe se ve nuestra `/AP`; Adobe reconoce el `/Name` y lo lista como sello.
- **Importar**: tras `importPageAnnotations`, las ajenas de subtipo `Square`, `Circle`, `Line`, `Polygon` y `Stamp` se leen con `ObjectReader` y pasan a editables si encajan; si no, siguen ajenas **sin tocar su apariencia**. Siguen ajenas: borde discontinuo o con efecto nube (`/BS /S` ≠ `/S`, `/BE /S /C`), extremos distintos de los tres soportados, `/IT` distinto de `/LineArrow` (cotas, nubes), polígonos de menos de 3 vértices y **sellos que no hemos creado nosotros** (`/NM` que no empieza por `suite-` o `/Name` no estándar): así no se sustituye la apariencia de un sello de Adobe.
- **Interfaz**: crear arrastrando (rectángulo, elipse, línea, flecha), por clics (polígono) o con un clic (sello); con teclado, Intro con la herramienta activa crea la forma de tamaño por defecto en la página actual. Mover, cambiar tamaño (rectángulo, elipse, sello), color, grosor (1, 2, 4, 8 pt), borrar y deshacer como el resto de anotaciones. Editar vértices: no en esta iteración.

## Consecuencias
- `annotated.pdf` trae un `/Square` de «otra persona»: pasa a editable. Los tests que lo esperaban ajeno se actualizan en [[PDF-107-importar-formas-y-sellos|PDF-107]].
- Los sellos usan Helvetica WinAnsi: los textos en español con tildes («CADUCADO» no lleva) caben en WinAnsi; sin fuente incrustada (ver «Mejoras conocidas» del Plan).
- Polilínea (`/PolyLine`), nube, cotas y sellos dinámicos o con imagen quedan como ajenos de solo lectura.

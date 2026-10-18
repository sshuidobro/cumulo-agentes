---
tipo: decision
id: ADR-0020
app: pdf
estado: aceptada
fecha: 2026-10-18
creado: 2026-10-18
actualizado: 2026-10-18
tags: [decision, pdf, firma, anotaciones]
---

# ADR-0020 · Firma visual como anotación Stamp con apariencia vectorial o de imagen

## Contexto
Reader permite firmar con firma propia (dibujada, escrita o imagen) gratis ([[Paridad Adobe Acrobat]], área 6, imprescindible). No es firma digital (PDF-066). Debe guardarse dentro del PDF y verse igual en Adobe, navegadores y móviles. Base: [[ADR-0009-anotaciones-escritor-incremental]].

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| **A. Anotación `/Stamp` con `/AP`** (trazos vectoriales o imagen con canal alfa) | Encaja en el modelo y el escritor incremental; se puede mover hasta guardar; delta de pocos KB | Otro programa puede borrarla (igual que en Adobe Fill & Sign) | propia |
| B. Incrustar en el contenido de la página | No se puede quitar | Reescribir el content stream; no incremental sencillo; no se puede mover | propia |
| C. Anotación `/Ink` para la dibujada | Ya existe | No sirve para escrita ni imagen; se confunde con un dibujo | propia |

Fuente para la firma escrita: `@fontsource/dancing-script@5.3.0` (OFL-1.1, `npm view` 2026-10-18, solo ficheros de fuente y CSS) frente a fuentes del sistema (no hay una manuscrita común en Windows, macOS y Linux) o incrustar una TTF en el PDF (subconjunto de fuentes: mucho trabajo).

## Decisión
**Opción A.** Nuevo tipo del modelo `signature` (`SignatureAnnotation`, `/Subtype /Stamp`, `/Name /SuiteFirma`, `/F 4`), con `art`:
- `ink`: trazos en coordenadas de una caja propia (`box` ancho × alto), escalados al `rect` → apariencia vectorial nítida a cualquier zoom.
- `image`: `rgba-deflate` (píxeles RGBA comprimidos con `fflate`, en base64) o `jpeg` (bytes JPEG en base64). Se escribe como Image XObject (`/DeviceRGB` + `/SMask` gris para el alfa; JPEG tal cual con `/DCTDecode`) referenciado desde la apariencia.
- La firma **escrita** se rasteriza en el navegador con la fuente Dancing Script a 4× (canvas) y se guarda como `image`; la **imagen** del usuario (PNG/JPEG) se reduce a ≤ 1 200 px de ancho; la **dibujada** queda vectorial.
- **Firmas guardadas**: hasta 5 en las preferencias locales de la app (`signatures`), nunca fuera del equipo.
- Hasta guardar, la firma se mueve, se redimensiona (manteniendo proporción) y se borra con deshacer/rehacer. **Tras guardar y reabrir es de solo lectura** (es una `Stamp` del fichero, ajena), como en Adobe Fill & Sign.
- Utilidad común `src/core/pdf/image.ts` (RGBA → XObject con SMask; cabecera JPEG) reutilizable por sellos (PDF-057) y crear PDF desde imágenes (PDF-056).

## Consecuencias
- Nueva dependencia: `@fontsource/dancing-script@5.3.0` (OFL-1.1, compatible con uso personal y redistribución). El CSS se importa solo desde el diálogo de crear firma; la fuente se descarga del propio bundle (`font-src 'self'`).
- Los borradores de recuperación pueden crecer (una imagen de firma ≤ ~300 KB en base64): aceptable.
- Firmas muy grandes en imagen hinchan el PDF: límite de 1 200 px de ancho.

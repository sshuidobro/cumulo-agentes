---
tipo: decision
id: ADR-0042
app: pdf
estado: aceptada
fecha: 2026-10-20
creado: 2026-10-20
actualizado: 2026-10-20
tags: [decision, pdf, edicion]
---

# ADR-0042 · Editar texto existente: sustituir una línea con una fuente estándar

Relacionadas: [[PDF-065-editar-texto]] (sustituida) · [[ADR-0039-redaccion-real]] · [[ADR-0036-anadir-contenido-aplanando]] · [[ADR-0037-proteger-reescritura-aes256]] · Investigación: [[Paridad Adobe Acrobat]] (§ edición, «Editar texto existente», opcional, Pro)

## Contexto
El usuario quiere corregir texto que ya está en el PDF. Las fuentes incrustadas suelen ser subconjuntos (solo traen los glifos usados) y el reflujo por párrafos exige medir, partir líneas y gestionar fuentes. Ya existen el intérprete de contenido con cajas de glifos y el borrado glifo a glifo sin mover el resto ([[PDF-062-redactar|PDF-062]], [[PDF-135-redactar-aplicar|PDF-135]]), y la escritura en el contenido de la página ([[PDF-059-anadir-texto-imagen|PDF-059]]).

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| **A. Sustituir línea con fuente estándar** | Reutiliza redactar y escribir contenido; 5 fichas; resultado predecible | El aspecto cambia a Helvetica, Times o Courier; sin reflujo | — (código propio) |
| B. Como A pero con la fuente original si tiene los glifos | Aspecto idéntico en muchos casos | Leer subconjuntos TrueType/CFF/Type1 y `/ToUnicode` inverso: coste alto | — |
| C. Párrafos con reflujo (Acrobat Pro) | Paridad completa | Meses de trabajo | — |
| D. No ofrecerlo | Sin coste | Falta una función que el usuario pide | — |

## Decisión
**Opción A**, elegida por el usuario (Sergio, 2026-10-19 19:06 UTC; [[Bitacora/2026-10-19|bitácora]]).
- **Qué es una línea**: los glifos medidos de la página cuyo centro cae en la caja que la interfaz calcula con los ítems de texto de pdf.js de esa línea, con la misma línea base (±0,25 × tamaño) y horizontales (|ángulo| ≤ 0,5°).
- **Borrar**: los glifos de la línea se quitan con el mismo método que la redacción (ajuste de `TJ` del mismo ancho, el resto no se mueve), **sin** rectángulos negros, sin tocar imágenes ni anotaciones.
- **Escribir**: la línea nueva se dibuja en el contenido de la página, en la línea base y la `x` del primer glifo original, con una de las 12 fuentes estándar no incrustadas (Helvetica/Times/Courier × normal/negrita/cursiva) elegida por el nombre y los `/Flags` de la fuente original, con el mismo tamaño efectivo y el mismo color de relleno. Codificación WinAnsi; un carácter que no está en WinAnsi **no se admite** (aviso en el cuadro de edición, no «?»).
- **Guardar**: las ediciones quedan pendientes (con deshacer/rehacer) hasta Ctrl+S, como las marcas de redacción; al guardar se escribe un incremento y después una **reescritura completa** (`rewriteDocument`, conserva el cifrado) para que el texto viejo no siga en revisiones antiguas.
- **No se edita**: páginas con texto que el intérprete no sabe medir (`unmeasured`) o con un Form XObject que toque la línea, líneas giradas y texto invisible (`Tr` 3 o 7, p. ej. la capa OCR). La interfaz explica el motivo.

## Consecuencias
- El aspecto de la línea editada puede cambiar (otra familia de letra); se dice en la confirmación de guardado.
- Si el texto nuevo es más largo, se sale de la línea y puede pisar lo que haya a la derecha (sin reflujo, decisión del usuario).
- La reescritura completa invalida las firmas digitales: la confirmación lo avisa cuando el documento tiene firmas.
- Fichas: [[PDF-143-editar-texto-estilo-y-borrado]] → [[PDF-144-editar-texto-localizar-linea]] → [[PDF-145-editar-texto-aplicar]] → [[PDF-146-editar-texto-estado]] → [[PDF-147-editar-texto-interfaz]].
- Mejora posible futura: opción B (fuente original cuando tenga los glifos) sobre esta misma base.

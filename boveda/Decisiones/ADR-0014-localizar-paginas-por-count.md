---
tipo: decision
id: ADR-0014
app: pdf
estado: aceptada
fecha: 2026-10-17
creado: 2026-10-17
actualizado: 2026-10-17
tags: [decision, pdf, formato, rendimiento, anotaciones]
---

# ADR-0014 · Localizar páginas por `/Count` y medir el presupuesto de lectura por rangos de forma realista

## Contexto
[[PDF-026-lector-xref]] quedó `bloqueada`: pedía que `ObjectReader.open` + `pageRefs()` + `getDict(página 99 999)` leyera < 25 % de `pages-100000.pdf`. El programador midió (31 101 661 bytes): las 100 000 hojas `/Type /Page` ocupan el **37,9 %** del fichero y la tabla xref el **13,1 %** (en `pages-5000.pdf`, 13,6 %). Una lista completa de páginas exige leer cada hoja (solo leyendo el diccionario se sabe si un hijo es hoja o nodo), así que el criterio era imposible.

Pero el escritor incremental ([[ADR-0009-anotaciones-escritor-incremental]], [[PDF-028-escritor-incremental]]) **no necesita la lista completa**: solo la referencia de las pocas páginas que tienen anotaciones nuevas, borradas o modificadas.

Simulación del líder (Python sobre los fixtures reales, xref completa + caché de bloques de 4 KB + descenso por `/Count`):

| Caso | Bytes leídos |
|---|---|
| `pages-100000.pdf`: abrir + página 99 999 | 13,2 % (44 KB fuera de la xref) |
| `pages-100000.pdf`: + 10 páginas aleatorias | 14,0 % |
| `pages-5000.pdf`: abrir + página 5 000 | 16,2 % |
| `pages-5000.pdf`: + 10 páginas aleatorias | 24,2 % |

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| Relajar el umbral (p. ej. < 60 %) y mantener `pageRefs()` completo | Nada que cambiar en el diseño | Guardar en la página 99 999 lee 18 MB y 100 000 objetos; no escala | — |
| Regenerar `pages-100000.pdf` con páginas en *object streams* | Baja la cifra medida | Maquilla la prueba; los PDFs reales con tabla clásica siguen igual de lentos | — |
| Tabla xref perezosa (leer entradas de 20 bytes bajo demanda) | Bajaría ~13 puntos más | Más código y casos frágiles (entradas de 19/21 bytes); ganancia pequeña (4 MB en lectura secuencial) | — |
| **`pageRef(index)` por descenso con `/Count` + caché de bloques** | Lee O(profundidad × hijos) objetos; escala con 100 000 páginas; es lo que hacen pdf.js y qpdf | Si `/Count` miente hay que volver al recorrido completo | — |

## Decisión
- `ObjectReader` ofrece **`pageRef(index)`** (descenso por `/Count`, con atajo «`/Count` = número de hijos ⇒ cada hijo es 1 página» y vuelta al recorrido completo si el árbol es incoherente), **`pageCount()`** y conserva **`pageRefs()`** (recorrido completo, para documentos pequeños, corpus y comprobaciones). El escritor incremental usa solo `pageRef`.
- Todas las lecturas de objetos pasan por una **caché de bloques alineados de 4 KB** (`BlockCache`, LRU de 256 bloques), para que objetos vecinos (hermanos de un nodo `/Kids`) no generen lecturas repetidas.
- La **tabla xref clásica se sigue leyendo entera** (vista fusionada en memoria). Los presupuestos de bytes se fijan sobre esa base: `pages-100000.pdf` abrir + `pageRef(99 998)` + `getDict` < **15 %**; solo `readXref` < **14 %**; escritor con 10 anotaciones en `pages-100000.pdf` < **16 %**, en `pages-5000.pdf` < **35 %** (fichero pequeño: la xref y los bloques de 4 KB pesan más en proporción).
- La ficha se parte: [[PDF-026-lector-xref]] (filtros + xref) y [[PDF-068-lector-objetos]] (caché de bloques + `ObjectReader`).
- Los tiempos de reloj van en `tests/perf/` ([[ADR-0012-suite-de-rendimiento]]), no en `tests/unit/`.

## Consecuencias
- Guardar anotaciones en la página 99 999 de un PDF de 100 000 páginas lee ~4,1 MB (casi todo la xref) en vez de ~16 MB.
- Si en el futuro hace falta bajar de ~13 % (PDFs de cientos de MB con tabla clásica), la mejora es la tabla perezosa; no cambia la API de `ObjectReader` (`xref.entries` se convertiría en búsqueda asíncrona interna).
- `pageRefs()` sobre 100 000 páginas sigue leyendo todas las hojas: no se usa en el guardado ni en la interfaz.

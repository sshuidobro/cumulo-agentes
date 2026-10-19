---
tipo: decision
id: ADR-0034
app: pdf
estado: aceptada
fecha: 2026-10-19
creado: 2026-10-19
actualizado: 2026-10-19
tags: [decision, pdf, rendimiento, worker]
---

# ADR-0034 · Operaciones de documento en un Web Worker con lectura por mensajes

## Contexto
[[ADR-0028-reescribir-pdfs]] (punto 5) pide que las operaciones largas sobre el PDF (reorganizar 100 000 páginas tarda ~5 s, ver sus «Medidas») no congelen la interfaz (> 100 ms, [[Apps/Lector PDF/Plan|Plan]] → Presupuestos). Las mismas necesidades aparecen en extraer, combinar, crear desde imágenes, proteger, OCR (escritura de la capa), redactar y firmar.
Restricción: el `ByteSource` del fichero abierto no se puede pasar a un Worker. En Tauri lee con `invoke`, que no existe dentro de un Worker; en web es un `File` (clonable) o un *handle*.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| **A. Worker propio + lectura por mensajes**: el Worker pide rangos `read(begin, end)` al hilo principal, que lee del `ByteSource` real | Un único camino para web y Tauri; no copia el fichero entero; el núcleo (`core/`) no cambia | Una ida y vuelta por bloque leído (la `BlockCache` de `ObjectReader` ya agrupa lecturas) | propia |
| B. Hilo principal cediendo el control (`setTimeout(0)` cada N páginas), como la búsqueda | Sin infraestructura | El escritor tiene tramos síncronos largos (serializar 100 000 páginas); cada tramo debería partirse a mano; frágil | — |
| C. Copiar el fichero entero al Worker | Simple | 2× memoria en ficheros de cientos de MB; en Tauri hay que leerlo todo antes de empezar | — |
| D. Comlink u otra librería RPC | Menos código | Dependencia para ~150 líneas; no resuelve la lectura por rangos | Apache-2.0 |

## Decisión
**Opción A.** Un solo Worker de módulo, `src/workers/doc-ops.worker.ts`, creado bajo demanda y reutilizado.
- Protocolo puro y testeable en Node en `src/core/doc-ops/` (`protocol.ts`, `server.ts`, `client.ts`): mensajes `run`, `cancel`, `read`, `read-result`, `read-error`, `progress` y `done`. Los errores vuelven como `AppError` serializable (`code` y `message`; nunca `cause`).
- Fuentes: `{ kind: 'remote', size }` (el Worker pide rangos) o `{ kind: 'bytes', bytes }` (bytes ya en memoria, transferidos).
- Cada operación es una función pura de `core/` registrada en `src/core/doc-ops/ops/index.ts` con su nombre. Para tests de `state/` hay un ejecutor en el mismo hilo (`setDocOpsRunner`).
- Cancelar aborta el `AbortSignal` de la operación dentro del Worker. Progreso con `done/total`.

## Consecuencias
- Ningún trabajo pesado del núcleo corre en el hilo principal; los presupuestos de *long tasks* se pueden medir en e2e.
- El Worker es un *chunk* aparte: no cuenta para el presupuesto del arranque ([[ADR-0017-carga-diferida-de-pdfjs]]).
- Lo que necesita el DOM (dibujar con pdf.js, decodificar JPEG con el navegador, OCR con tesseract.js) se queda fuera de este Worker.
- Vigilar el número de idas y vueltas en ficheros enormes. Si alguna operación supera su presupuesto por E/S, se puede aumentar el bloque de la `BlockCache` del lado del Worker.

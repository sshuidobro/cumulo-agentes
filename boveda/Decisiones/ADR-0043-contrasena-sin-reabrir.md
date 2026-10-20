---
tipo: decision
id: ADR-0043
app: pdf
estado: aceptada
fecha: 2026-10-20
creado: 2026-10-20
actualizado: 2026-10-20
tags: [decision, pdf, cifrado, rendimiento]
---

# ADR-0043 · Pedir la contraseña sin reabrir el documento

## Contexto
[[PDF-099-e2e-iteracion-4|PDF-099]] mide abrir un PDF AES-256 de 1 000 páginas en 3,12 × lo que tarda el mismo sin cifrar (presupuesto ≤ 1,5 ×). Causa: `runOpen` (`apps/lector-pdf/src/state/document-actions.ts`) llama a `loadPdf` sin contraseña, pdf.js rechaza con `PasswordException`, se destruye la tarea de carga (y su worker) y, tras el diálogo, se llama otra vez a `loadPdf`: se repite la lectura de cabecera, el arranque del documento en el worker y el análisis de la tabla xref (~440 ms + ~400 ms). Base: [[ADR-0022-pdf-cifrados]] (contraseña solo en memoria), [[ADR-0017-carga-diferida-de-pdfjs]].

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| A. Usar `loadingTask.onPassword` de pdf.js: la misma tarea espera la contraseña y sigue | Un solo `getDocument`, un solo worker y una sola lectura de xref; es el mecanismo previsto por pdf.js (lo usa su visor) | Cambia el contrato de `loadPdf` (nueva opción) y el bucle de `runOpen` | Apache-2.0 (ya en uso) |
| B. Redefinir la medida (empezar a contar al aparecer el diálogo) | Sin código | Esconde un coste real: el usuario espera dos aperturas; no es "alternativa real" a Adobe | — |
| C. Detectar `/Encrypt` en el tráiler antes de `getDocument` y pedir la contraseña primero | Evita una apertura | Parser propio del tráiler (xref streams, actualizaciones incrementales); duplica trabajo de pdf.js | — |

## Decisión
Opción **A**. `loadPdf` acepta `requestPassword?: (incorrect: boolean) => Promise<string | null>`; si existe, se instala como `loadingTask.onPassword` y la apertura continúa sobre la misma tarea. Sin esa opción el comportamiento no cambia (lo usan `compare-actions` y `print-source`, que ya conocen la contraseña).

**Medida de PDF-099 (a), precisada, no relajada:** el reloj cuenta desde la elección del fichero hasta p1 pintada **menos** el intervalo en que el diálogo de contraseña espera al usuario (de visible a pulsar «Abrir»), porque ese tiempo es del usuario, no de la app. El presupuesto sigue en ≤ 1,5 ×.

## Consecuencias
- Se gana: una sola apertura; menos memoria pico; la contraseña incorrecta se reintenta sin recargar.
- `LoadedPdf` expone `password: string | null` (la que abrió el documento) para que la sesión la guarde en memoria como hasta ahora; nunca se registra ni se persiste.
- Vigilar: cancelar el diálogo, cancelar la apertura o abrir otro fichero mientras se pide la contraseña deben destruir la tarea (los tests de `document-password.test.ts` siguen en verde). Ficha: [[PDF-148-contrasena-sin-reabrir]].

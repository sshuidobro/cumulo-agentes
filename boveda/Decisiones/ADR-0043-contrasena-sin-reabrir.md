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

## Revisión 2026-10-20 · la opción A sola no basta
Hecho (Registro de [[PDF-148-contrasena-sin-reabrir|PDF-148]], ronda 2): pdf.js 6.4.299, tras `onPassword` → `update(p)`, hace `pdfManager.updatePassword` y `loadDocument(false)` en el worker: **vuelve a analizar** cabecera, xref y árbol de páginas dentro de la misma tarea. Medido: ~430 ms hasta el diálogo + ~410 ms tras «Abrir» frente a ~440 ms sin cifrar → razón 1,9.

| Opción | Veredicto |
|---|---|
| Parchear/envolver el worker de pdf.js | Rechazada: bifurcación de un fichero de 60 000 líneas que hay que reaplicar en cada versión; rompe [[ADR-0017-carga-diferida-de-pdfjs]] (worker sin modificar). |
| Relajar el umbral de PDF-099 (a) o dejarlo como deuda | Rechazada: es el coste que ve el usuario (abrir cifrados tarda el doble); B ya se descartó por lo mismo. |
| **C con lo que ya existe**: sondear antes de `getDocument` con `ObjectReader.open` de `core/pdf` (lector xref + manejador de seguridad propios, ya probados por el guardado cifrado) | **Elegida.** El inconveniente original de C («parser propio del tráiler») ya no aplica: el lector existe. Coste: leer la xref (~decenas de ms) y una derivación de clave con contraseña vacía. |

**Decisión revisada: A + C.** `runOpen` llama a `needsUserPassword(source)`; si es `true`, pide la contraseña **antes** de `getDocument` y la pasa como `password` → un solo análisis en pdf.js. `onPassword` (A) se mantiene para la contraseña incorrecta (reanálisis aceptable: es un error del usuario) y como red si el sondeo falla (fichero dañado, cifrado no soportado por `core/pdf` → `false`, pdf.js decide). Los PDF con solo contraseña de propietario no piden nada (la vacía abre como usuario).

Medida y presupuesto de PDF-099 (a) **sin cambios** (≤ 1,5 ×, restando el tiempo del diálogo).

## Nota 2026-10-20 · carga diferida del sondeo
- `needsUserPassword` se importa con `import('../core/pdf/password-probe')` dentro de `runOpen`, no de forma estática: el import estático del barril `core/pdf` subía el arranque a 627 248 B (> 600 000, [[PDF-148-contrasena-sin-reabrir]]). Mismo patrón que `core/pdf/incremental` en `save-actions.ts`. El presupuesto de arranque no se toca.
- La medida de PDF-099 (a) usa 1 par de calentamiento descartado y medianas de 5 aperturas; umbral ≤ 1,5 × sin cambios.

## Nota 2026-10-20 · cómo se mide (a)
- Las esperas de la medida (a) usan `page.waitForFunction(..., { polling: 'raf' })`, no `expect().toBeVisible()`: los reintentos de 100/250/500/1000 ms de este último cuantizan el tiempo y producían una distribución bimodal falsa (~430/~925 ms) ([[PDF-148-contrasena-sin-reabrir]], paso 6). Umbral ≤ 1,5 × sin cambios.

## Revisión 2 · 2026-10-20 · presupuesto absoluto para (a)
Hecho ([[PDF-148-contrasena-sin-reabrir|PDF-148]], ronda 6, medida con `raf`): sin cifrar, mediana de unos 310 ms. Cifrado, unos 560 ms. Sobrecoste estable de unos 250 ms: unos 145 ms hasta el diálogo (sondeo: xref y derivación de clave R6 con contraseña vacía) y unos 90 ms tras «Abrir» (pdf.js deriva la clave y descifra). Razón 1,76-1,86. El doble análisis (unos 930 ms) ya no está.

| Opción | Veredicto |
|---|---|
| Optimizar el sondeo (leer solo tráiler y /Encrypt, sin la xref entera) | Diferida: ahorra 100 ms como mucho, no llega a 1,5 × y añade un segundo parser del tráiler. |
| Mantener ≤ 1,5 × | Rechazada: el coste que queda es fijo (la derivación R6 es lenta a propósito) y no crece con el documento. Con una base de unos 310 ms, la razón castiga una base rápida, no un fallo. |
| **Presupuesto absoluto** | **Elegida:** p1 pintada del cifrado ≤ la del sin cifrar **+ 350 ms** (medianas de 5, sin el tiempo del usuario). Detecta la regresión de reabrir (≥ 400 ms) y deja margen al ruido. |

Sustituye al umbral «≤ 1,5 ×» de la Decisión y de las notas anteriores. El criterio «hasta diálogo < 100 ms» de PDF-148 se anula: se anota, pero no es presupuesto.

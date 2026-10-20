---
tipo: tarea
id: PDF-099
titulo: E2E, accesibilidad, interoperabilidad y rendimiento de la iteración 4
app: pdf
estado: en-curso
depende_de: [PDF-047, PDF-048, PDF-095, PDF-097, PDF-051, PDF-142, PDF-148, PDF-150]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-4, e2e, rendimiento, accesibilidad]
---

# PDF-099 · E2E, accesibilidad, interoperabilidad y rendimiento de la iteración 4

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0016-e2e-long-tasks-en-serie]] · [[ADR-0022-pdf-cifrados]] · [[ADR-0023-pestanas-y-recientes]] · [[ADR-0024-modos-de-pagina]] · [[ADR-0025-lienzo-de-detalle]] · [[ADR-0043-contrasena-sin-reabrir]]

## Objetivo
Cerrar la iteración 4 con evidencia: un flujo completo (abrir cifrado, varias pestañas, modos de vista, zoom alto, anotar, guardar, reabrir desde recientes) estable, presupuestos sin regresión, accesibilidad sin incidencias graves y muestras cifradas para comprobar en Adobe.

## Contexto
- Leer: `tests/e2e/iteration3-flow.spec.ts`, `iteration3-performance.spec.ts`, `iteration3-a11y.spec.ts` (PDF-090, mismo patrón), `tests/fixtures/encrypted.ts` (PDF-091), `tests/support/qpdf.ts`, `tests/support/interop-samples.ts`, `tests/e2e/recent.spec.ts` (OPFS, PDF-049), la sección «Comandos» del Plan.
- Regla del coordinador: las pruebas `@perf` se lanzan sin otras baterías en la máquina.

## Qué hay que hacer
1. `tests/e2e/iteration4-flow.spec.ts`: abrir `encrypted-aes-256.pdf` (contraseña «usuario») y `basic-5.pdf` desde OPFS (dos pestañas); en el cifrado, «Doble página», resaltar texto de la p2 y añadir una nota; cambiar a `basic-5.pdf`, zoom 3 200 % y volver a 100 %; volver al cifrado: el resaltado sigue sin guardar; Ctrl+S; cerrar ambas pestañas; reabrir el cifrado desde «Recientes» → pide contraseña, abre en la página donde estaba y muestra las anotaciones; `qpdf --check --password=usuario` del descargado con código 0.
2. `tests/e2e/iteration4-performance.spec.ts` (`@perf`): (a) abrir un cifrado AES-256 de 1 000 páginas (generado con `qpdfEncrypt` sobre el fixture de rendimiento) hasta la p1 pintada ~~≤ 1,5 × el tiempo del mismo sin cifrar~~ ≤ el tiempo del mismo sin cifrar + 350 ms (medianas; [[ADR-0043-contrasena-sin-reabrir]], «Revisión 2»), restando el intervalo en que el diálogo de contraseña espera al usuario (de visible a clic en «Abrir»; [[ADR-0043-contrasena-sin-reabrir]], la medida la deja hecha [[PDF-148-contrasena-sin-reabrir|PDF-148]]); (b) guardar una anotación en él < 2 s; (c) cambio de pestaña (de PDF-095) y modos (de PDF-050) siguen en presupuesto; (d) los presupuestos de PDF-022, PDF-039 y PDF-090 siguen en verde (no se tocan sus pruebas).
3. `tests/e2e/iteration4-a11y.spec.ts`: axe (`serious`/`critical` = 0) con: diálogo de contraseña (con error), barra de pestañas con 3 documentos, menú «Vista», menú «Abrir recientes», propiedades › Seguridad, pantalla completa; en tema claro y oscuro.
4. `pnpm --filter lector-pdf interop:samples` añade `cifrado-anotado-aes256.pdf` y `cifrado-anotado-rc4.pdf` (contraseña «usuario», con resaltado, nota y firma) y `cifrado-formulario.pdf` (`form-full.pdf` cifrado y relleno) en `apps/lector-pdf/interop-samples/` (ignorada por git); el Registro incluye la lista manual para Adobe (el líder la copia al Manual).
5. Repetir: `e2e --project=chromium --repeat-each=3` y `e2e --project=chromium-perf --no-deps --repeat-each=3`.

## Criterios de aceptación
- [ ] `pnpm --filter lector-pdf e2e` con código 0; las dos repeticiones ×3 con código 0 (con la puerta de reposo pasada).
- [ ] Medidas en el Registro (tabla: medida, presupuesto, valor ×3) para (a)-(c) y los presupuestos del Plan.
- [ ] Axe 0 `serious`/`critical` en las 12 vistas (6 × 2 temas).
- [ ] `qpdf --check --password=usuario` 0 en todos los cifrados guardados por las pruebas nuevas.
- [ ] Sin `waitForTimeout`, `test.skip` ni `.only`.
- [ ] Ninguna contraseña aparece en `localStorage`, IndexedDB (borradores, recientes) ni en la consola del navegador durante el flujo (el test los recorre y busca «usuario»/«propietario»).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm perf` con código 0; `pnpm --filter lector-pdf build` con código 0 (`bundle:check` dentro del presupuesto del Plan; si `@noble/*` lo supera, se carga en diferido como pdf.js — anotarlo).

## Fuera de alcance
- Comprobación en Adobe Reader real (la hace el usuario con la lista). Nuevas funciones.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/tests/e2e/iteration4-performance.spec.ts` (nuevo), `apps/lector-pdf/tests/e2e/iteration4-a11y.spec.ts` (nuevo), `apps/lector-pdf/tests/support/interop-samples.ts` (tres muestras cifradas). `iteration4-flow.spec.ts` ya existía (PDF-126) y pasa sin cambios.
- Qué he hecho: (1) flujo E2E verificado: pasa; `qpdf --check` sobre el guardado. (2) Perf de (a) a (c) en `iteration4-performance.spec.ts`: cifrado AES-256 de 1 000 páginas con `qpdfEncrypt`, en un directorio temporal ASCII (la ruta con «≤» del título hacía que el selector de Chromium no abriera el fichero). (3) Accesibilidad: 6 vistas × 2 temas = 12 comprobaciones de axe, todas en verde. (4) `interop:samples` añade `cifrado-anotado-aes256.pdf`, `cifrado-anotado-rc4.pdf` (RC4 128 con `--allow-weak-crypto`, necesario en qpdf) y `cifrado-formulario.pdf`; `qpdf --check --password=usuario` = 0 en las tres.
- Comandos ejecutados y resultado:
  - `pnpm --filter lector-pdf e2e` sobre `chromium` (todas las no @perf): **310 pasan, 0 fallos** (incluye `iteration4-flow` 1/1 y `iteration4-a11y` 12/12).
  - `e2e --project=chromium-perf --no-deps` (todas las @perf): **33 pasan, 1 falla**: la (a) de `iteration4-performance`. Las de PDF-022, PDF-039, PDF-050, PDF-090 y PDF-095 pasan.
  - `pnpm --filter lector-pdf typecheck`: 0. `eslint --max-warnings 0` sobre los ficheros de esta ficha: 0. `pnpm lint` de la raíz **falla** por `apps/lector-pdf/dist-e2e-full/` (salida de build de otra ejecución en curso que ESLint recorre); no es de esta ficha.
  - `pnpm coverage`: 0. Líneas 98,33 %, sentencias 95,04 %, ramas 89,74 %, funciones 97,9 %.
  - `pnpm --filter lector-pdf build`: 0. Arranque 591 191 bytes de 600 000: no hace falta diferir `@noble/*`.
  - Repeticiones `--repeat-each=3`: **no lanzadas**, porque (a) está en rojo.
- Medidas (ms; presupuesto; valor en una ronda de `chromium-perf`; entre paréntesis, la ronda anterior):

| Medida | Presupuesto | Valor |
|---|---|---|
| (a) abrir `pages-1000.pdf` sin cifrar, ×3 | — | 1036, 437, 435 (mediana 437) (479 en la otra ronda) |
| (a) abrir cifrado AES-256, ×3 | — | 1452, 886, 1361 (mediana 1361) (1424) |
| (a) razón de medianas cifrado / sin cifrar | ≤ 1,5 | **3,12** (2,98) → **FALLA** |
| (b) guardar una nota en el cifrado | < 2 000 | 98 (96) |
| (c) cambio de pestaña, p95 de 20 cambios | ≤ 500 | 92; long tasks 0 |
| (c) cambio a doble página en el cifrado | ≤ 200 | 190 (154) |
| Long tasks en el cambio de pestaña | ≤ 200 | 0 |

- Causa de (a), medida aparte: el cifrado tarda ~440 ms hasta que aparece «Contraseña necesaria» (la app abre el fichero sin contraseña primero) y ~400 ms más tras escribirla (abrirlo y pintar p1). Un sin cifrar tarda ~440 ms en total. Si el reloj empezara al aparecer el diálogo, la razón sería ~0,9. Medir así es una decisión de criterio, no la tomo yo.
- Dudas o cosas que no he podido hacer:
  1. **Pregunta para el líder**: ¿se optimiza el flujo de contraseña para no abrir el documento dos veces (cambio de producto, PDF-046), o se cambia la definición de la medida (p. ej. desde que aparece el diálogo)? Hasta decidirlo, la ficha queda `bloqueada`.
  2. Las repeticiones ×3 no están hechas (ver arriba).
  3. Lista manual para Adobe (para el Manual; las muestras están en `apps/lector-pdf/interop-samples/`, sin versionar). Contraseña de usuario en las tres: «usuario».
     - `cifrado-anotado-aes256.pdf` (AES-256): resaltado, nota, subrayado, tachado, texto libre, tinta y dos firmas (dibujada e imagen). Comprobar: pide contraseña; las anotaciones se ven y se pueden seleccionar; no hay aviso de reparación.
     - `cifrado-anotado-rc4.pdf` (RC4 128 bits): el mismo contenido. Comprobar lo mismo.
     - `cifrado-formulario.pdf` (AES-256): `form-full.pdf` relleno con los valores del criterio 1 de PDF-042. Comprobar: los campos muestran sus valores.
  4. No he tocado ficheros de PDF-127 (`App.tsx`, `DocumentMenu.tsx`, `OrganizeToolbar.tsx`, `messages-organize.ts`, `extract-actions.ts`), que tienen cambios sin confirmar de otro agente. Tampoco los cambios sin confirmar de PDF-126 y PDF-145 en la bóveda.

### [lider] replanificación — 2026-10-20
- Decisión: se **optimiza** el flujo ([[ADR-0043-contrasena-sin-reabrir]]): la contraseña se pide sobre la misma carga de pdf.js (`loadingTask.onPassword`), sin segundo `getDocument`. Ficha nueva [[PDF-148-contrasena-sin-reabrir]]; esta depende de ella.
- La medida (a) se precisa (no se relaja): se resta el tiempo en que el diálogo espera al usuario. Presupuesto sigue ≤ 1,5 ×.
- Al retomar: lo ya hecho (flow, a11y, muestras, perf b-c) se conserva; falta (a) en verde, las repeticiones ×3 y `pnpm lint` de la raíz (si `dist-e2e-full/` sigue apareciendo, comprobar que está en los `ignores` de ESLint; si no, añadirlo).

### [lider] replanificación 2 — 2026-10-20
- El presupuesto de (a) pasa de una razón (≤ 1,5 ×) a un valor absoluto: sobrecoste ≤ 350 ms sobre las medianas, sin el tiempo del usuario. Motivo: el coste que queda es fijo (derivar la clave AES-256 y leer la xref). Ver [[ADR-0043-contrasena-sin-reabrir]], «Revisión 2». El spec lo cambia [[PDF-148-contrasena-sin-reabrir]] (paso 7).

### [lider] dependencia nueva — 2026-10-20
- Añadida [[PDF-150-exportar-cancelar-a-mitad]]: el criterio «`e2e` con código 0» no se puede cumplir mientras falle `export.spec.ts` «Cancelar» a mitad (preexistente, detectado en PDF-130).

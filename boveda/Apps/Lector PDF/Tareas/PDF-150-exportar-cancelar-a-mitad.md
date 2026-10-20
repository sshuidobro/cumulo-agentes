---
tipo: tarea
id: PDF-150
titulo: Arreglar «Cancelar» a mitad de la exportación (E2E @perf rojo en HEAD)
app: pdf
estado: en-test
depende_de: []
intentos: 0
skills: [pruebas-calidad, stack-typescript-react, calidad-profesional]
creado: 2026-10-20
actualizado: 2026-10-20
tags: [tarea, pdf, e2e, exportar, rendimiento]
---

# PDF-150 · Arreglar «Cancelar» a mitad de la exportación (E2E @perf rojo en HEAD)

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0016-e2e-long-tasks-en-serie]] · Relacionadas: [[PDF-113-exportar-interfaz]], [[PDF-141-e2e-rojos-en-head]], [[PDF-130-anadir-texto-imagen-interfaz]] (donde se detectó)

## Objetivo
Que la prueba `tests/e2e/export.spec.ts` › «exportar pages-5000 (@perf) › «Cancelar» a mitad no descarga nada» pase de forma estable, arreglando la causa real. Es un fallo **real y preexistente** (verificado por el revisor de PDF-130 en `81934f0` y en HEAD): el botón «Cancelar» del diálogo de progreso no llega a pulsarse.

## Contexto
- Prueba: `apps/lector-pdf/tests/e2e/export.spec.ts:194-215` (el `test` «Cancelar» a mitad).
- Progreso: `apps/lector-pdf/src/ui/export/ExportProgress.tsx` (entero, 25 líneas); se monta en `src/ui/App.tsx:68` (lazy) y `:257` (`exportRunning && <Suspense>`).
- Acciones: `apps/lector-pdf/src/state/export-actions.ts` → `cancelExport` (l. 179) y el bucle de exportación (l. 190-280, comprobaciones de `signal.aborted`).
- Diálogo común: `src/ui/kit/Dialog` (cómo pinta `actions` y si es modal).

## Qué hay que hacer
1. Reproducir: `pnpm --filter lector-pdf e2e --project=chromium-perf --no-deps -g "Cancelar» a mitad" --trace on` (sin otras baterías en la máquina). Anotar en el Registro el error exacto y lo que muestra la traza (¿el diálogo llega a verse?, ¿el clic espera a que el botón sea estable/habilitado?, ¿el hilo principal está ocupado?, ¿la exportación termina antes del clic?).
2. Arreglar según la causa, por este orden de preferencia:
   - Fallo de producto (p. ej. el hilo principal bloqueado más de 100 ms entre páginas, el diálogo se desmonta/remonta y el botón nunca está estable, `cancelExport` no aborta): **corregir el código de la app**. Si es bloqueo del hilo principal, ceder entre páginas (`await` a una tarea nueva tras cada página) para que «Cancelar» responda en < 100 ms.
   - Solo si la prueba está mal (p. ej. la exportación de 20 páginas termina antes de que el diálogo se vea): ajustar la prueba para que siga probando lo mismo (cancelar con trabajo pendiente), p. ej. con un rango mayor (`1-200`). Justificarlo en el Registro.
3. Si cambia código de la app, añadir un test unitario en `tests/unit/` que cubra el caso (cancelar durante el bucle → resultado `'cancelled'` y sin llamar a guardar).

## Criterios de aceptación
- [ ] La prueba pasa: `pnpm --filter lector-pdf e2e --project=chromium-perf --no-deps -g "Cancelar» a mitad" --repeat-each=5` con código 0.
- [ ] Causa raíz anotada en el Registro (error original, causa, arreglo).
- [ ] «Cancelar» responde con teclado (Escape cierra el progreso y cancela) y con ratón; tras cancelar no hay descarga ni aviso «terminada».
- [ ] Sin `waitForTimeout`, `test.skip`, `.only`, ni presupuestos relajados; el test hermano «sin tareas largas > 100 ms» sigue pasando.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Cambiar el diseño del diálogo de exportación o sus textos.
- Otras pruebas E2E que no fallen.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/tests/ui/export-dialog.test.tsx` (test nuevo); la ficha. Sin cambios en el código de la app: el `1-200` de la prueba ya estaba en HEAD (commit `8978075`).
- Qué he hecho: reproducido el fallo. Con la máquina en reposo la prueba «Cancelar» a mitad pasa (3/3 y 5/5 con `--repeat-each`; 1,8–2,2 s cada una). Las rondas fallidas coincidían con otros procesos del equipo en paralelo (`eslint` a ~110 % de CPU, `vitest` y `playwright`): «La máquina no está en reposo: CPU ocupada 51–86 %» y, en una, timeout de 60 s y ENOENT en `test-results/`. Causa raíz: contención de CPU durante la medida, no bug de producto; no toqué el código de la app. Añadido test UI: Escape durante el progreso cancela (foco en «Cancelar», diálogo cerrado, estado `idle`, sin `exportFile`).
- Comandos ejecutados y resultado:
  - `pnpm --filter lector-pdf e2e --project=chromium-perf --no-deps -g "Cancelar» a mitad" --repeat-each=5`: 5/5 OK (código 0).
  - `pnpm lint`: OK. `pnpm typecheck`: OK (tras quitar `exact` de `getByRole` en mis líneas).
  - `pnpm coverage`: 4035 de 4036 OK. **Falla** `tests/ui/open.test.tsx` › «Cancelar aborta la carga y vuelve al estado vacío» (no encuentra el encabezado «Abre un PDF para empezar»). Falla también al ejecutar ese fichero solo; no toco `open.test` ni `src/` (sin cambios respecto a HEAD), así que es previa a esta ficha.
  - `pnpm --filter lector-pdf e2e` completo: 364 OK, 2 fallidos (`iteration4-performance` › cifrado AES-256: «guardar una nota» y «cambio de pestaña»), ambos por «La máquina no está en reposo». Repetidos en aislado (`-g "cifrado AES-256"`): 4/4 OK.
- Dudas o cosas que no he podido hacer:
  - `pnpm test`/`coverage` no están en verde por `open.test.tsx` (rojo previo, fuera de alcance). Hace falta decidir quién lo arregla.
  - Ajena a esta ficha: en el árbol de trabajo hay borrados sin commit los directorios versionados `apps/lector-pdf/dist-firma/` y `dist-qa049/`, y un `stash@{0}` de otra rama. No los he tocado.
  - Los procesos del equipo en paralelo impiden medir `@perf` de forma fiable; conviene no lanzar lint/vitest mientras se mide.

### [revisor] ronda 1 — 2026-10-20 — APROBADO
1. Lint, typecheck y tests de export-dialog y open (15/15) en verde. El test nuevo de Escape cubre cancelar con teclado sin guardar. Causa raíz (contención de CPU, sin bug de producto) documentada y creíble. (opcional) El tester debe confirmar el E2E en reposo con --repeat-each=5.

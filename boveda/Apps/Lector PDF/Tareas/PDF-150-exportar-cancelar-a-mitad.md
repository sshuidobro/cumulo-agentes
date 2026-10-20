---
tipo: tarea
id: PDF-150
titulo: Arreglar «Cancelar» a mitad de la exportación (E2E @perf rojo en HEAD)
app: pdf
estado: pendiente
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

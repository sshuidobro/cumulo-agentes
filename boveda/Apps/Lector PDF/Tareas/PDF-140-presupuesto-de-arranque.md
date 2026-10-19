---
tipo: tarea
id: PDF-140
titulo: Devolver el JavaScript de arranque por debajo de 500 KB
app: pdf
estado: en-revision
depende_de: []
intentos: 0
skills: [stack-typescript-react]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, rendimiento]
---

# PDF-140 · Devolver el JavaScript de arranque por debajo de 500 KB

Plan: [[Apps/Lector PDF/Plan|Plan]] · Relacionadas: [[PDF-090-e2e-iteracion-3]], [[PDF-075-pdfjs-diferido]]

## Objetivo
`pnpm --filter lector-pdf build` vuelve a pasar: la comprobación `tests/bundle/check-bundle.ts` exige como máximo 500 000 bytes de JavaScript de arranque.

## Contexto
- En el commit `3e79927` el build falla: «Arranque: 541666 bytes en 9 ficheros JS (máximo 500000)». En `main` (iteraciones 1-2) eran 445 332 bytes en 3 ficheros.
- Esto bloquea la PR de la rama `pdf-028-escritor-incremental` a `main` (el usuario autorizó abrirla con todo en verde).
- Probable causa: funciones nuevas de las iteraciones 3-4 (pestañas, formularios, firmas, impresión, modos de página) importadas de forma estática desde el arranque.

## Qué hay que hacer
1. Ver qué módulos entran en el arranque (`dist/.vite/manifest.json`, imports estáticos desde `src/main.tsx`/`App`).
2. Pasar a `import()` diferido las funciones que no hacen falta para mostrar la primera página (diálogos, formularios, firmas, impresión, paneles), como ya se hizo con pdf.js en [[PDF-075-pdfjs-diferido]].
3. Objetivo: volver a quedar por debajo de 500 000 bytes; el límite que hace fallar el build ahora es 600 000 ([[ADR-0041-presupuesto-arranque-600kb]]).

## Criterios de aceptación
- [ ] `pnpm --filter lector-pdf build` termina sin error y el arranque queda ≤ 500 000 bytes.
- [ ] Las funciones diferidas siguen funcionando (E2E de las afectadas en verde).
- [ ] Lint, typecheck y todos los tests pasan.

## Fuera de alcance
- Cambiar el presupuesto o desactivar `check-bundle`.

## Registro
- 2026-10-19 · coordinador: creada al verificar la rama para la PR a `main` (build rojo por presupuesto de arranque).
- 2026-10-19 · coordinador: el usuario subió el presupuesto a 600 000 bytes ([[ADR-0041-presupuesto-arranque-600kb]]). Esta ficha ya no bloquea la PR; queda como optimización.
### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/pdf/save-error.ts` (nuevo; aquí se mueve `toSaveError`), `src/core/pdf/incremental.ts`, `src/core/pdf/page-tree.ts`, `src/core/pdf/new-document.ts`, `src/core/organize/save.ts`, `src/engine/permissions.ts`, `src/state/annotation-actions.ts`, `src/state/save-actions.ts`, `src/state/print-source.ts`, `src/state/doc-ops.ts`.
- Qué he hecho: el escritor incremental (`core/pdf/incremental`) y el catálogo de operaciones (`core/doc-ops/ops`) dejan de importarse de forma estática: se cargan con `import()` al guardar, al leer permisos, al iniciar la sesión de anotaciones y en la primera operación de documento. `toSaveError` se mueve a un módulo hoja para no arrastrar el escritor. `print-source` importa `concatSource` directamente. La API de `inProcessDocOps` no cambia (el cliente espera a que el catálogo esté servido), así que los tests no se tocan.
- Comandos ejecutados y resultado: `pnpm --filter lector-pdf build` → arranque 483 604 bytes en 19 ficheros (máximo 600 000; ≤ 500 000 cumplido). `pnpm lint` limpio. `pnpm typecheck` limpio. `pnpm exec vitest run --coverage --coverage.reportsDirectory=<scratchpad>` (no `pnpm coverage`, porque otro proceso tenía el directorio `coverage/` bloqueado): 3270 pasan y 1 falla por timeout de 5 s en `tests/unit/organize/split.test.ts` («una página mayor que el máximo…», 5484 ms con la máquina cargada); en aislado pasa 21/21. E2E `chromium` de encrypted-save, save-qa, permissions, print, password, signature y forms: 43 pasan (puerto 4391, porque 4173 lo usaba otro proceso).
- Dudas o cosas que no he podido hacer: no he medido cobertura (el directorio `coverage/` estaba bloqueado por otro proceso). El fallo de timeout de `split.test.ts` es de carga de la máquina; conviene volver a lanzarlo en el ciclo del tester. Otros cambios sin commit en `core/doc-ops/ops/index.ts`, `core/errors.ts` y `core/organize/index.ts` son de otros agentes; no los he tocado ni incluido.

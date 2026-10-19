---
tipo: tarea
id: PDF-140
titulo: Devolver el JavaScript de arranque por debajo de 500 KB
app: pdf
estado: pendiente
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

---
tipo: tarea
id: PDF-041
titulo: Rellenar formularios en pantalla
app: pdf
estado: pendiente
depende_de: [PDF-040]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-3, formularios, ui, por-detallar]
---

# PDF-041 · Rellenar formularios en pantalla

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Campos de texto, casillas, botones de opción, listas y combos editables sobre la página, con orden de tabulación del PDF, validación de formato básica y deshacer/rehacer con el mismo `UndoStack`.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] Rellenar todos los campos de `form.pdf` y de un formulario del corpus solo con teclado; Ctrl+Z deshace el último campo; E2E y presupuestos de PDF-022 siguen en verde.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

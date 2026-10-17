---
tipo: tarea
id: PDF-055
titulo: Insertar páginas y combinar PDFs
app: pdf
estado: pendiente
depende_de: [PDF-053]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-5, organizar, por-detallar]
---

# PDF-055 · Insertar páginas y combinar PDFs

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Insertar páginas de otro PDF o en blanco y combinar varios PDFs en uno, conservando marcadores (como subárbol) y anotaciones.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] Combinar `basic-5.pdf` y `outline.pdf` → 35 páginas, índice con las dos ramas.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

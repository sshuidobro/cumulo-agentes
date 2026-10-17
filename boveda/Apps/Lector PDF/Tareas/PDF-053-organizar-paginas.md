---
tipo: tarea
id: PDF-053
titulo: Organizar páginas: girar, borrar y reordenar
app: pdf
estado: pendiente
depende_de: [PDF-052]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-5, organizar, ui, por-detallar]
---

# PDF-053 · Organizar páginas: girar, borrar y reordenar

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Vista de cuadrícula de miniaturas para girar, borrar y reordenar páginas (arrastrar y teclado), con deshacer y guardado.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] Reordenar en `pages-5000.pdf` y guardar; el índice y los enlaces apuntan a las páginas correctas.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

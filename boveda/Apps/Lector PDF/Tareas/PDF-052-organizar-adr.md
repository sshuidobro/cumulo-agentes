---
tipo: tarea
id: PDF-052
titulo: ADR y prueba técnica: reescribir PDFs (organizar páginas y reparar xref)
app: pdf
estado: pendiente
depende_de: [PDF-039]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-5, organizar, decision, por-detallar]
---

# PDF-052 · ADR y prueba técnica: reescribir PDFs (organizar páginas y reparar xref)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Decidir cómo reescribir un PDF completo (reordenar, borrar, insertar, combinar, reparar xref): ampliar el escritor propio con copia de objetos por rangos o usar una librería (pdf-lib o forks, qpdf en WASM) con medidas de tiempo y memoria en 5 000 y 100 000 páginas. Las licencias GPL/AGPL se consultan al usuario.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] ADR con medidas; prototipo que borra la página 2 de `pages-5000.pdf` conservando índice, enlaces y anotaciones.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

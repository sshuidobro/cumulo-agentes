---
tipo: tarea
id: PDF-044
titulo: Imprimir
app: pdf
estado: pendiente
depende_de: [PDF-039]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-3, impresion, por-detallar]
---

# PDF-044 · Imprimir

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Imprimir el documento (todas, rango, página actual), con o sin anotaciones, ajuste a página y orientación automática. Web: render a imágenes en un `iframe` oculto con `@media print`; Tauri: misma vía en el webview. Debe funcionar con documentos de miles de páginas sin agotar la memoria (por lotes).

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] Imprimir un rango de 3 páginas de `pages-5000.pdf` genera exactamente 3 páginas (PDF de impresión en e2e con `page.pdf()` de Playwright); la memoria no supera el presupuesto.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

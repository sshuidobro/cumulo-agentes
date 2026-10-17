---
tipo: tarea
id: PDF-064
titulo: Exportar a imágenes y texto
app: pdf
estado: pendiente
depende_de: [PDF-022]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-6, exportar, por-detallar]
---

# PDF-064 · Exportar a imágenes y texto

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Exportar páginas a PNG/JPEG con resolución elegida y el texto a TXT; exportar a DOCX queda para cuando exista el procesador de textos de la suite.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] Exportar 3 páginas a PNG a 150 ppp produce imágenes del tamaño esperado; TXT con el texto en orden de lectura.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

---
tipo: tarea
id: PDF-061
titulo: OCR de documentos escaneados
app: pdf
estado: pendiente
depende_de: [PDF-052]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-6, ocr, por-detallar]
---

# PDF-061 · OCR de documentos escaneados

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Reconocer texto en páginas escaneadas y añadir una capa de texto invisible para buscar y copiar. Motor local (p. ej. tesseract.js con datos de idioma empaquetados en la app, nunca descargados en tiempo de uso); requiere investigación de motor, licencia y rendimiento.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] Un escaneado de prueba en español con 3 páginas se vuelve buscable; nada sale del equipo (sin peticiones de red en e2e).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

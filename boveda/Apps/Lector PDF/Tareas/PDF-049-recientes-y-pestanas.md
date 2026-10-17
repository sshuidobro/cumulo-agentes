---
tipo: tarea
id: PDF-049
titulo: Documentos recientes y pestañas
app: pdf
estado: pendiente
depende_de: [PDF-022]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-4, ui, por-detallar]
---

# PDF-049 · Documentos recientes y pestañas

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Lista de recientes (Tauri: rutas; web: nombres y huella, sin contenido) y varios documentos abiertos en pestañas, cada uno con su estado de visor, búsqueda y anotaciones.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] Abrir 3 documentos en pestañas, cambiar entre ellas conservando página y zoom; la memoria con 3 PDFs grandes sigue en presupuesto.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

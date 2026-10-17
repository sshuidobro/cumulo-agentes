---
tipo: tarea
id: PDF-040
titulo: ADR y prueba técnica: formularios AcroForm
app: pdf
estado: pendiente
depende_de: [PDF-039]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-3, formularios, decision, por-detallar]
---

# PDF-040 · ADR y prueba técnica: formularios AcroForm

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Decidir cómo mostrar y editar campos AcroForm: capa HTML propia sobre `getFieldObjects()`/`getAnnotations()` de pdf.js frente a `AnnotationLayer` de pdf.js, y cómo convive con `AnnotationMode.ENABLE_STORAGE` del lienzo. Incluye un prototipo con `form.pdf` y un formulario real del corpus, y el ADR.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] ADR escrito con alternativas medidas; prototipo que rellena `nombre` y `acepto` en `form.pdf`; lista de tipos de campo cubiertos (texto, casilla, radio, lista, combo, firma) y de lo que no (XFA, JavaScript de cálculo).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

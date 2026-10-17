# cumulo-agentes · suite ofimática personal

Proyecto de uso personal (no comercial): procesador de texto, lector de PDF, presentaciones y hoja de cálculo que sustituyan de verdad a Word, Adobe Reader, PowerPoint y Excel. Calidad profesional y completa.

## Tecnología (ADR-0001, decidida por el usuario)
TypeScript + React (Vite), empaquetado como escritorio con Tauri 2 y funcionando también en el navegador. Monorepo pnpm: `apps/<app>/`, `packages/`.

## Cómo se trabaja aquí
- Equipo de agentes en `.claude/agents/`: `investigador`, `lider`, `programador`, `revisor`, `tester`. Skills de experto en `.claude/skills/`.
- Para arrancar un objetivo: `/dirigir-equipo <objetivo>`.
- **Toda la documentación va en la bóveda de Obsidian `boveda/`** según la skill `documentar-obsidian`: planes en `boveda/Apps/<App>/Plan.md`, fichas en `boveda/Apps/<App>/Tareas/`, decisiones en `boveda/Decisiones/`, investigación en `boveda/Investigacion/`, bitácora diaria en `boveda/Bitacora/`.
- Flujo de una ficha: pendiente → en-curso → en-revision → en-test → hecha. Rechazo → `cambios-pedidos`; a los 3 rechazos se escala al líder.

## Trabajo continuo (regla del usuario)
**El equipo no se detiene hasta que todas las fichas estén en `hecha` (o `sustituida`).** No se para para informar de progreso, ni para pedir confirmación, ni por decisiones técnicas: esas las toma el líder y se anotan en la bitácora.
- Si una ficha necesita una decisión de producto del usuario, se marca `bloqueada`, se anota la pregunta en la bitácora y **se sigue con todas las demás fichas** que no dependan de ella. Solo al final se le presentan juntas las preguntas pendientes.
- Un fallo (test rojo, error de build, rechazo) no es motivo para parar: se devuelve la ficha al programador o se escala al líder según el flujo.
- La sesión solo termina cuando no queda ninguna ficha accionable y se ha cerrado la iteración (bitácora y Plan actualizados, commit hecho).

## Normas para todos los agentes
- Documentación y textos de la interfaz en español; código e identificadores en inglés.
- Nunca desactivar ni saltar tests para que pasen.
- Dependencias: solo las decididas en un Plan o ADR. Las decide el **líder** (las de desarrollo y herramientas estándar del stack, como ESLint o `@vitest/coverage-v8`, no necesitan permiso del usuario). Al usuario solo se le pregunta por decisiones de producto: qué hace la app, cómo se ve, prioridades, licencias GPL/comerciales o costes.
- Ningún dato del usuario sale del ordenador; nunca subir documentos personales al repositorio.

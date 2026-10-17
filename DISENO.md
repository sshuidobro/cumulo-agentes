# Diseño del equipo de agentes de programación

## 1. Qué hemos mirado y qué tomamos de cada uno

| Proyecto | Idea principal | Qué copiamos |
|---|---|---|
| [MetaGPT](https://github.com/FoundationAgents/MetaGPT) | Simula una empresa: jefe de producto → arquitecto → jefe de proyecto → ingenieros → QA, siguiendo procedimientos fijos (SOP). Los agentes se pasan documentos, no charlas. | Comunicación por **documentos estructurados** (PLAN.md y fichas), no por conversación libre. |
| [ChatDev](https://github.com/OpenBMB/ChatDev) | Cadena de fases (diseño, código, revisión, test) donde cada fase es un diálogo entre dos roles (programador ↔ revisor, programador ↔ tester) con un límite de rondas. | **Bucle programador ↔ revisor ↔ tester con un máximo de rondas** antes de escalar. |
| [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) | Agile con agentes: el arquitecto y el scrum master escriben "story files" muy detallados para que el dev no tenga que decidir nada; luego QA revisa. | **Fichas de tarea autocontenidas** con contexto, pasos y criterios de aceptación. Es lo que permite usar un modelo barato para programar. |
| Subagentes de Claude Code ([wshobson/agents](https://github.com/wshobson/agents), [awesome-claude-agents](https://github.com/rahulvrane/awesome-claude-agents)) | Cada agente es un fichero `.md` con su rol, sus herramientas y su modelo. La sesión principal los lanza. | **Formato de los agentes** y **un modelo distinto por rol** (caro para pensar, barato para picar código). |

Limitación que condiciona el diseño: en Claude Code un subagente no puede lanzar a otros subagentes. Por eso el líder **planifica** y la sesión principal, guiada por la skill `dirigir-equipo`, **coordina** el bucle.

## 2. El equipo

| Agente | Modelo | Puede | No puede | Cuándo trabaja |
|---|---|---|---|---|
| `lider` | Opus (caro, el que mejor razona) | Leer todo, escribir PLAN.md y fichas | Escribir código de producción | Al planificar, al replanificar una tarea atascada y al cerrar |
| `programador` | Haiku (barato y rápido) | Editar código, ejecutar build y tests | Decidir diseño, tocar fuera de su ficha, saltarse tests | Una ficha cada uno; hasta 3 en paralelo |
| `revisor` | Sonnet (intermedio) | Leer, ejecutar tests, escribir en la ficha | Modificar código | Tras cada ronda del programador |
| `tester` | Sonnet (intermedio) | Escribir y ejecutar tests, probar a mano | Modificar código de producción | Tras el visto bueno del revisor |

## 3. Flujo de una tarea

```
            lider (PLAN.md + fichas)
                     │
                     ▼
   pendiente ──► programador ──► en-revision ──► revisor
       ▲                                           │
       │                    CAMBIOS ◄──────────────┤ APROBADO
       │                       │                   ▼
  cambios-pedidos ◄────────────┘               en-test ──► tester
       │                                           │
       │                     FALLA ◄───────────────┤ PASA
       │                                           ▼
       └── a los 3 intentos ──► lider replanifica  hecha
```

## 4. Ficheros

```
equipo-agentes/
├── CLAUDE.md                       normas del proyecto para todos los agentes
├── DISENO.md                       este documento
├── .claude/agents/                 lider.md, programador.md, revisor.md, tester.md
├── .claude/skills/dirigir-equipo/  el bucle de coordinación (/dirigir-equipo <objetivo>)
├── plantillas/tarea.md             formato de ficha
├── PLAN.md                         (lo crea el líder)
└── tareas/T-NNN-*.md               (las crea el líder)
```

Para usar el equipo en el repositorio de las aplicaciones, se copia el contenido de `equipo-agentes/` a la raíz del repositorio y se abre Claude Code allí.

## 5. Por qué así
- **Coste**: el modelo caro escribe poco (planes y fichas); el barato escribe casi todo el código; el intermedio hace de filtro.
- **Calidad**: nada llega a `hecha` sin pasar por dos agentes distintos al que lo escribió, y cada "PASA" del tester lleva su evidencia.
- **Trazabilidad**: cada ficha guarda en su Registro quién hizo qué, qué se rechazó y por qué.

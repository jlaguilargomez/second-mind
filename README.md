# Second Mind

Una aplicación local-first inspirada en los diarios enlazados para registrar trabajo en bloques Markdown, organizarlo mediante contextos y etiquetas, y convertir tareas en recordatorios.

## Demo

[Abrir Second Mind en GitHub Pages](https://jlaguilargomez.github.io/second-mind/)

## Documentación técnica

[Arquitectura y lecciones aprendidas](./TECHNICAL_LESSONS.md)

[Seguridad y privacidad](./SECURITY.md)

## Desarrollo

```bash
npm install
npm run dev
```

## Estructura del workspace

```text
mi-segundo-cerebro/
├── journals/
│   └── 2026-06-21.md
├── notes/
│   └── inicio-del-dia.md
└── contexts/
    └── producto.md
```

Los `@contextos` agrupan personas, equipos, áreas o zonas de trabajo. Las `#etiquetas` actúan como proyectos: reúnen tareas pendientes, tareas completadas y la bitácora relacionada. Los enlaces heredados `[[Producto]]` continúan funcionando como contextos.

Las notas independientes viven en `notes/` y no están vinculadas a una fecha. Pueden contener listas permanentes con tareas marcables, como una rutina de inicio o cierre del día. Su contenido se mantiene aislado de las vistas globales de tareas, agenda, búsqueda y asistente.

Los diarios y las notas independientes pueden bloquearse cuando estén terminados. Un documento bloqueado permanece navegable y exportable, pero no admite cambios de contenido, tareas, fechas, título o borrado desde ninguna vista. El desbloqueo requiere confirmación y el estado se conserva como `locked: true` en el frontmatter Markdown.

Los contextos pueden ser de tipo Proyecto, Persona, Equipo o Área para conservar compatibilidad con notas existentes, aunque el seguimiento de proyectos se hace desde etiquetas. La vista **Seguimiento** reúne personas relacionadas, equipos/áreas y tareas marcadas con `#delegado` o `#esperando`. Mencionar una `@persona` no convierte una tarea propia en seguimiento.

Las tareas admiten prioridad Base, Media o Alta. Base es el estado silencioso por defecto; Media y Alta se guardan como propiedades Markdown portables y se muestran con indicadores discretos.

## Atajos del editor

- `+` y espacio convierte la entrada en tarea; `-` y espacio la convierte en entrada.
- `Tab` crea un subitem y `Shift + Tab` reduce su nivel.
- `Ctrl/Cmd + .` abre las opciones del bloque.
- `Ctrl/Cmd + ;` abre la fecha de una tarea.
- `Ctrl/Cmd + Shift + P` cambia la prioridad de una tarea.
- `Ctrl/Cmd + Shift + Retroceso` elimina el bloque completo. En un bloque vacío también se puede usar simplemente Retroceso.
- `@` busca contextos y `#` busca proyectos/etiquetas mientras se escribe.

Desde un día o una página de contexto se puede copiar la sección completa como Markdown limpio. La copia conserva tareas, subitems, recordatorios y prioridades, pero omite identificadores y timestamps internos.

La vista de tareas admite filtros combinables por estado, contexto, prioridad y etiqueta, además de una acción para restablecer la selección.

La vista de etiquetas presenta cada `#etiqueta` como proyecto con progreso, tareas abiertas, próximas tareas fechadas y bitácora reciente. Abrir una etiqueta muestra su detalle con tareas abiertas, completadas y logs relacionados.

La actividad de cada contexto se presenta cronológicamente, con los diarios más recientes primero y preservando la jerarquía interna de sus bloques.

Las listas de contextos y etiquetas tienen desplazamiento independiente en el lateral, manteniendo siempre accesible la información de almacenamiento y sincronización.

La interfaz móvil utiliza iconos y objetivos táctiles ampliados en la cabecera, navegación inferior, tareas y acciones de bloque.

## Asistente local

La vista **Asistente** consulta tareas y diarios recientes mediante
[Ollama](https://ollama.com/) ejecutado en el mismo ordenador. No usa servicios
externos, no modifica notas y no guarda la conversación.

Configuración inicial:

```bash
ollama pull qwen3:4b
```

Después, abre Ollama y entra en **Asistente** para comprobar la conexión. Si la
aplicación se sirve desde otro origen, autorízalo en `OLLAMA_ORIGINS` antes de
iniciar Ollama.

Durante el desarrollo, Vite reenvía internamente las peticiones de `/assistant-api` al
servicio local para que el asistente también funcione en navegadores con
aislamiento de puertos.

Cada bloque conserva un identificador estable y sus propiedades dentro del propio Markdown:

```md
- [ ] Revisar solución del date-picker @motor #seguimiento
  id:: 5a8319e5-50d7-4c50-8815-0b89ccb389c8
  reminder:: 2026-06-25
```

## Persistencia y sincronización

- IndexedDB es la fuente local y permite trabajar sin conexión.
- Los cambios se guardan también como una cola de operaciones preparada para sincronización.
- `LocalRepository`, `RemoteRepository` y `SyncRepository` separan la aplicación Vue del almacenamiento.
- Markdown continúa siendo el contenido canónico y puede importarse o exportarse como archivos o ZIP.
- La conexión opcional con una carpeta mantiene copias en `journals/`, `notes/` y `contexts/`.

El contrato previsto para el servidor está representado por `RemoteRepository` y utiliza `/v1/notes`, `/v1/sync`, `/v1/reminders` y `/v1/devices`.

## Compatibilidad

La conexión directa con carpetas funciona mejor en navegadores Chromium. En otros navegadores se pueden importar archivos `.md` o `.zip` y exportar el workspace completo. La aplicación se puede instalar como PWA.

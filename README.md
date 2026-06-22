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
└── contexts/
    └── producto.md
```

Los `@contextos` agrupan proyectos o personas y las `#etiquetas` clasifican temas transversales. Los enlaces heredados `[[Producto]]` continúan funcionando como contextos.

Los contextos pueden ser de tipo Proyecto, Persona, Equipo o Área. La vista **Seguimiento** reúne proyectos activos, personas relacionadas y tareas delegadas o pendientes de respuesta sin asumir un cargo concreto.

Las tareas admiten prioridad Base, Media o Alta. Base es el estado silencioso por defecto; Media y Alta se guardan como propiedades Markdown portables y se muestran con indicadores discretos.

Desde un día o una página de contexto se puede copiar la sección completa como Markdown limpio. La copia conserva tareas, subitems, recordatorios y prioridades, pero omite identificadores y timestamps internos.

La vista de tareas admite filtros combinables por estado, contexto, prioridad y etiqueta, además de una acción para restablecer la selección.

La actividad de cada contexto se presenta cronológicamente, con los diarios más recientes primero y preservando la jerarquía interna de sus bloques.

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
- La conexión opcional con una carpeta mantiene copias en `journals/` y `contexts/`.

El contrato previsto para el servidor está representado por `RemoteRepository` y utiliza `/v1/notes`, `/v1/sync`, `/v1/reminders` y `/v1/devices`.

## Compatibilidad

La conexión directa con carpetas funciona mejor en navegadores Chromium. En otros navegadores se pueden importar archivos `.md` o `.zip` y exportar el workspace completo. La aplicación se puede instalar como PWA.

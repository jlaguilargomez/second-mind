# Second Mind: arquitectura y lecciones aprendidas

## 1. Objetivo del proyecto

Second Mind es una aplicación Vue 3 para registrar actividad profesional principalmente por día, relacionarla mediante contextos y etiquetas, gestionar tareas y recordatorios, y conservar todos los datos en un formato Markdown portable.

Las decisiones fundamentales son:

- Markdown es el contenido canónico.
- La experiencia de edición se basa en bloques.
- La aplicación funciona sin conexión.
- El almacenamiento está desacoplado de Vue.
- La arquitectura permite añadir posteriormente servidor, autenticación, base de datos y sincronización entre dispositivos.
- El usuario puede importar o abandonar la aplicación sin perder la legibilidad de sus datos.

## 2. Arquitectura actual

### Interfaz

- Vue 3 con Composition API.
- Vite como servidor de desarrollo y empaquetador.
- Componentes especializados para editor, calendario, recordatorios y texto enriquecido.
- Diseño responsive con navegación lateral en escritorio y navegación inferior en móvil.
- PWA generada mediante `vite-plugin-pwa`.

### Dominio

Una nota representa un diario o un contexto:

```js
{
  id,
  kind: 'journal' | 'context',
  filename,
  date,
  title,
  emoji,
  color,
  blocks,
  version,
  createdAt,
  updatedAt,
  deletedAt,
  markdown
}
```

Cada bloque contiene:

```js
{
  id,
  type: 'heading' | 'log' | 'text' | 'task',
  content,
  checked,
  reminder,
  createdAt,
  updatedAt,
  properties
}
```

Los identificadores estables son importantes porque permiten referenciar, editar y sincronizar bloques sin depender de su posición en el documento.

### Persistencia

La capa de repositorios evita que la interfaz dependa directamente de IndexedDB o de una futura API:

- `NotesRepository`: contrato base.
- `LocalRepository`: persistencia IndexedDB y cola de cambios offline.
- `RemoteRepository`: contrato HTTP previsto.
- `SyncRepository`: envío de operaciones y reconocimiento de cambios aceptados.

El almacenamiento opcional en una carpeta del sistema continúa funcionando como copia Markdown mediante File System Access API.

## 3. Markdown como formato canónico

Una tarea con contexto, etiqueta y recordatorio se guarda así:

```md
- [ ] Revisar solución del date-picker @motor #seguimiento
  id:: 5a8319e5-50d7-4c50-8815-0b89ccb389c8
  reminder:: 2026-06-25T07:00:00.000Z
  created-at:: 2026-06-21T18:00:00.000Z
  updated-at:: 2026-06-21T18:30:00.000Z
```

Una página de contexto:

```md
---
id: 8aef16f7-9caf-49cc-ae82-a86b244ce350
type: context
name: motor
emoji: ◆
color: violet
version: 2
---

# motor
  id:: 659e37e9-a967-476d-bfdd-f0f186ca896d
```

La interfaz oculta las propiedades técnicas, pero el parser y el serializador las conservan.

### Semántica

- `@motor`: contexto navegable, normalmente proyecto, persona o área.
- `#seguimiento`: clasificación transversal.
- `[[Motor]]`: formato heredado compatible con importaciones anteriores.
- `- [ ]`: tarea pendiente.
- `- [x]`: tarea completada.
- `reminder::`: fecha y hora del recordatorio en ISO 8601.

### Lección

Usar Markdown como formato canónico no significa que la aplicación deba editar texto sin estructura. El patrón útil es:

```text
Markdown ↔ parser/serializador ↔ modelo de dominio ↔ interfaz por bloques
```

Esto proporciona portabilidad sin renunciar a una experiencia rica.

## 4. Estrategia offline-first

IndexedDB almacena las notas y una cola de operaciones pendientes. Cada escritura local genera una operación similar a:

```js
{
  operationId,
  entityId,
  type: 'upsert',
  version,
  payload,
  createdAt
}
```

La aplicación no necesita esperar al servidor para editar. Cuando exista conectividad y backend, `SyncRepository` enviará la cola a `/v1/sync`.

### Control de concurrencia

Cada nota tiene un número de versión. Al guardar se proporciona la versión esperada:

```text
versión local esperada == versión almacenada
```

Si no coincide, se produce un `VersionConflictError`. La política elegida evita sobrescrituras silenciosas: se conservan ambas versiones para una resolución posterior.

### Lección

Offline-first debe diseñarse antes de añadir el servidor. Añadir una caché después de construir una aplicación estrictamente online suele producir una segunda arquitectura accidental.

## 5. Contrato previsto para el servidor

La aplicación deja preparado este contrato:

```text
GET    /v1/notes?cursor=
GET    /v1/notes/:id
PUT    /v1/notes/:id
DELETE /v1/notes/:id
POST   /v1/sync
GET    /v1/reminders
POST   /v1/devices
```

La base de datos debería guardar:

- Markdown completo de cada nota.
- ID, tipo, versión y timestamps.
- Índices derivados de bloques.
- Contextos y etiquetas derivados.
- Estado y fecha de tareas.
- Recordatorios.
- Eliminaciones lógicas.
- Operaciones o revisiones necesarias para sincronización.

Los índices son proyecciones reconstruibles. El Markdown sigue siendo la fuente del contenido.

## 6. Recordatorios y zonas horarias

El formulario utiliza `datetime-local`, pero se convierte a ISO antes de persistir:

```js
new Date(localValue).toISOString()
```

Al mostrarlo se transforma nuevamente a la zona local del dispositivo.

Esto evita guardar fechas ambiguas, aunque exige definir cuidadosamente el comportamiento cuando el usuario cambia de zona horaria.

La PWA puede generar notificaciones locales mientras está ejecutándose. Para garantizar notificaciones con la aplicación cerrada será necesario:

- Service worker con gestión de eventos `push`.
- Suscripción Web Push por dispositivo.
- Persistencia de la suscripción mediante `/v1/devices`.
- Proceso en servidor que programe y envíe los avisos.

### Lección

Una notificación del navegador y un recordatorio fiable no son equivalentes. La fiabilidad con la aplicación cerrada requiere coordinación desde servidor.

## 7. Migración desde la primera versión

La primera versión almacenaba un array de notas en `localStorage`. La v2:

1. Inicializa IndexedDB.
2. Comprueba si ya existen notas.
3. Si está vacío, busca los datos heredados.
4. Parsea y normaliza cada nota.
5. Asigna IDs a notas y bloques.
6. Guarda el resultado en IndexedDB.
7. Elimina la clave heredada después de migrar.

También se mantiene compatibilidad con `[[wikilinks]]`.

### Lección

Las migraciones locales merecen el mismo cuidado que una migración de base de datos. Deben ser idempotentes, no destructivas hasta confirmar la escritura y compatibles con datos parciales.

## 8. Importación y exportación

La aplicación admite:

- Importación de archivos `.md`.
- Importación de archivos ZIP con Markdown.
- Exportación completa a ZIP.
- Copia opcional en carpetas `journals/` y `contexts/`.

El ZIP incluye además un pequeño manifiesto `second-mind.json`, pero las notas no dependen de él para ser legibles.

### Lección

Una estrategia de salida explícita aumenta la confianza del usuario. La portabilidad no es una función auxiliar: es una propiedad arquitectónica.

## 9. PWA y despliegue

La PWA incluye:

- Manifest.
- Iconos de 192 y 512 píxeles.
- Service worker generado.
- Precaché de los recursos de aplicación.
- Caché de fuentes.
- Navegación con fallback a `index.html`.

Vite usa `base: './'` para que los recursos funcionen dentro de la ruta de proyecto de GitHub Pages.

GitHub Actions:

1. Instala dependencias con `npm ci`.
2. Ejecuta pruebas.
3. Genera el build.
4. Configura Pages.
5. Publica `dist`.

### Lección

El despliegue no termina con un `push`. El cierre correcto es:

1. Comprobar la Action.
2. Confirmar que concluye con éxito.
3. Solicitar la URL publicada.
4. Verificar HTML, manifest y recursos principales.

## 10. Pruebas y validación

Las pruebas unitarias cubren:

- Separación entre contextos y etiquetas.
- Unicode.
- Wikilinks heredados.
- Títulos y slugs.
- Plantilla diaria.
- IDs de bloques.
- Parseo y serialización de tareas.
- Conservación de recordatorios.
- Clasificación temporal.

La validación de navegador cubrió:

- Conversión de un bloque en tarea.
- Edición de contextos y etiquetas.
- Creación de recordatorio.
- Aparición en calendario y agenda.
- Página de contexto y actividad relacionada.
- Persistencia después de recargar.
- Diseño responsive.
- Navegación móvil.

### Lección

Las pruebas unitarias validan la transformación de datos; la automatización del navegador valida la cohesión del producto. Ambas son necesarias para una aplicación local-first.

## 11. Problemas encontrados

### Mezclar contextos y etiquetas

La primera versión trataba wikilinks y `#etiquetas` como una única colección. Al introducir `@contextos`, las pruebas antiguas fallaron y dejaron visible la incompatibilidad semántica.

Solución: funciones separadas `extractContexts()` y `extractTags()`.

### Acceso a globales desde plantillas Vue

Usar `navigator.onLine` directamente en la plantilla produjo un error porque no era una propiedad expuesta por el componente.

Solución: reflejar ese valor mediante un `ref` reactivo y actualizarlo con eventos `online` y `offline`.

### Fechas de `datetime-local`

Recortar una fecha ISO no conserva correctamente la hora local en todas las zonas.

Solución: aplicar el offset local al preparar el valor del formulario y convertir a ISO al guardar.

### Estado derivado y Markdown desactualizado

Durante el debounce, el modelo de bloques puede estar más actualizado que la propiedad `markdown`.

Solución: serializar el estado actual en el momento de exportar, en lugar de confiar en una cadena previamente calculada.

## 12. Deuda técnica consciente

- El editor por bloques es propio y sencillo; no cubre todavía selección múltiple, drag and drop, undo global ni pegado estructurado.
- La resolución visual de conflictos está representada, pero no implementada completamente.
- Las operaciones offline no se compactan.
- No existe todavía autenticación ni separación por usuario/workspace.
- Las notificaciones fiables con la PWA cerrada necesitan backend.
- Los índices derivados se calculan en memoria; con grandes volúmenes deberán trasladarse a índices persistentes o consultas de servidor.
- El parser Markdown soporta deliberadamente un subconjunto orientado al dominio, no CommonMark completo.

## 13. Próximos pasos recomendados

1. Definir esquema PostgreSQL para notas, bloques indexados, dispositivos y operaciones.
2. Implementar autenticación y workspaces.
3. Implementar `/v1/sync` con cursor incremental e idempotencia.
4. Añadir resolución de conflictos por nota.
5. Incorporar Web Push.
6. Añadir pruebas de repositorio con IndexedDB simulada.
7. Añadir pruebas end-to-end persistentes.
8. Mejorar accesibilidad y navegación completa por teclado.
9. Implementar historial o revisiones.
10. Medir rendimiento con miles de notas antes de diseñar optimizaciones.

## 14. Principios reutilizables

- Diseña primero el formato de salida: evita el bloqueo de proveedor.
- Separa dominio, persistencia e interfaz antes de introducir red.
- Trata cada edición offline como una operación sincronizable.
- Usa identificadores estables, no posiciones.
- Los metadatos derivados deben poder reconstruirse desde el contenido canónico.
- Guarda fechas absolutas; muestra fechas locales.
- No confundas una PWA instalable con sincronización o push fiables.
- Una migración de almacenamiento local también es una migración de producción.
- Valida siempre el despliegue real, no solamente el build local.

## 15. Revisión para uso corporativo

La aplicación se endureció para reducir exposición accidental:

- Se eliminaron Google Fonts y todas las solicitudes de recursos de terceros.
- Se añadió una Content Security Policy restrictiva.
- Se configuró `no-referrer`.
- Las actualizaciones de la PWA requieren confirmación del usuario.
- Las GitHub Actions oficiales están fijadas por SHA.
- CI ejecuta `npm audit` sobre dependencias de producción.
- La interfaz informa de que los datos permanecen en el dispositivo salvo exportación o carpeta conectada.

La organización del trabajo también se hizo independiente del rol. En lugar de un “panel de Tech Lead”, la vista **Seguimiento** agrupa:

- Proyectos, equipos y áreas.
- Personas relacionadas.
- Tareas delegadas o esperando respuesta.
- Actividad y compromisos abiertos.

La lección general es que el modelo debe representar responsabilidades y relaciones, no el cargo concreto del usuario. Esto permite reutilizar la misma herramienta para coordinación técnica, gestión de producto, consultoría, investigación o trabajo individual.

## 16. Lectura enriquecida y edición Markdown

Mostrar simultáneamente el texto `@contexto` dentro de un `textarea` y un chip adicional debajo perjudicaba la legibilidad y duplicaba información.

La solución utiliza dos estados visuales para el mismo bloque:

- En reposo, el contenido se tokeniza y los contextos se presentan como enlaces inline; las etiquetas se muestran con énfasis tipográfico.
- Al pulsar el bloque, aparece el `textarea` con el Markdown original.
- Al perder el foco, vuelve la presentación enriquecida.

El Markdown almacenado no cambia. La transformación afecta únicamente a la presentación:

```text
Markdown canónico → tokens de texto/contexto/etiqueta → representación inline
```

Esta estrategia es más sencilla y segura que un `contenteditable` completo: evita reconstruir posiciones del cursor sobre nodos enriquecidos y mantiene intacto el parser existente.

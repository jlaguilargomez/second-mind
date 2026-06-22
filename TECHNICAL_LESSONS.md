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
  priority: 'base' | 'medium' | 'high',
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
  reminder:: 2026-06-25
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
- `reminder::`: día del recordatorio en formato `YYYY-MM-DD`.

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

## 6. Recordatorios de día completo

Los recordatorios representan compromisos para un día, no alarmas con precisión horaria. El formulario utiliza un campo `date` y persiste directamente:

```md
reminder:: 2026-06-25
```

Comparar cadenas `YYYY-MM-DD` permite clasificar vencido, hoy y próximo sin conversiones horarias ni desplazamientos de zona.

Los recordatorios antiguos con timestamp se normalizan a la fecha local al cargar la nota. La siguiente serialización guarda únicamente el día.

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

### Complejidad innecesaria en recordatorios

Guardar hora y zona para compromisos que solo necesitaban un día introducía fricción de entrada y errores potenciales de conversión.

Solución: usar fechas de día completo y mantener compatibilidad de lectura con timestamps antiguos.

### Estado derivado y Markdown desactualizado

Durante el debounce, el modelo de bloques puede estar más actualizado que la propiedad `markdown`.

Solución: serializar el estado actual en el momento de exportar, en lugar de confiar en una cadena previamente calculada.

### Acciones ocultas en editores por bloques

Ocultar el selector de tipo hasta que el puntero pasa sobre una fila ahorra espacio, pero reduce mucho la descubribilidad y deja a los dispositivos táctiles sin una ruta clara.

Solución: mostrar una barra contextual al editar con opciones explícitas para entrada, tarea y título. La misma barra reúne las acciones relacionadas con el bloque y se adapta a una cuadrícula táctil en móvil. Los párrafos Markdown importados siguen siendo compatibles, pero no ocupan una decisión principal durante la captura.

Para mantener la escritura fluida, `Intro` crea un bloque inmediatamente después, conserva el tipo salvo después de un título y mueve el foco al nuevo bloque. Un botón persistente al final del diario ofrece la alternativa visible para quien todavía no conoce el atajo.

### Auditoría de usabilidad sobre flujos reales

Una revisión visual aislada no detectó varias fricciones que sí aparecieron al completar recorridos con teclado y en viewport móvil:

- `Intro` debe dividir el contenido en la posición del cursor, no limitarse a crear un bloque vacío.
- El autocompletado de `@contextos` y `#etiquetas` debe admitir flechas, `Intro` y tabulador.
- Un icono de menú no debe abrir un calendario; el nombre accesible y el símbolo tienen que describir la acción real.
- La búsqueda móvil debe ser de primer nivel y permitir abrir directamente contextos, no solo bloques que los mencionan.
- Los resúmenes deben contar entradas con contenido y respetar singular y plural.

La lección general es probar la aplicación como una secuencia de intención, no como una colección de pantallas. Cada control debe conservar el flujo mental del usuario: capturar, clasificar, recuperar y continuar escribiendo.

### Carreras entre `blur` y foco programático

Al pulsar `Intro`, el nuevo bloque recibía foco correctamente, pero el `blur` diferido del bloque anterior lo eliminaba unos milisegundos después. El fallo parecía intermitente porque dependía del orden de renderizado y eventos.

La limpieza diferida solo debe actuar si el bloque que originó el `blur` continúa siendo el bloque activo:

```js
if (focusedBlockId.value === blockId) focusedBlockId.value = null
```

La misma función centralizada de foco debe utilizarse al crear y al eliminar bloques, evitando llamadas directas a `element.focus()` que no actualicen el estado reactivo.

### Foco accesible como parte del sistema visual

Dejar el foco a los estilos nativos produce resultados distintos por navegador; en Safari, por ejemplo, un botón circular puede recibir un anillo azul que no encaja con la interfaz.

No debe solucionarse ocultando siempre el foco. La aplicación define un estilo común con `:focus-visible`, que aparece en navegación por teclado, y utiliza una variante de doble anillo para controles circulares como las tareas. Los campos conservan además un cambio de borde y halo suave.

Esto mantiene la orientación del usuario de teclado sin introducir ruido visual después de interacciones ordinarias con ratón o pantalla táctil.

### Importar jerarquía semántica desde Reflect

Los Markdown exportados por Reflect pueden utilizar encabezados como:

```md
## **🏎️** @motor
- Preparar el nuevo swagger
- Revisar los mapeos
```

Los asteriscos son énfasis decorativo, no parte del nombre visible. Durante la normalización se eliminan únicamente del contenido de los encabezados.

El contexto de una sección se deriva por estructura: los bloques bajo `@motor` heredan ese contexto hasta encontrar otro encabezado del mismo nivel o superior. Los encabezados anidados acumulan contextos de sus padres.

La herencia se mantiene como estado derivado del orden de bloques; no se inserta `@motor` repetidamente en cada texto ni se altera innecesariamente el Markdown del usuario. Los índices de contexto consumen `block.contexts`, mientras que la interfaz sigue mostrando el contenido original una sola vez.

### Subitems portables mediante indentación Markdown

La jerarquía entre elementos se guarda en el propio Markdown:

```md
- Elemento principal
  - Subitem
    - [ ] Tarea anidada
```

Cada dos espacios representan un nivel. `Tab` aumenta el nivel y `Shift + Tab` lo reduce; `Intro` conserva el nivel actual. Para evitar árboles inválidos, un bloque solo puede situarse como máximo un nivel por debajo del elemento anterior y se limita la profundidad a seis niveles.

En una entrada vacía, Retroceso reduce primero el nivel antes de eliminar el bloque. Esta interacción permite corregir rápidamente una tabulación accidental y coincide con el comportamiento esperado en editores de listas.

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

## 17. Sistema tipográfico local y responsive

La primera escala visual utilizaba Georgia para casi todo el contenido editorial y tamaños muy pequeños en navegación, calendario y metadatos. El resultado tenía personalidad, pero presentaba demasiado contraste entre un título dominante y controles difíciles de leer.

La revisión tipográfica aplica:

- Inter Variable para interfaz, navegación, controles y metadatos.
- Source Serif 4 Variable para títulos y contenido de notas.
- Tamaño de lectura de 19 px en escritorio y 18 px en móvil.
- Interlineado cercano a `1.55` para bloques.
- Escala mínima de 10–11 px para metadatos secundarios.
- Título responsive con límite superior para no dominar pantallas grandes.
- Paneles laterales ligeramente más anchos para evitar texto comprimido.

Solo se empaquetan los archivos latinos necesarios. Las fuentes se sirven desde el mismo origen y siguen cumpliendo la política CSP sin conexiones externas.

La lección es que la accesibilidad tipográfica debe evaluarse como sistema: familia, peso, contraste, ancho de columna, interlineado y jerarquía. Aumentar todos los tamaños por igual suele empeorar el equilibrio.

## 18. Una sangría también es una relación de dominio

Guardar `indent` era suficiente para reconstruir visualmente una lista, pero no para proyectarla en vistas derivadas. Un contexto encontraba el bloque padre por su `@mención`, aunque ignoraba a los hijos que dependían de él.

La normalización calcula ahora `parentId` y `ancestorIds` a partir del orden y la profundidad de los bloques. Los subitems heredan los contextos del padre y las páginas de contexto incluyen también la cadena de ancestros cuando la mención aparece solo en un hijo. No se duplica contenido: diario y contexto siguen apuntando al mismo `id` de bloque.

La lección general es que una jerarquía visual que afecta a búsqueda, filtros o navegación debe representarse como relación de dominio derivada, aunque su formato canónico continúe siendo una simple indentación Markdown.

## 19. Prioridad lean y reducción de tipos visibles

La diferencia entre una entrada con viñeta y un párrafo libre era técnicamente correcta, pero no aportaba suficiente valor durante la captura diaria. El editor presenta ahora solo tres decisiones: **Entrada**, **Tarea** y **Título**. El tipo interno `text` se conserva para poder importar y exportar párrafos Markdown existentes sin pérdida, aunque ya no se ofrece para crear bloques nuevos.

Las tareas incorporan una prioridad de tres estados:

- `base`: valor predeterminado, sin distintivo visual ni propiedad Markdown.
- `medium`: indicador discreto y `priority:: medium`.
- `high`: indicador reforzado y `priority:: high`.

Un único control recorre los tres estados. Así se evita añadir un desplegable, un diálogo o un campo obligatorio a cada tarea. En la vista global, las tareas se ordenan primero por prioridad y después por fecha, manteniendo los filtros existentes.

La lección es que una clasificación aporta valor cuando su coste de captura es casi nulo. Los valores predeterminados deben permanecer silenciosos y el formato persistido debe registrar únicamente la información que se aparta de ese valor.

## 20. Markdown canónico frente a Markdown para compartir

El Markdown de persistencia contiene información imprescindible para sincronización y edición, como `id::`, `created-at::` y `updated-at::`. Copiar ese mismo documento para pegarlo en otra herramienta expondría ruido técnico y dificultaría su lectura.

La aplicación mantiene ahora dos serializaciones con objetivos distintos:

- La serialización canónica conserva todos los metadatos y permite reconstruir el estado.
- La serialización para compartir conserva contenido, tareas, sangría, recordatorios y prioridades, pero elimina identificadores y timestamps internos.

Los contextos reúnen entradas procedentes de distintos diarios. Su copia añade encabezados por fecha de origen para que el contenido no pierda dimensión temporal al salir de Second Mind.

El botón utiliza la API moderna del portapapeles y conserva una alternativa local para navegadores compatibles que no la expongan. La confirmación visual es temporal y accesible, evitando modales o pasos adicionales.

La lección es que “portable” no siempre significa “adecuado para personas”. Conviene separar una representación fiel para almacenamiento de otra concisa para interoperabilidad cotidiana.

## 21. Filtros combinables como estado explícito

La vista de tareas tenía filtros de estado y contexto, mientras que las etiquetas dependían de haber navegado previamente desde la barra lateral. Esa diferencia hacía difícil saber qué criterios estaban activos y no permitía seleccionar una etiqueta directamente desde la propia vista.

Cada dimensión se representa ahora mediante estado independiente:

- Estado de la tarea.
- Contexto relacionado.
- Prioridad.
- Etiqueta.

El resultado es la intersección de todos los criterios activos. Los filtros no alteran los datos ni crean consultas persistentes; son una proyección local sobre el índice de tareas. Una acción única restablece el estado inicial y el contador comunica inmediatamente el tamaño del resultado.

En móvil, los desplegables pasan de tres columnas a una sola para mantener objetivos táctiles amplios y evitar truncar nombres de contextos.

La lección es que los filtros combinables deben ser visibles, simétricos y reversibles. Si un criterio solo puede activarse desde otra pantalla, se convierte en estado oculto y aumenta la carga cognitiva.

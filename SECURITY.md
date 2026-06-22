# Seguridad y privacidad

Second Mind está diseñado para trabajar localmente con información profesional, pero debe desplegarse y administrarse de acuerdo con las políticas de cada organización.

## Modelo actual

- Las notas se almacenan en IndexedDB dentro del perfil del navegador.
- No existe telemetría, analítica ni envío automático de contenido.
- La aplicación no carga fuentes, scripts ni recursos desde terceros.
- La conexión a una carpeta local requiere una acción explícita del usuario.
- La exportación y las notificaciones requieren acciones explícitas.
- `RemoteRepository` es solamente un contrato de integración: no se instancia ni transmite información.
- La PWA solicita confirmación antes de activar una nueva versión.

## Límites de seguridad

El almacenamiento local no equivale a cifrado:

- Un usuario o proceso con acceso al perfil del navegador puede acceder a IndexedDB.
- Un equipo corporativo comprometido puede exponer los datos locales.
- Las copias Markdown y ZIP son texto legible.
- GitHub Pages distribuye código desde un origen público. Una futura versión publicada en el mismo origen podrá ejecutar migraciones y leer los datos de ese origen después de que el usuario la abra.
- Las notificaciones pueden mostrar contenido sensible en la pantalla bloqueada.

No se deben almacenar secretos, contraseñas, tokens, claves privadas, datos médicos, información regulada ni datos personales innecesarios.

## Recomendaciones para uso corporativo

1. Validar el uso con las políticas de seguridad, privacidad y retención de la organización.
2. Usar un perfil de navegador corporativo protegido y cifrado a nivel de disco.
3. Evitar datos personales no necesarios; usar referencias mínimas.
4. Desactivar notificaciones cuando su contenido pueda ser sensible.
5. Guardar exportaciones únicamente en ubicaciones corporativas autorizadas.
6. Preferir una distribución interna o un dominio controlado por la organización antes de introducir información altamente sensible.
7. Revisar dependencias y el workflow antes de cada release.

## Controles implementados

- Content Security Policy restrictiva.
- `Referrer-Policy: no-referrer`.
- Recursos locales y ausencia de llamadas externas en la aplicación activa.
- Actions oficiales fijadas por SHA.
- Permisos mínimos en GitHub Actions.
- `npm audit` de dependencias de producción durante CI.
- IndexedDB y cola offline desacoplados del futuro cliente remoto.
- Actualizaciones PWA consentidas.
- Exportación deliberada y visible.

## Integración futura con servidor

La sincronización deberá ser opcional y desactivada por defecto hasta que exista configuración explícita.

Requisitos mínimos:

- HTTPS obligatorio.
- Autenticación corporativa mediante OIDC/OAuth.
- Cifrado en tránsito y en reposo.
- Separación estricta por usuario y workspace.
- Logs de auditoría sin contenido de notas.
- Retención y borrado configurables.
- Tokens de corta duración.
- Control de acceso en cada operación.
- Validación de tamaño, tipo y estructura del Markdown.
- Resolución de conflictos sin sobrescrituras silenciosas.

## Reporte de vulnerabilidades

No publiques contenido profesional, capturas o datos reales en una incidencia pública. Comunica los problemas de seguridad directamente al propietario del repositorio.


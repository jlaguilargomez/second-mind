# Second Mind

Una aplicación local-first inspirada en Reflect y Logseq para mantener un diario de trabajo en Markdown y conectar notas mediante contextos.

## Demo

[Abrir Second Mind en GitHub Pages](https://jlaguilargomez.github.io/second-mind/)

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

Los enlaces `[[Producto]]` y las etiquetas `#producto` se detectan como contextos. La aplicación funciona en `localStorage` hasta que se conecta una carpeta usando la File System Access API.

## Compatibilidad

La conexión directa con carpetas funciona mejor en navegadores Chromium. En otros navegadores se pueden importar archivos `.md` y descargar la nota activa.

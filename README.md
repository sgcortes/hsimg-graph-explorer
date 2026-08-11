# HSIMG Graph Explorer

Aplicación web para cargar, visualizar y analizar el grafo 3D generado por el
conversor IFC2GRAPH.

## Formatos admitidos

- **GeoPackage (`.gpkg`) — recomendado.** Lee las tablas `graph_nodes`,
  `graph_edges` y `spaces`. Permite combinar el grafo con niveles y contornos
  de `IfcSpace` en la vista 2D.
- **JSON o GeoJSON (`.json`, `.geojson`).** Admite la estructura node-link de
  NetworkX (`nodes` y `edges` o `links`). Es más fácil de compartir, pero el
  mapa por plantas solo tendrá contexto arquitectónico si el fichero incluye
  también geometrías de espacios.

La versión actual del exportador no guarda entidades `IfcWall` en el
GeoPackage. Por eso la capa arquitectónica 2D representa los contornos de
`IfcSpace`; cuando el script exporte muros, el cargador podrá ampliarse con esa
tabla.

## Funciones

- carga local del fichero, sin enviarlo a un servidor;
- vista 3D con rotación, desplazamiento, zoom, selección y restablecimiento;
- controles independientes para nodos, conexiones y contexto espacial;
- codificación diferenciada de nodos finalistas, de movilidad, internos y de
  acceso;
- plano 2D sincronizado con selector de planta;
- visor contextual del nodo seleccionado: entorno inmediato para finalistas y
  subgrafo interno para nodos de movilidad;
- panel común de metadatos y estadísticas básicas del grafo.

## Ejecución local

Requiere Node.js 22.13 o posterior y pnpm.

```bash
pnpm install
pnpm dev
```

La dirección local se muestra en la consola, normalmente
`http://localhost:3000`.

## Validación de producción

```bash
pnpm exec tsc -p tsconfig.app.json --noEmit
pnpm build
```

Todo el procesamiento del GeoPackage se realiza en el navegador mediante
SQLite/WebAssembly. El fichero `public/sql-wasm.wasm` debe conservarse al
desplegar la aplicación.

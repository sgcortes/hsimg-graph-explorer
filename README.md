
# HSIMG Graph Explorer

Public application: https://sgcortes.github.io/hsimg-graph-explorer/

AplicaciÃ³n web para cargar, visualizar y analizar el grafo 3D generado por el
conversor IFC2GRAPH.

## Formatos admitidos

- **GeoPackage (`.gpkg`) â€” recomendado.** Lee las tablas `graph_nodes`,
  `graph_edges` y `spaces`. Permite combinar el grafo con niveles y contornos
  de `IfcSpace` en la vista 2D.
- **JSON o GeoJSON (`.json`, `.geojson`).** Admite la estructura node-link de
  NetworkX (`nodes` y `edges` o `links`). Es mÃ¡s fÃ¡cil de compartir, pero el
  mapa por plantas solo tendrÃ¡ contexto arquitectÃ³nico si el fichero incluye
  tambiÃ©n geometrÃ­as de espacios.

La versiÃ³n actual del exportador no guarda entidades `IfcWall` en el
GeoPackage. Por eso la capa arquitectÃ³nica 2D representa los contornos de
`IfcSpace`; cuando el script exporte muros, el cargador podrÃ¡ ampliarse con esa
tabla.

## Funciones

- carga local del fichero, sin enviarlo a un servidor;
- vista 3D con rotaciÃ³n, desplazamiento, zoom, selecciÃ³n y restablecimiento;
- controles independientes para nodos, conexiones y contexto espacial;
- codificaciÃ³n diferenciada de nodos finalistas, de movilidad, internos y de
  acceso;
- plano 2D sincronizado con selector de planta;
- visor contextual del nodo seleccionado: entorno inmediato para finalistas y
  subgrafo interno para nodos de movilidad;
- panel comÃºn de metadatos y estadÃ­sticas bÃ¡sicas del grafo.

## EjecuciÃ³n local

Requiere Node.js 22.13 o posterior y pnpm.

```bash
pnpm install
pnpm dev
```

La direcciÃ³n local se muestra en la consola, normalmente
`http://localhost:3000`.

## ValidaciÃ³n de producciÃ³n

```bash
pnpm exec tsc -p tsconfig.app.json --noEmit
pnpm build
```

Todo el procesamiento del GeoPackage se realiza en el navegador mediante
SQLite/WebAssembly. El fichero `public/sql-wasm.wasm` debe conservarse al
desplegar la aplicaciÃ³n.


# HSIMG Graph Explorer

## Modelo incluido

La carga inicial usa `EPM_IFC_v13_HSIMG_v14.gpkg`, generado a partir de
`13_EPM_IFC4_SpaceBoundary (2).ifc` con HSIMG V14. La revisión del modelo IFC
(v13) y la versión del generador (V14) son independientes.

V14 elimina recorridos horizontales que no participan en rutas mínimas entre
accesos, conserva las rutas de los perfiles general y de silla de ruedas y
representa los puntos intermedios como vértices de las polilíneas. Las curvas
alrededor de obstáculos se mantienen. La tabla `horizontal_cleanup_v14`
conserva la auditoría; `public/graph-manifest.json` identifica los archivos
mediante SHA-256 y sus conteos.

El informe no certifica que el edificio carezca de incidencias. El grafo
reducido está orientado a rutas entre accesos; para estudiar redundancia se
necesita la exportación del generador con `--keep-all-horizontal-alternatives`.

Publicación reproducible: pnpm 11.25.0, `pnpm install --frozen-lockfile`,
`pnpm test:graph`, `pnpm exec tsc -p tsconfig.app.json --noEmit` y
`pnpm build:github`. El despliegue de Pages verifica el GeoPackage y utiliza
la misma versión de SQL.js y de su archivo WebAssembly.

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

# Validación de conectividad · versión 1.0

El análisis se realiza en el navegador. No modifica el GeoPackage ni el IFC.
La pestaña tiene una vista independiente del explorador. Al cambiar entre
pestañas se conservan sus selecciones y controles. Al cargar otro modelo se
reinicia el análisis y las referencias se separan por SHA-256 del archivo.

## Reglas

| Comprobación | Unidad y criterio |
| --- | --- |
| Comunicación de espacios | Un caso por espacio inventariado. Sus representantes navegables tienen una conexión con un acceso u otro espacio. Los padres semánticos no sustituyen al subgrafo horizontal. Los IfcSpace usados para derivar ascensores se asocian a sus paradas mediante `HSIMG.SourceSpaceIdsByStorey`. |
| Puertas | Un caso por puerta IFC inventariada. Cada lado asociado alcanza el interior del espacio sin rodear por otra puerta. Se esperan dos lados en una interior y al menos uno en una exterior. Una asociación IFC incompleta genera una incidencia para revisar. |
| Salida vertical a planta | Un caso por terminal/parada y planta declarada como servida. Se busca un espacio de esa misma planta, excluyendo las aristas `vertical_path` y el hueco propio del ascensor. Una parada ausente también se señala. No se exige salida desde descansillos intermedios ni en todas las plantas atravesadas geométricamente. |
| Continuidad vertical | Un caso por elemento peatonal. Los nodos internos deben estar unidos por sus propios tramos y descansillos. Las rampas exclusivamente vehiculares se excluyen. |
| Extremos internos | Un caso por extremo/cruce de eje horizontal sin rol protegido de acceso. Grado topológico cero o uno genera una candidatura a revisión, que puede corresponder a un fondo de pasillo legítimo. |
| Integridad | Un caso por arco. Extremos existentes y distintos, coordenadas finitas y longitudes disponibles no negativas. |
| Duplicación exacta | Un caso por arco. Se señala la repetición posterior de los mismos extremos ordenados, tipo, modo y polilínea. Los arcos recíprocos y los recorridos geométricamente distintos se conservan. |
| Alcanzabilidad exterior | Un caso por pareja puerta exterior–espacio y perfil. Se respeta el sentido de los arcos y los permisos de nodos y conexiones. Basta alcanzar algún representante del espacio; no demuestra cobertura de toda su superficie. |

Las comprobaciones topológicas locales no imponen un perfil. Una puerta cerrada
puede estar conectada correctamente y, a la vez, impedir el acceso exterior del
perfil elegido. La búsqueda exterior separa rutas confirmadas, rutas posibles
solo al aceptar datos desconocidos y ausencia de ruta. El conjunto de puertas
incluye las marcadas exteriores en el IFC aunque el generador no las haya
declarado elegibles como entradas: evita ocultar errores de asociación.

La coincidencia de planta se determina por el identificador de planta y el
tipo de conexión. No se impone una tolerancia arbitraria de cota: los ejes
extraídos de peldaños pueden terminar antes del pavimento acabado. La calidad
de esa asignación espacial necesita un contraste geométrico independiente.

## Referencias y métricas

Positivo significa **incidencia de la regla**, no “espacio accesible”. Para
alcanzabilidad, el positivo es un espacio sin ruta desde ese origen y perfil.

| Predicción | Referencia | Clasificación |
| --- | --- | --- |
| Incidencia | Anomalía real | TP |
| Incidencia | Sin anomalía real | FP |
| Conforme | Anomalía real | FN |
| Conforme | Sin anomalía real | TN |

- Precisión = TP / (TP + FP).
- Exhaustividad = TP / (TP + FN).
- F1 = 2 TP / (2 TP + FP + FN).
- Los denominadores cero se muestran como no calculables.
- Los casos no revisados o no evaluables se excluyen, con conteos explícitos.
- Una revisión parcial solo permite describir el subconjunto revisado; no
  representa una estimación independiente para todo el edificio.
- Revisar únicamente las alertas no permite detectar los falsos negativos.

Las etiquetas manuales se guardan en `localStorage`. La exportación JSON
incluye versión de reglas, SHA-256, perfil, procedencia y etiquetas por ID
estable. Las etiquetas de rutas llevan el perfil y la puerta en su ID; las
topológicas se comparten entre perfiles. Importar otro archivo o versión se
rechaza. El CSV contiene tanto casos conformes como incidencias y desconocidos,
con identificadores de espacio, planta, puerta, perfil y evidencia.

## Resultado de la ejecución sobre el GeoPackage incluido

Archivo: `EPM_IFC_v13_HSIMG_v14.gpkg`.
SHA-256: `c508507dc898162ea7149566668995645534ca05f0a335cd0d945010079a58a8`.
Inventario cargado: 1.517 espacios, 1.401 puertas IFC y 80 elementos verticales
(55 escaleras, 13 ascensores y 12 rampas).

| Regla | Casos | Incidencias automáticas |
| --- | ---: | ---: |
| Espacios sin comunicación | 1.517 | 231 |
| Conexión de puertas | 1.401 | 103 |
| Escaleras: salida a planta | 110 | 3 |
| Ascensores: salida a planta | 62 | 9 |
| Rampas: salida a planta | 24 | 8 |
| Continuidad vertical peatonal | 76 | 0 |
| Extremos internos candidatos | 687 | 24 |
| Integridad de arcos | 15.542 | 0 |
| Duplicados exactos | 15.542 | 0 |

Se analizan 28 puertas declaradas exteriores (incluidas cinco con asociaciones
distintas a las entradas elegibles del generador). Con perfil general, 27
alcanzan 1.099 espacios y una alcanza 2. Cada puerta mantiene 1.517 destinos en
su denominador. No hay etiquetas independientes incluidas ni cifras de F1
inventadas. Los conteos son detecciones del grafo, no errores IFC confirmados.

Los diagnósticos históricos del generador se muestran aparte: incluyen
reparaciones y conexiones rechazadas, por lo que no se suman a los resultados
de las reglas actuales ni se usan como referencia de verdad.

## Límites

- El inventario es el exportado al GeoPackage. Los elementos IFC omitidos
  requieren cotejar el archivo IFC original. Un JSON de grafo avisa de su
  inventario incompleto y de la ausencia de polígonos.
- La continuidad de escaleras se evalúa en los tramos exportados; no certifica
  individualmente todos los IfcStairFlight originales.
- Un recorrido alternativo alrededor de un obstáculo no es necesariamente
  duplicación. La optimalidad geométrica real exige un dominio navegable o
  referencia independiente; no se infiere de este grafo reducido.
- La alcanzabilidad no certifica accesibilidad normativa, seguridad ni
  evacuación, y una restricción de perfil no implica un defecto del IFC.

## Verificación reproducible

`pnpm test:validation` prueba casos dirigidos, inventarios ausentes, padres
semánticos, cabinas derivadas, conexiones locales, vuelos desconectados,
duplicados, métricas y referencias. Además carga el GeoPackage real mediante
el mismo lector de la aplicación. Se ejecuta también en el despliegue Pages.

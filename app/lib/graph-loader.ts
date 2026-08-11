import type {
  GraphDataset,
  GraphEdge,
  GraphNode,
  Point3,
  SpaceFeature,
  StoreyOption,
  VerticalFeature,
} from "./types";
import { categoryForNode } from "./types";

type SqlValue = number | string | Uint8Array | null;
type SqlDatabase = {
  exec: (sql: string) => Array<{ columns: string[]; values: SqlValue[][] }>;
  close: () => void;
};

type ParsedGeometry =
  | { type: "Point"; coordinates: Point3 }
  | { type: "LineString"; coordinates: Point3[] }
  | { type: "Polygon"; coordinates: Point3[][] }
  | { type: "MultiPoint"; coordinates: Point3[] }
  | { type: "MultiLineString"; coordinates: Point3[][] }
  | { type: "MultiPolygon"; coordinates: Point3[][][] }
  | { type: "GeometryCollection"; geometries: ParsedGeometry[] };

function asBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "sí", "si"].includes(text)) return true;
  if (["false", "0", "no"].includes(text)) return false;
  return null;
}

function asNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : { value: parsed };
  } catch {
    return { value };
  }
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parsePointWkt(value: unknown): Point3 | null {
  if (!value) return null;
  const match = String(value).match(
    /POINT(?:\s+Z)?\s*\(\s*([-+\deE.]+)\s+([-+\deE.]+)(?:\s+([-+\deE.]+))?/i,
  );
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function parseLineWkt(value: unknown): Point3[] {
  if (!value) return [];
  const match = String(value).match(/LINESTRING(?:\s+Z)?\s*\((.+)\)/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((part) => part.trim().split(/\s+/).map(Number))
    .filter((coords) => coords.length >= 2 && coords.every(Number.isFinite))
    .map((coords) => [coords[0], coords[1], coords[2] ?? 0] as Point3);
}

function cleanRaw(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => !(value instanceof Uint8Array)),
  );
}

function normalizeNode(row: Record<string, unknown>, geometry?: ParsedGeometry | null): GraphNode {
  const geometryPoint = geometry?.type === "Point" ? geometry.coordinates : null;
  const wktPoint = parsePointWkt(row.geometry_wkt ?? row.geometry);
  const point = geometryPoint ?? wktPoint;
  const x = asNumber(row.x, point?.[0] ?? 0);
  const y = asNumber(row.y, point?.[1] ?? 0);
  const z = asNumber(row.z, point?.[2] ?? 0);
  const id = String(row.node_id ?? row.id ?? row.key ?? `node-${x}-${y}-${z}`);
  const nodeType = String(row.node_type ?? "unknown");
  const mobilityType = row.mobility_type ? String(row.mobility_type) : null;
  const raw = cleanRaw(row);
  const metadata = {
    ...parseMetadata(row.metadata_json),
    ...Object.fromEntries(
      Object.entries(raw).filter(
        ([key]) => !["geometry", "geometry_wkt", "metadata_json"].includes(key),
      ),
    ),
  };
  return {
    id,
    x,
    y,
    z,
    name: String(row.name ?? metadata.name ?? id),
    nodeType,
    nodeRole: String(row.node_role ?? "unknown"),
    mobilityType,
    parentNodeId: row.parent_node_id ? String(row.parent_node_id) : null,
    subgraphId: row.subgraph_id ? String(row.subgraph_id) : null,
    hierarchyLevel: asNumber(row.hierarchy_level, 0),
    storeyId: row.storey_id ? String(row.storey_id) : null,
    accessibleGeneral: asBoolean(row.accessible_general),
    accessibleWheelchair: asBoolean(row.accessible_wheelchair),
    category: categoryForNode(raw),
    metadata,
    raw,
  };
}

function normalizeEdge(row: Record<string, unknown>, geometry?: ParsedGeometry | null): GraphEdge {
  let points: Point3[] = [];
  if (geometry?.type === "LineString") points = geometry.coordinates;
  if (geometry?.type === "MultiLineString") points = geometry.coordinates.flat();
  if (!points.length) points = parseLineWkt(row.geometry_wkt ?? row.geometry);
  const source = String(row.source_id ?? row.source ?? "");
  const target = String(row.target_id ?? row.target ?? "");
  const raw = cleanRaw(row);
  return {
    id: String(row.edge_id ?? row.key ?? row.id ?? `${source}-${target}`),
    source,
    target,
    edgeType: String(row.edge_type ?? "connection"),
    mobilityMode: String(row.mobility_mode ?? "unknown"),
    subgraphId: row.subgraph_id ? String(row.subgraph_id) : null,
    points,
    accessibleGeneral: asBoolean(row.accessible_general),
    accessibleWheelchair: asBoolean(row.accessible_wheelchair),
    metadata: {
      ...parseMetadata(row.metadata_json),
      ...Object.fromEntries(
        Object.entries(raw).filter(
          ([key]) => !["geometry", "geometry_wkt", "metadata_json"].includes(key),
        ),
      ),
    },
    raw,
  };
}

function storeyLabel(level: number, elevation: number): string {
  const elevationLabel = elevation.toFixed(2);
  if (level === 0) {
    return `Level 0 · Ground floor (main entrance) · elevation ${elevationLabel} m`;
  }
  if (level < 0) {
    const basement = Math.abs(level);
    const basementLabel = basement === 1 ? "Basement" : `Basement ${basement}`;
    return `Level ${level} · ${basementLabel} · elevation ${elevationLabel} m`;
  }
  const floorNames: Record<number, string> = {
    1: "First floor",
    2: "Second floor",
    3: "Third floor",
    4: "Fourth floor",
    5: "Fifth floor",
    6: "Sixth floor",
  };
  return `Level ${level} · ${floorNames[level] ?? `Floor ${level}`} · elevation ${elevationLabel} m`;
}

function repairLegacyStoreys(
  nodes: GraphNode[],
  edges: GraphEdge[],
  spaces: SpaceFeature[],
): { nodes: number; spaces: number } {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const elevations = new Map<string, number[]>();
  for (const node of nodes) {
    if (!node.storeyId) continue;
    const values = elevations.get(node.storeyId) ?? [];
    values.push(node.z);
    elevations.set(node.storeyId, values);
  }
  const elevationByStorey = new Map(
    [...elevations.entries()].map(([id, values]) => {
      const sorted = values.slice().sort((a, b) => a - b);
      return [id, sorted[Math.floor(sorted.length / 2)] ?? 0] as const;
    }),
  );
  const repairedNodes = new Set<string>();

  const inheritFromParent = () => {
    let changed = false;
    for (const node of nodes) {
      if (node.storeyId || !node.parentNodeId) continue;
      const parent = nodeById.get(node.parentNodeId);
      if (!parent?.storeyId) continue;
      node.storeyId = parent.storeyId;
      node.z = parent.z;
      repairedNodes.add(node.id);
      changed = true;
    }
    return changed;
  };
  while (inheritFromParent()) {
    // Resolve short parent chains before inferring spaces from their accesses.
  }

  const votes = new Map<string, Map<string, number>>();
  const vote = (node: GraphNode, storeyId: string) => {
    const storeyVotes = votes.get(node.id) ?? new Map<string, number>();
    storeyVotes.set(storeyId, (storeyVotes.get(storeyId) ?? 0) + 1);
    votes.set(node.id, storeyVotes);
  };
  for (const node of nodes) {
    if (node.nodeType !== "door_access" || !node.storeyId) continue;
    const spaceId = String(node.metadata.space_id ?? "");
    const spaceNode = nodeById.get(spaceId);
    if (spaceNode?.nodeType === "space" && !spaceNode.storeyId) {
      vote(spaceNode, node.storeyId);
    }
  }
  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    if (source.nodeType === "space" && !source.storeyId && target.storeyId) {
      vote(source, target.storeyId);
    }
    if (target.nodeType === "space" && !target.storeyId && source.storeyId) {
      vote(target, source.storeyId);
    }
  }
  for (const [nodeId, storeyVotes] of votes) {
    const node = nodeById.get(nodeId);
    if (!node || node.storeyId) continue;
    const storeyId = [...storeyVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!storeyId) continue;
    node.storeyId = storeyId;
    node.z = elevationByStorey.get(storeyId) ?? node.z;
    repairedNodes.add(node.id);
  }
  while (inheritFromParent()) {
    // Internal mobility nodes inherit the level and elevation of their space.
  }

  let repairedSpaces = 0;
  for (const space of spaces) {
    if (space.storeyId) continue;
    const graphNode = nodeById.get(space.spaceNodeId);
    if (!graphNode?.storeyId) continue;
    space.storeyId = graphNode.storeyId;
    repairedSpaces += 1;
  }

  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const start: Point3 = [source.x, source.y, source.z];
    const end: Point3 = [target.x, target.y, target.z];
    edge.points = edge.points.length > 2
      ? [start, ...edge.points.slice(1, -1), end]
      : [start, end];
  }

  return { nodes: repairedNodes.size, spaces: repairedSpaces };
}

function storeysFrom(nodes: GraphNode[], spaces: SpaceFeature[]): StoreyOption[] {
  const elevations = new Map<string, number[]>();
  for (const node of nodes) {
    if (!node.storeyId) continue;
    const values = elevations.get(node.storeyId) ?? [];
    values.push(node.z);
    elevations.set(node.storeyId, values);
  }
  for (const space of spaces) {
    if (!space.storeyId || elevations.has(space.storeyId)) continue;
    const z = space.rings[0]?.[0]?.[2] ?? 0;
    elevations.set(space.storeyId, [z]);
  }
  const sortedStoreys = [...elevations.entries()]
    .map(([id, values]) => {
      const sorted = values.slice().sort((a, b) => a - b);
      const elevation = sorted[Math.floor(sorted.length / 2)] ?? 0;
      return { id, elevation };
    })
    .sort((a, b) => a.elevation - b.elevation);

  const groundIndex = sortedStoreys.reduce((closestIndex, storey, index) =>
    Math.abs(storey.elevation) < Math.abs(sortedStoreys[closestIndex]?.elevation ?? Infinity)
      ? index
      : closestIndex, 0);

  return sortedStoreys.map((storey, index) => ({
    ...storey,
    label: storeyLabel(index - groundIndex, storey.elevation),
  }));
}

function readCoordinate(
  view: DataView,
  state: { offset: number },
  littleEndian: boolean,
  dimensions: number,
): Point3 {
  const values: number[] = [];
  for (let index = 0; index < dimensions; index += 1) {
    values.push(view.getFloat64(state.offset, littleEndian));
    state.offset += 8;
  }
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}

function parseWkbGeometry(view: DataView, state: { offset: number }): ParsedGeometry {
  const littleEndian = view.getUint8(state.offset) === 1;
  state.offset += 1;
  let rawType = view.getUint32(state.offset, littleEndian);
  state.offset += 4;

  const ewkbZ = Boolean(rawType & 0x80000000);
  const ewkbM = Boolean(rawType & 0x40000000);
  const hasSrid = Boolean(rawType & 0x20000000);
  rawType &= 0x1fffffff;
  if (hasSrid) state.offset += 4;

  const isoDimensions = Math.floor(rawType / 1000);
  const baseType = rawType % 1000;
  const hasZ = ewkbZ || isoDimensions === 1 || isoDimensions === 3;
  const hasM = ewkbM || isoDimensions === 2 || isoDimensions === 3;
  const dimensions = 2 + Number(hasZ) + Number(hasM);
  const count = () => {
    const value = view.getUint32(state.offset, littleEndian);
    state.offset += 4;
    return value;
  };

  if (baseType === 1) {
    return { type: "Point", coordinates: readCoordinate(view, state, littleEndian, dimensions) };
  }
  if (baseType === 2) {
    const coordinates = Array.from({ length: count() }, () =>
      readCoordinate(view, state, littleEndian, dimensions),
    );
    return { type: "LineString", coordinates };
  }
  if (baseType === 3) {
    const coordinates = Array.from({ length: count() }, () =>
      Array.from({ length: count() }, () =>
        readCoordinate(view, state, littleEndian, dimensions),
      ),
    );
    return { type: "Polygon", coordinates };
  }
  if ([4, 5, 6, 7].includes(baseType)) {
    const children = Array.from({ length: count() }, () => parseWkbGeometry(view, state));
    if (baseType === 4) {
      return {
        type: "MultiPoint",
        coordinates: children
          .filter((item): item is Extract<ParsedGeometry, { type: "Point" }> => item.type === "Point")
          .map((item) => item.coordinates),
      };
    }
    if (baseType === 5) {
      return {
        type: "MultiLineString",
        coordinates: children
          .filter((item): item is Extract<ParsedGeometry, { type: "LineString" }> => item.type === "LineString")
          .map((item) => item.coordinates),
      };
    }
    if (baseType === 6) {
      return {
        type: "MultiPolygon",
        coordinates: children
          .filter((item): item is Extract<ParsedGeometry, { type: "Polygon" }> => item.type === "Polygon")
          .map((item) => item.coordinates),
      };
    }
    return { type: "GeometryCollection", geometries: children };
  }
  throw new Error(`Unsupported WKB type: ${rawType}`);
}

function parseGeoPackageGeometry(value: unknown): ParsedGeometry | null {
  if (!(value instanceof Uint8Array) || value.byteLength < 9) return null;
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  let offset = 0;
  if (view.getUint8(0) === 0x47 && view.getUint8(1) === 0x50) {
    const flags = view.getUint8(3);
    const envelope = (flags >> 1) & 0x07;
    const envelopeBytes = [0, 32, 48, 48, 64][envelope] ?? 0;
    offset = 8 + envelopeBytes;
  }
  try {
    return parseWkbGeometry(view, { offset });
  } catch {
    return null;
  }
}

function rowsFrom(db: SqlDatabase, table: string): Record<string, unknown>[] {
  const escaped = table.replaceAll('"', '""');
  const result = db.exec(`SELECT * FROM "${escaped}"`)[0];
  if (!result) return [];
  return result.values.map((values) =>
    Object.fromEntries(result.columns.map((column, index) => [column, values[index]])),
  );
}

function tableExists(db: SqlDatabase, table: string): boolean {
  const escaped = table.replaceAll("'", "''");
  return Boolean(
    db.exec(
      `SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name='${escaped}' LIMIT 1`,
    )[0]?.values.length,
  );
}

function geometryColumn(db: SqlDatabase, table: string): string {
  if (!tableExists(db, "gpkg_geometry_columns")) return "geometry";
  const escaped = table.replaceAll("'", "''");
  const result = db.exec(
    `SELECT column_name FROM gpkg_geometry_columns WHERE table_name='${escaped}' LIMIT 1`,
  )[0];
  return String(result?.values[0]?.[0] ?? "geometry");
}

async function loadGeoPackage(file: File): Promise<GraphDataset> {
  const initSqlJs = (await import("sql.js/dist/sql-wasm.js")).default;
  const SQL = await initSqlJs({
    locateFile: () => new URL("sql-wasm.wasm", window.location.href).href,
  });
  const db = new SQL.Database(new Uint8Array(await file.arrayBuffer())) as unknown as SqlDatabase;
  try {
    if (!tableExists(db, "graph_nodes") || !tableExists(db, "graph_edges")) {
      throw new Error("The GeoPackage does not contain the graph_nodes and graph_edges layers.");
    }
    const nodeGeometry = geometryColumn(db, "graph_nodes");
    const edgeGeometry = geometryColumn(db, "graph_edges");
    const nodes = rowsFrom(db, "graph_nodes").map((row) =>
      normalizeNode(row, parseGeoPackageGeometry(row[nodeGeometry])),
    );
    const edges = rowsFrom(db, "graph_edges").map((row) =>
      normalizeEdge(row, parseGeoPackageGeometry(row[edgeGeometry])),
    );
    const spaces: SpaceFeature[] = tableExists(db, "spaces")
      ? rowsFrom(db, "spaces").flatMap((row) => {
          const column = geometryColumn(db, "spaces");
          const geometry = parseGeoPackageGeometry(row[column]);
          const polygons = geometry?.type === "Polygon"
            ? [geometry.coordinates]
            : geometry?.type === "MultiPolygon"
              ? geometry.coordinates
              : [];
          return polygons.map((rings, index) => ({
            id: `${String(row.space_id ?? row.ifc_guid ?? "space")}-${index}`,
            spaceNodeId: String(row.space_id ?? row.ifc_guid ?? "space"),
            name: String(row.name ?? row.space_id ?? "Space"),
            storeyId: row.storey_id ? String(row.storey_id) : null,
            nodeClass: String(row.node_class ?? "unknown"),
            rings,
            metadata: {
              ...parseMetadata(row.metadata_json),
              ...cleanRaw(row),
            },
          }));
        })
      : [];
    const verticalElementRows = tableExists(db, "vertical_elements")
      ? rowsFrom(db, "vertical_elements")
      : [];
    const verticalElementGeometry = tableExists(db, "vertical_elements")
      ? geometryColumn(db, "vertical_elements")
      : "geometry";
    const verticalElementsById = new Map(
      verticalElementRows.map((row) => [String(row.vertical_id ?? row.ifc_guid), row]),
    );
    const verticalFootprintRows = tableExists(db, "vertical_footprints")
      ? rowsFrom(db, "vertical_footprints")
      : [];
    const verticalFootprintGeometry = tableExists(db, "vertical_footprints")
      ? geometryColumn(db, "vertical_footprints")
      : "geometry";
    const featureRows = verticalFootprintRows.length
      ? verticalFootprintRows
      : verticalElementRows;
    const verticalFeatures: VerticalFeature[] = featureRows.map((row) => {
      const verticalId = String(row.vertical_id ?? row.ifc_guid ?? "vertical");
      const elementRow = verticalElementsById.get(verticalId) ?? row;
      const footprintGeometry = verticalFootprintRows.length
        ? parseGeoPackageGeometry(row[verticalFootprintGeometry])
        : null;
      const pathGeometry = parseGeoPackageGeometry(
        elementRow[verticalElementGeometry],
      );
      const rings = footprintGeometry?.type === "Polygon"
        ? footprintGeometry.coordinates
        : footprintGeometry?.type === "MultiPolygon"
          ? footprintGeometry.coordinates.flat()
          : [];
      const paths = pathGeometry?.type === "LineString"
        ? [pathGeometry.coordinates]
        : pathGeometry?.type === "MultiLineString"
          ? pathGeometry.coordinates
          : [];
      const metadata = {
        ...parseMetadata(elementRow.metadata_json),
        ...parseMetadata(row.metadata_json),
        ...cleanRaw(elementRow),
        ...cleanRaw(row),
      };
      return {
        id: `vertical-feature-${verticalId}`,
        verticalId,
        name: String(row.name ?? metadata.name ?? verticalId),
        verticalType: String(row.vertical_type ?? elementRow.vertical_type ?? "vertical"),
        routeType: String(row.route_type ?? metadata.route_type ?? "unknown"),
        pedestrianAccess: asBoolean(row.pedestrian_access ?? metadata.pedestrian_access),
        vehicleAccess: asBoolean(row.vehicle_access ?? metadata.vehicle_access),
        storeyIds: parseStringArray(
          row.connected_storeys ?? elementRow.connected_storeys,
        ),
        rings,
        paths,
        metadata,
      };
    });
    const repaired = repairLegacyStoreys(nodes, edges, spaces);
    const warnings: string[] = [];
    if (repaired.nodes || repaired.spaces) {
      const unassignedSpaces = spaces.filter((space) => !space.storeyId).length;
      warnings.push(
        `Building levels were recovered for ${repaired.nodes.toLocaleString("en-US")} nodes and ${repaired.spaces.toLocaleString("en-US")} spaces from a legacy export.${unassignedSpaces ? ` ${unassignedSpaces.toLocaleString("en-US")} spaces remain without a level; load the GeoPackage generated by v2hsimg.py to view every floor.` : ""}`,
      );
    }
    if (!spaces.length) {
      warnings.push("This GeoPackage does not contain space polygons; the 2D view will display only the graph.");
    }
    const storeys = storeysFrom(nodes, spaces);
    const elevationByStorey = new Map(storeys.map((storey) => [storey.id, storey.elevation]));
    for (const space of spaces) {
      const elevation = space.storeyId ? elevationByStorey.get(space.storeyId) : undefined;
      if (elevation === undefined) continue;
      space.rings = space.rings.map((ring) =>
        ring.map((point) => [point[0], point[1], elevation] as Point3),
      );
    }
    return {
      name: file.name,
      sourceType: "gpkg",
      nodes,
      edges,
      spaces,
      verticalFeatures,
      storeys,
      warnings,
    };
  } finally {
    db.close();
  }
}

function parseJsonAllowingNonFinite(text: string): {
  payload: Record<string, unknown>;
  replacedValues: number;
} {
  try {
    return { payload: JSON.parse(text) as Record<string, unknown>, replacedValues: 0 };
  } catch (originalError) {
    let normalized = "";
    let inString = false;
    let escaped = false;
    let replacedValues = 0;
    const tokens = ["-Infinity", "Infinity", "NaN"];

    for (let index = 0; index < text.length;) {
      const character = text[index];
      if (inString) {
        normalized += character;
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        index += 1;
        continue;
      }
      if (character === '"') {
        inString = true;
        normalized += character;
        index += 1;
        continue;
      }

      const token = tokens.find((candidate) => text.startsWith(candidate, index));
      const previous = index > 0 ? text[index - 1] : "";
      const next = token ? text[index + token.length] ?? "" : "";
      const validBefore = index === 0 || /[\s:[,{]/.test(previous);
      const validAfter = !next || /[\s,}\]]/.test(next);
      if (token && validBefore && validAfter) {
        normalized += "null";
        replacedValues += 1;
        index += token.length;
        continue;
      }
      normalized += character;
      index += 1;
    }

    if (!replacedValues) throw originalError;
    return {
      payload: JSON.parse(normalized) as Record<string, unknown>,
      replacedValues,
    };
  }
}

async function loadJson(file: File): Promise<GraphDataset> {
  const { payload, replacedValues } = parseJsonAllowingNonFinite(await file.text());
  const nodeRows = Array.isArray(payload.nodes) ? payload.nodes : [];
  const edgeRows = Array.isArray(payload.edges)
    ? payload.edges
    : Array.isArray(payload.links)
      ? payload.links
      : [];
  if (!nodeRows.length) {
    throw new Error("The JSON file does not contain the expected nodes collection.");
  }
  const nodes = nodeRows.map((item) => normalizeNode(item as Record<string, unknown>));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = edgeRows.map((item) => {
    const edge = normalizeEdge(item as Record<string, unknown>);
    if (!edge.points.length) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (source && target) {
        edge.points = [[source.x, source.y, source.z], [target.x, target.y, target.z]];
      }
    }
    return edge;
  });
  const repaired = repairLegacyStoreys(nodes, edges, []);
  return {
    name: file.name,
    sourceType: "json",
    nodes,
    edges,
    spaces: [],
    verticalFeatures: [],
    storeys: storeysFrom(nodes, []),
    warnings: [
      ...(repaired.nodes
        ? [`Building levels were recovered for ${repaired.nodes.toLocaleString("en-US")} nodes from a legacy export.`]
        : []),
      ...(replacedValues
        ? [`${replacedValues.toLocaleString("en-US")} JSON-incompatible NaN/Infinity values were converted to null.`]
        : []),
      "The JSON file contains the graph but not the IfcSpace footprints. Use the GeoPackage for complete 2D context.",
    ],
  };
}

export async function loadGraphFile(file: File): Promise<GraphDataset> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "gpkg") return loadGeoPackage(file);
  if (extension === "json" || extension === "geojson") return loadJson(file);
  throw new Error("Unsupported format. Select a .gpkg, .json or .geojson file.");
}

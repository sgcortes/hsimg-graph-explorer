import type { DoorRecord, GraphDataset, GraphEdge, GraphNode } from "./types";

export const VALIDATION_VERSION = "1.0";
export type Profile = "general" | "wheelchair";
export type Status = "pass" | "fail" | "unknown";
export type ReferenceLabels = Record<string, "anomaly" | "normal">;
export interface ValidationCase {
  id: string; rule: string; entityId: string; label: string; storeyId: string | null;
  status: Status; detail: string; nodeIds: string[]; spaceIds: string[]; verticalIds: string[];
  entranceId?: string;
}
export interface EntranceResult {
  door: DoorRecord; cases: ValidationCase[]; reachable: number; unreachable: number; unknown: number;
}
export interface ValidationResult {
  cases: ValidationCase[]; entrances: EntranceResult[]; warnings: string[];
  spaceMembers: Map<string, string[]>;
}
export const RULES: Record<string, { label: string; criterion: string }> = {
  space_connection: { label: "Espacios sin comunicación", criterion: "El espacio tiene representación navegable y al menos una conexión que cruza hacia un acceso u otro espacio. Un padre semántico aislado no basta para declarar aislamiento." },
  door_connection: { label: "Conexión de puertas", criterion: "Cada espacio asociado a la puerta tiene una ruta local hacia su interior; una puerta interior exige dos lados y una exterior al menos uno. Se comprueba la topología, independientemente del perfil." },
  stair_floor: { label: "Escaleras: salida a planta", criterion: "Cada terminal de escalera en una planta declarada alcanza un espacio de esa misma planta, sin recorrer aristas de desplazamiento vertical." },
  elevator_floor: { label: "Ascensores: salida a planta", criterion: "Cada parada declarada alcanza un espacio exterior al hueco del ascensor en su misma planta, sin utilizar el viaje vertical." },
  ramp_floor: { label: "Rampas: salida a planta", criterion: "Cada terminal peatonal alcanza un espacio en la misma planta, sin utilizar el recorrido vertical de la rampa." },
  vertical_continuity: { label: "Continuidad de tramos verticales", criterion: "Los nodos de cada elemento vertical forman una componente conexa a través de sus propios tramos y descansillos. No se exige salida desde descansillos intermedios." },
  internal_dead_end: { label: "Extremos internos sin función", criterion: "Un nodo de eje sin acceso protegido y con cero o un vecino es candidato a ramal parásito. Requiere revisión: un fondo de pasillo puede ser legítimo." },
  edge_integrity: { label: "Integridad de conexiones", criterion: "Los extremos existen, no hay bucle sobre el mismo nodo y las coordenadas y longitudes disponibles son finitas y no negativas." },
  duplicate_connection: { label: "Conexiones idénticas repetidas", criterion: "Mismos extremos ordenados, tipo, modo y polilínea. Los arcos de ida y vuelta y los pasos geométricamente distintos no se consideran duplicados." },
  entrance_reachability: { label: "Acceso desde puerta exterior", criterion: "Recorrido dirigido desde cada puerta exterior hasta algún nodo navegable de cada espacio. Verde: ruta con accesibilidad conocida; ámbar: solo con datos desconocidos; rojo: ninguna ruta del perfil. No implica error del IFC por sí solo." },
};
export const STATUS_LABEL: Record<Status, string> = { pass: "Conforme", fail: "Incidencia", unknown: "No evaluable" };
type Adjacency = Map<string, string[]>;
const key = (...parts: unknown[]) => JSON.stringify(parts);
const values = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : [];
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

export function flood(adjacency: Adjacency, starts: Iterable<string>): Set<string> {
  const seen = new Set(starts), queue = [...seen];
  for (let i = 0; i < queue.length; i++) {
    for (const id of adjacency.get(queue[i]) ?? []) if (!seen.has(id)) { seen.add(id); queue.push(id); }
  }
  return seen;
}
function adjacency(nodes: GraphNode[], edges: GraphEdge[], accept: (edge: GraphEdge) => boolean, undirected = false): Adjacency {
  const result: Adjacency = new Map(nodes.map((n) => [n.id, []]));
  for (const edge of edges) {
    if (!result.has(edge.source) || !result.has(edge.target) || !accept(edge)) continue;
    result.get(edge.source)!.push(edge.target);
    if (undirected) result.get(edge.target)!.push(edge.source);
  }
  return result;
}
function profileFlag(item: GraphNode | GraphEdge, profile: Profile): boolean | null {
  return profile === "general" ? item.accessibleGeneral : item.accessibleWheelchair;
}
function isVehicle(edge: GraphEdge): boolean {
  return edge.mobilityMode === "vehicle" || edge.metadata.route_type === "vehicle_only";
}
function caseFor(rule: string, entityId: string, label: string, storeyId: string | null, status: Status, detail: string, extra: Partial<ValidationCase> = {}): ValidationCase {
  return { id: key(rule, entityId, storeyId), rule, entityId, label, storeyId, status, detail, nodeIds: [], spaceIds: [], verticalIds: [], ...extra };
}

export function validateGraph(dataset: GraphDataset, profile: Profile = "general"): ValidationResult {
  const nodes = new Map(dataset.nodes.map((n) => [n.id, n]));
  const children = new Map<string, GraphNode[]>();
  for (const n of dataset.nodes) if (n.parentNodeId) children.set(n.parentNodeId, [...children.get(n.parentNodeId) ?? [], n]);
  const spaces = new Map(dataset.spaces.map((s) => [s.spaceNodeId, s]));
  // Graph-only files are usable, but cannot establish inventory completeness.
  for (const n of dataset.nodes) if (n.nodeType === "space" && !spaces.has(n.id)) spaces.set(n.id, { id: n.id, spaceNodeId: n.id, name: n.name, storeyId: n.storeyId, nodeClass: n.mobilityType ?? "finalist", rings: [], metadata: n.metadata });
  const subgraphParents = new Map(dataset.validation?.subgraphs.map((s) => [s.id, s.parentId]) ?? []);
  const memberSets = new Map([...spaces.keys()].map((id) => [id, new Set<string>()]));
  for (const n of dataset.nodes) {
    const candidates = [n.id, n.parentNodeId, n.subgraphId ? subgraphParents.get(n.subgraphId) : null, n.metadata.space_id, n.metadata.hall_space_id];
    // Portals/door sides alone cannot establish arrival inside a room or corridor.
    if (n.nodeType === "door" || n.nodeType === "door_access" || n.nodeType === "vertical_mobility") continue;
    for (const candidate of candidates) if (typeof candidate === "string") memberSets.get(candidate)?.add(n.id);
  }
  // Space-derived elevators replace cabin IfcSpace nodes with explicit stop nodes.
  // Preserve that relationship instead of reporting each semantic cabin as isolated.
  for (const vertical of dataset.verticalFeatures) {
    const byStorey = record(record(vertical.metadata.properties)["HSIMG.SourceSpaceIdsByStorey"]);
    for (const [storeyId, sourceSpaces] of Object.entries(byStorey)) {
      const stops = (children.get(vertical.verticalId) ?? []).filter((n) => n.nodeRole === "elevator_stop" && n.storeyId === storeyId);
      for (const id of values(sourceSpaces)) for (const stop of stops) memberSets.get(id)?.add(stop.id);
    }
  }
  const spaceMembers = new Map([...memberSets].map(([id, set]) => [id, [...set].filter((n) => {
    const node = nodes.get(n)!;
    return !(node.nodeRole === "semantic_parent" && (children.get(n)?.length ?? 0) > 0);
  })]));
  const topo = adjacency(dataset.nodes, dataset.edges, (e) => !isVehicle(e), true);
  const strict = adjacency(dataset.nodes, dataset.edges, (e) => !isVehicle(e) && profileFlag(e, profile) === true && profileFlag(nodes.get(e.source)!, profile) === true && profileFlag(nodes.get(e.target)!, profile) === true);
  const possible = adjacency(dataset.nodes, dataset.edges, (e) => !isVehicle(e) && profileFlag(e, profile) !== false && profileFlag(nodes.get(e.source)!, profile) !== false && profileFlag(nodes.get(e.target)!, profile) !== false);
  const floor = adjacency(dataset.nodes, dataset.edges, (e) => {
    const a = nodes.get(e.source)!, b = nodes.get(e.target)!;
    // Stair mesh terminals can stop short of the finished-floor elevation.
    // Storey identity and the semantic edge type define a floor access, not a guessed z tolerance.
    return !isVehicle(e) && e.edgeType !== "vertical_path" && !!a.storeyId && a.storeyId === b.storeyId;
  }, true);
  const cases: ValidationCase[] = [], warnings: string[] = [];
  if (!dataset.validation?.inventory.spaces) warnings.push("Sin inventario completo de IfcSpace: solo se evalúan los espacios presentes en el grafo.");
  if (!dataset.validation?.inventory.doors) warnings.push("Sin inventario de puertas: no es posible detectar puertas omitidas por la exportación.");
  if (!dataset.validation?.inventory.vertical) warnings.push("Sin inventario de elementos verticales: las comprobaciones de paradas y tramos no son completas.");
  for (const [id, space] of spaces) {
    const members = spaceMembers.get(id) ?? [];
    const group = new Set(members);
    const connected = members.some((n) => (topo.get(n) ?? []).some((other) => !group.has(other)));
    const liftRepresentation = members.some((id) => nodes.get(id)?.nodeRole === "elevator_stop");
    cases.push(caseFor("space_connection", id, space.name, space.storeyId, members.length && connected ? "pass" : "fail", !members.length ? "El espacio inventariado no tiene representación navegable." : connected ? liftRepresentation ? "El IfcSpace está representado por una parada conectada del ascensor; la salida a planta se comprueba por separado." : "Existe una conexión del espacio con su entorno." : "Ninguna conexión une el espacio con un acceso u otro espacio.", { nodeIds: members, spaceIds: [id] }));
  }
  const doors: DoorRecord[] = dataset.validation?.doors ?? dataset.nodes.filter((n) => n.nodeType === "door").map((n) => ({ id: n.id, name: n.name, storeyId: n.storeyId, spaceIds: (children.get(n.id) ?? []).map((c) => String(c.metadata.space_id ?? "")).filter(Boolean), exterior: n.metadata.inout === 1 || n.metadata.ifc_is_external === true, entrance: n.metadata.entrance_exit_eligible === true || n.metadata.inout === 1 || n.metadata.ifc_is_external === true, point: [n.x, n.y, n.z], metadata: n.metadata }));
  for (const door of doors) {
    const linkedSpaces = [...new Set(door.spaceIds)];
    // Stay within this portal, its sides and the associated space: no detour via another door.
    let connected = 0;
    for (const spaceId of linkedSpaces) {
      const targets = new Set(spaceMembers.get(spaceId) ?? []);
      const allowed = new Set([door.id, ...targets, ...(children.get(door.id) ?? []).filter((n) => String(n.metadata.space_id) === spaceId).map((n) => n.id)]);
      const seen = new Set([door.id]), queue = [door.id];
      for (let i = 0; i < queue.length; i++) for (const next of floor.get(queue[i]) ?? []) if (allowed.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
      if ([...targets].some((id) => seen.has(id))) connected++;
    }
    const enough = linkedSpaces.length >= (door.exterior ? 1 : 2);
    cases.push(caseFor("door_connection", door.id, door.name, door.storeyId, nodes.has(door.id) && enough && connected === linkedSpaces.length ? "pass" : "fail", `${connected}/${linkedSpaces.length} lados asociados conectan con el interior. Se esperan ${door.exterior ? "al menos 1 (exterior)" : "2 (interior)"}.`, { nodeIds: [door.id], spaceIds: linkedSpaces }));
  }
  const allSpaceTargets = new Map<string, string>();
  for (const [spaceId, members] of spaceMembers) for (const id of members) allSpaceTargets.set(id, spaceId);
  for (const vertical of dataset.verticalFeatures) {
    if (vertical.routeType === "vehicle_only" || vertical.pedestrianAccess === false) continue;
    const kind = vertical.verticalType;
    if (!["stair", "elevator", "ramp"].includes(kind)) continue;
    const members = (children.get(vertical.verticalId) ?? []).filter((n) => n.nodeType === "internal_mobility");
    const ids = new Set(members.map((n) => n.id));
    const own = new Map(members.map((n) => [n.id, (topo.get(n.id) ?? []).filter((id) => ids.has(id))]));
    const seen = flood(own, members.length ? [members[0].id] : []);
    const connected = members.length >= 2 && seen.size === members.length;
    cases.push(caseFor("vertical_continuity", vertical.verticalId, vertical.name, null, connected ? "pass" : "fail", `${seen.size}/${members.length} nodos unidos por los tramos propios del elemento.`, { nodeIds: [...ids], verticalIds: [vertical.verticalId] }));
    const shaftSpaceIds = new Set(Object.values(record(record(vertical.metadata.properties)["HSIMG.SourceSpaceIdsByStorey"])).flatMap(values));
    const terminals = members.filter((n) => ["landing", "elevator_stop"].includes(n.nodeRole));
    if (!vertical.storeyIds.length) cases.push(caseFor(`${kind}_floor`, vertical.verticalId, vertical.name, null, "unknown", "No constan plantas servidas; no se infieren a partir de todas las plantas atravesadas.", { nodeIds: terminals.map((n) => n.id), verticalIds: [vertical.verticalId] }));
    for (const storeyId of vertical.storeyIds) {
      const stops = terminals.filter((n) => n.storeyId === storeyId);
      if (!stops.length) cases.push(caseFor(`${kind}_floor`, vertical.verticalId, vertical.name, storeyId, "fail", "Falta el terminal o parada en una planta declarada como servida.", { verticalIds: [vertical.verticalId] }));
      for (const stop of stops) {
        const reachable = flood(floor, [stop.id]);
        const target = [...reachable].find((id) => allSpaceTargets.has(id) && !shaftSpaceIds.has(allSpaceTargets.get(id)!));
        cases.push(caseFor(`${kind}_floor`, vertical.verticalId, vertical.name, storeyId, target ? "pass" : "fail", target ? "El terminal alcanza un espacio de esta planta sin viaje vertical." : "El terminal no alcanza un espacio de esta planta sin viajar a otra altura.", { id: key(`${kind}_floor`, vertical.verticalId, storeyId, stop.id), nodeIds: [stop.id], verticalIds: [vertical.verticalId] }));
      }
    }
  }
  for (const n of dataset.nodes) if (n.nodeType === "internal_mobility" && n.mobilityType === "horizontal" && ["axis_endpoint", "axis_junction"].includes(n.nodeRole)) {
    const degree = new Set(topo.get(n.id) ?? []).size;
    cases.push(caseFor("internal_dead_end", n.id, n.name, n.storeyId, degree <= 1 ? "fail" : "pass", `${degree} vecinos distintos. Los extremos con función de acceso están excluidos de esta regla.`, { nodeIds: [n.id] }));
  }
  const duplicates = new Map<string, number>();
  for (const edge of dataset.edges) {
    const a = nodes.get(edge.source), b = nodes.get(edge.target);
    const length = edge.metadata.length_3d ?? edge.raw.length_3d;
    const invalid = !a || !b || edge.source === edge.target || ![a.x, a.y, a.z, b.x, b.y, b.z, ...edge.points.flat()].every(Number.isFinite) || (length !== undefined && length !== null && (!Number.isFinite(Number(length)) || Number(length) < 0));
    cases.push(caseFor("edge_integrity", edge.id, edge.edgeType, a?.storeyId ?? null, invalid ? "fail" : "pass", invalid ? "Extremo ausente, bucle, coordenada no finita o longitud inválida." : "Extremos y geometría numéricamente válidos.", { nodeIds: [edge.source, edge.target] }));
    const signature = key(edge.source, edge.target, edge.edgeType, edge.mobilityMode, edge.points);
    const count = duplicates.get(signature) ?? 0;
    duplicates.set(signature, count + 1);
    cases.push(caseFor("duplicate_connection", edge.id, edge.edgeType, a?.storeyId ?? null, count ? "fail" : "pass", count ? "Otro arco anterior tiene los mismos extremos, tipo, modo y polilínea." : "No repite un arco anterior idéntico.", { nodeIds: [edge.source, edge.target] }));
  }
  const entrances: EntranceResult[] = doors.filter((d) => d.entrance).map((door) => {
    const start = nodes.get(door.id);
    const certainly = flood(strict, start && profileFlag(start, profile) === true ? [door.id] : []);
    const maybe = flood(possible, start && profileFlag(start, profile) !== false ? [door.id] : []);
    const rows = [...spaces].map(([id, space]) => {
      const members = spaceMembers.get(id) ?? [];
      const reached = members.some((n) => certainly.has(n));
      const possibleReach = members.some((n) => maybe.has(n));
      const status: Status = reached ? "pass" : possibleReach ? "unknown" : "fail";
      return caseFor("entrance_reachability", id, space.name, space.storeyId, status, reached ? "Existe una ruta dirigida con permisos conocidos para este perfil." : possibleReach ? "Solo hay ruta si se aceptan atributos de accesibilidad desconocidos." : !start ? "La puerta exterior inventariada no está representada en el grafo." : "No hay ruta dirigida para el perfil seleccionado; revisar conexiones y restricciones.", { id: key("entrance_reachability", profile, door.id, id), nodeIds: members, spaceIds: [id], entranceId: door.id });
    });
    return { door, cases: rows, reachable: rows.filter((r) => r.status === "pass").length, unreachable: rows.filter((r) => r.status === "fail").length, unknown: rows.filter((r) => r.status === "unknown").length };
  });
  if (!entrances.length) warnings.push("No hay puertas exteriores identificadas; la alcanzabilidad desde el exterior no es evaluable.");
  return { cases, entrances, warnings, spaceMembers };
}

export function summarize(cases: ValidationCase[]) {
  return Object.entries(RULES).map(([rule, config]) => {
    const rows = cases.filter((c) => c.rule === rule);
    return { rule, label: config.label, total: rows.length, pass: rows.filter((c) => c.status === "pass").length, fail: rows.filter((c) => c.status === "fail").length, unknown: rows.filter((c) => c.status === "unknown").length };
  }).filter((r) => r.total);
}

export function metrics(cases: ValidationCase[], labels: ReferenceLabels) {
  let tp = 0, fp = 0, fn = 0, tn = 0, excluded = 0;
  for (const c of cases) {
    const label = labels[c.id];
    if (!label || c.status === "unknown") { excluded++; continue; }
    if (c.status === "fail") { if (label === "anomaly") tp++; else fp++; }
    else if (label === "anomaly") fn++; else tn++;
  }
  const evaluated = tp + fp + fn + tn;
  return { tp, fp, fn, tn, evaluated, excluded, total: cases.length, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null, f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null };
}

export function csvRows(rows: unknown[][]): string {
  return "\uFEFF" + rows.map((row) => row.map((v) => {
    const text = String(v ?? "");
    // Neutralize spreadsheet formulas in untrusted IFC names and attributes.
    return `"${(/^[=+\-@\t\r]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
}

export function importReference(text: string, fingerprint: string, validIds: Set<string>): ReferenceLabels {
  const value = JSON.parse(text);
  if (value.schema !== "hsimg-validation-reference" || value.version !== VALIDATION_VERSION || value.fingerprint !== fingerprint) throw new Error("La referencia no corresponde a este archivo y versión del validador.");
  if (!value.labels || typeof value.labels !== "object" || Array.isArray(value.labels)) throw new Error("La referencia no contiene etiquetas válidas.");
  const result: ReferenceLabels = {};
  for (const [id, label] of Object.entries(value.labels)) {
    if (!validIds.has(id) || !["anomaly", "normal"].includes(String(label))) throw new Error("La referencia contiene casos o etiquetas desconocidos. Compruebe también el perfil seleccionado.");
    result[id] = label as "anomaly" | "normal";
  }
  return result;
}

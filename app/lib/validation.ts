import type { DoorRecord, GraphDataset, GraphEdge, GraphNode } from "./types";

export const VALIDATION_VERSION = "1.1";
export type Profile = "general" | "wheelchair";
export type Status = "pass" | "fail" | "unknown" | "excluded";
export type ReferenceLabels = Record<string, "anomaly" | "normal">;
export interface ValidationCase {
  id: string; rule: string; entityId: string; label: string; storeyId: string | null;
  status: Status; detail: string; nodeIds: string[]; spaceIds: string[]; verticalIds: string[];
  entranceId?: string;
}
export interface EntranceResult {
  door: DoorRecord; cases: ValidationCase[]; reachable: number; unreachable: number; unknown: number; excluded: number;
}
export interface ValidationResult {
  cases: ValidationCase[]; entrances: EntranceResult[]; warnings: string[];
  spaceMembers: Map<string, string[]>; scopes: Map<string, SpaceScope>;
}
export const RULES: Record<string, { label: string; criterion: string; review: string }> = {
  space_connection: { label: "Space connectivity", criterion: "Each required space needs a navigable representative and a connection to an access or another space. An isolated semantic parent alone does not establish isolation.", review: "Check the space boundary and its intended access in the IFC. If access is required, inspect missing doors, space associations and gaps between the portal and the internal route. Use the scope control for intentionally inaccessible spaces." },
  door_connection: { label: "Door connections", criterion: "Each associated side must reach the interior locally through this door. Interior doors need at least two associated spaces; exterior doors need at least one. No detour through another door is accepted.", review: "Inspect IfcRelSpaceBoundary and the door opening, its exterior classification, the side nodes and the connection to each room. A missing association can produce this result even if a door looks correctly positioned." },
  stair_floor: { label: "Stair exits to floors", criterion: "Each terminal on a declared served floor must reach a required space on that floor without a vertical travel edge. Intermediate landings do not require floor exits.", review: "Check the terminal's assigned storey, landing geometry, opening and connection to a floor space. A missing terminal, incorrect storey assignment or small geometric gap can explain this result." },
  elevator_floor: { label: "Elevator exits to floors", criterion: "Each declared stop must reach a required space outside its own elevator cabin or shaft on the same floor, without using vertical travel.", review: "Check the list of served floors, stop node, elevator door and its corridor connection. Reaching the cabin itself is insufficient. A floor merely crossed by the shaft is not automatically a served floor." },
  ramp_floor: { label: "Ramp exits to floors", criterion: "Each pedestrian terminal must reach a required space on the same floor without using the ramp's vertical travel edges.", review: "Check terminal-to-floor connections and storey assignment. Confirm that this is a pedestrian ramp; vehicle-only ramps are excluded from this check." },
  vertical_continuity: { label: "Vertical element continuity", criterion: "All internal nodes of a pedestrian vertical element must form one connected component through its own flights and landings.", review: "Inspect disconnected flights, missing landing links and parent-element assignments. Connectivity via a neighbouring stair or elevator does not repair continuity within this element." },
  internal_dead_end: { label: "Internal dead ends", criterion: "An unprotected horizontal axis node with zero or one distinct neighbour is a review candidate. A legitimate corridor end may satisfy this condition.", review: "Compare the branch with the floor plan. Remove it only if it has no access or mobility purpose; preserve legitimate corridor ends and routes around obstacles." },
  edge_integrity: { label: "Connection integrity", criterion: "Both endpoints must exist and differ. Coordinates must be finite and any stored length must be finite and non-negative.", review: "Inspect endpoint IDs, coordinates and the stored length. Correct the source geometry or regenerate the affected connection before trusting routes that use it." },
  duplicate_connection: { label: "Identical duplicate connections", criterion: "Ordered endpoints, type, mode and polyline must not repeat. Reverse arcs and geometrically distinct alternatives are not duplicates.", review: "Compare the repeated records and keep one equivalent directed arc. Do not remove a reverse arc or an alternative physical passage solely because endpoints match." },
  entrance_reachability: { label: "Reachability from exterior doors", criterion: "A directed route must reach a navigable member of each required space, respecting the selected mobility profile. Excluded spaces are neither destinations nor transit areas. Unknown permissions cannot establish a confirmed route.", review: "Trace the route from this exterior door and inspect disconnected components, arc directions and profile restrictions. A restriction or a missing exterior-door node can prevent access without proving that the IFC geometry is incorrect." },
};
export const STATUS_LABEL: Record<Status, string> = { pass: "Pass", fail: "Issue", unknown: "Unknown", excluded: "Excluded by scope" };
export type ScopeOverrides = Record<string, "include" | "exclude">;
export interface SpaceScope { excluded: boolean; reason: string; category: string }
export function spaceScope(space: { spaceNodeId: string; name: string; metadata: Record<string, unknown> }, overrides: ScopeOverrides = {}): SpaceScope {
  const properties = record(space.metadata.properties);
  const pset = record(properties.Pset_SpaceCommon);
  const names = [space.metadata.long_name, space.name, pset.Reference, properties["Pset_SpaceCommon.Reference"]].filter((v): v is string => typeof v === "string");
  // Explicit semantic names only. A missing door, or the word 'shaft' inside an
  // elevator description, must never silently remove a required destination.
  const normalized = names.map((v) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase());
  const shaft = normalized.some((v) => /^(patinillo|service shaft|installation shaft)(?:\s*[-:#]?\s*\d[\w.-]*)?$/.test(v));
  const works = normalized.some((v) => /^(obra|zona de obra|construction zone|construction area)(?:\s*[-:#]?\s*\d[\w.-]*)?$/.test(v));
  const category = shaft ? "Service shaft" : works ? "Construction zone" : "Space";
  const override = overrides[space.spaceNodeId];
  return { excluded: override === "exclude" || (override !== "include" && (shaft || works)), category,
    reason: override === "exclude" ? "Explicitly marked as intentionally non-accessible by the reviewer." : override === "include" ? "Explicitly included as a required destination by the reviewer." : shaft || works ? `${category} identified from its IFC semantic label; access is not required by the default validation scope.` : "Access is required; no intentional exclusion is recorded." };
}
export function spaceLabel(space: { spaceNodeId: string; name: string; metadata: Record<string, unknown> }): string {
  const kind = spaceScope(space).category;
  return `${kind} · ${space.name === space.spaceNodeId ? space.spaceNodeId : space.name}`;
}
export function caseExplanation(c: ValidationCase): { interpretation: string; action: string } {
  if (c.status === "excluded") return { interpretation: "This space remains in the inventory but is outside the required-access scope. It is not a passed check, a true negative or an accessible destination. Its nodes are not used as transit in exterior-route analysis.", action: "Confirm the intended use against the IFC and project brief. Select Require access if this particular space should be visitable. Existing connections may represent maintenance access and should be reviewed separately." };
  if (c.status === "unknown") return { interpretation: "The available attributes cannot establish a reliable pass or issue for this check. Missing data must not be interpreted as confirmed accessibility.", action: RULES[c.rule]?.review ?? "Check the source data." };
  return { interpretation: c.status === "pass" ? "The exported graph satisfies this specific check. This does not establish physical, regulatory or complete building accessibility." : "The exported graph does not satisfy this check. This is a review candidate, not a confirmed IFC error.", action: RULES[c.rule]?.review ?? "Check the source data." };
}
const scopeKey = (overrides: ScopeOverrides) => JSON.stringify(Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)));
export function readScopeOverrides(value: unknown, validIds: Set<string>): ScopeOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid validation scope.");
  const result: ScopeOverrides = {};
  for (const [id, choice] of Object.entries(value)) {
    if (!validIds.has(id) || (choice !== "include" && choice !== "exclude")) throw new Error("Unknown space or invalid scope override.");
    result[id] = choice;
  }
  return result;
}
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

export function validateGraph(dataset: GraphDataset, profile: Profile = "general", overrides: ScopeOverrides = {}): ValidationResult {
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
  const scopes = new Map([...spaces].map(([id, space]) => [id, spaceScope(space, overrides)]));
  const excludedNodes = new Set([...spaceMembers].filter(([id]) => scopes.get(id)?.excluded).flatMap(([, members]) => members));
  const inScope = (e: GraphEdge) => !excludedNodes.has(e.source) && !excludedNodes.has(e.target);
  const topo = adjacency(dataset.nodes, dataset.edges, (e) => !isVehicle(e), true);
  const strict = adjacency(dataset.nodes, dataset.edges, (e) => inScope(e) && !isVehicle(e) && profileFlag(e, profile) === true && profileFlag(nodes.get(e.source)!, profile) === true && profileFlag(nodes.get(e.target)!, profile) === true);
  const possible = adjacency(dataset.nodes, dataset.edges, (e) => inScope(e) && !isVehicle(e) && profileFlag(e, profile) !== false && profileFlag(nodes.get(e.source)!, profile) !== false && profileFlag(nodes.get(e.target)!, profile) !== false);
  const floor = adjacency(dataset.nodes, dataset.edges, (e) => {
    const a = nodes.get(e.source)!, b = nodes.get(e.target)!;
    // Stair mesh terminals can stop short of the finished-floor elevation.
    // Storey identity and the semantic edge type define a floor access, not a guessed z tolerance.
    return !isVehicle(e) && e.edgeType !== "vertical_path" && !!a.storeyId && a.storeyId === b.storeyId;
  }, true);
  const scopedFloor = new Map([...floor].filter(([id]) => !excludedNodes.has(id)).map(([id, neighbours]) => [id, neighbours.filter((n) => !excludedNodes.has(n))]));
  const cases: ValidationCase[] = [], warnings: string[] = [];
  if (!dataset.validation?.inventory.spaces) warnings.push("No complete IfcSpace inventory: only spaces represented in the graph can be checked.");
  if (!dataset.validation?.inventory.doors) warnings.push("No door inventory: doors omitted by the export cannot be detected.");
  if (!dataset.validation?.inventory.vertical) warnings.push("No vertical-element inventory: checks for stops and flights are incomplete.");
  for (const [id, space] of spaces) {
    const members = spaceMembers.get(id) ?? [];
    const group = new Set(members);
    const connected = members.some((n) => (topo.get(n) ?? []).some((other) => !group.has(other)));
    const liftRepresentation = members.some((id) => nodes.get(id)?.nodeRole === "elevator_stop");
    const scope = scopes.get(id)!;
    const associatedDoors = dataset.validation?.doors.filter((d) => d.spaceIds.includes(id)).length ?? 0;
    const evidence = `${members.length} navigable nodes; ${associatedDoors} inventoried doors associated with this space. `;
    cases.push(caseFor("space_connection", id, spaceLabel(space), space.storeyId, scope.excluded ? "excluded" : members.length && connected ? "pass" : "fail", scope.excluded ? `${scope.reason} ${evidence}${connected ? "Connections exist in the exported graph; review whether these represent intended maintenance access." : "No external connection is present, which is consistent with this scope."}` : evidence + ( !members.length ? "The inventoried space has no navigable representative. Check whether it was omitted during graph extraction." : connected ? liftRepresentation ? "This IfcSpace is represented by a connected elevator stop. Its exit to the floor is checked separately." : "A connection links the space to an access or another space." : "No connection links this space to an access or another space."), { nodeIds: members, spaceIds: [id] }));
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
    cases.push(caseFor("door_connection", door.id, `Door · ${door.id}`, door.storeyId, nodes.has(door.id) && enough && connected === linkedSpaces.length ? "pass" : "fail", `${connected}/${linkedSpaces.length} associated sides reach the interior locally. Expected: ${door.exterior ? "at least 1 associated space for an exterior door" : "at least 2 associated spaces for an interior door"}.`, { nodeIds: [door.id], spaceIds: linkedSpaces }));
  }
  const allSpaceTargets = new Map<string, string>();
  for (const [spaceId, members] of spaceMembers) if (!scopes.get(spaceId)?.excluded) for (const id of members) allSpaceTargets.set(id, spaceId);
  for (const vertical of dataset.verticalFeatures) {
    if (vertical.routeType === "vehicle_only" || vertical.pedestrianAccess === false) continue;
    const kind = vertical.verticalType;
    if (!["stair", "elevator", "ramp"].includes(kind)) continue;
    const members = (children.get(vertical.verticalId) ?? []).filter((n) => n.nodeType === "internal_mobility");
    const ids = new Set(members.map((n) => n.id));
    const own = new Map(members.map((n) => [n.id, (topo.get(n.id) ?? []).filter((id) => ids.has(id))]));
    const seen = flood(own, members.length ? [members[0].id] : []);
    const connected = members.length >= 2 && seen.size === members.length;
    cases.push(caseFor("vertical_continuity", vertical.verticalId, `${kind === "stair" ? "Stair" : kind === "elevator" ? "Elevator" : "Ramp"} · ${vertical.verticalId}`, null, connected ? "pass" : "fail", `${seen.size}/${members.length} internal nodes are connected through this element’s own flights and landings.`, { nodeIds: [...ids], verticalIds: [vertical.verticalId] }));
    const shaftSpaceIds = new Set(Object.values(record(record(vertical.metadata.properties)["HSIMG.SourceSpaceIdsByStorey"])).flatMap(values));
    const terminals = members.filter((n) => ["landing", "elevator_stop"].includes(n.nodeRole));
    if (!vertical.storeyIds.length) cases.push(caseFor(`${kind}_floor`, vertical.verticalId, `${kind === "stair" ? "Stair" : kind === "elevator" ? "Elevator" : "Ramp"} · ${vertical.verticalId}`, null, "unknown", "No served floors are declared. Floors crossed geometrically are not assumed to be served.", { nodeIds: terminals.map((n) => n.id), verticalIds: [vertical.verticalId] }));
    for (const storeyId of vertical.storeyIds) {
      const stops = terminals.filter((n) => n.storeyId === storeyId);
      if (!stops.length) cases.push(caseFor(`${kind}_floor`, vertical.verticalId, `${kind === "stair" ? "Stair" : kind === "elevator" ? "Elevator" : "Ramp"} · ${vertical.verticalId}`, storeyId, "fail", "No terminal or stop exists on a floor declared as served. Check the exported stop inventory and storey assignments.", { verticalIds: [vertical.verticalId] }));
      for (const stop of stops) {
        const reachable = flood(scopedFloor, [stop.id]);
        const target = [...reachable].find((id) => allSpaceTargets.has(id) && !shaftSpaceIds.has(allSpaceTargets.get(id)!));
        cases.push(caseFor(`${kind}_floor`, vertical.verticalId, `${kind === "stair" ? "Stair" : kind === "elevator" ? "Elevator" : "Ramp"} · ${vertical.verticalId}`, storeyId, target ? "pass" : "fail", target ? "This terminal reaches a required space on the same floor without vertical travel." : "This terminal cannot reach a required space on its own floor without vertical travel. Its own elevator cabin and excluded spaces cannot satisfy this check.", { id: key(`${kind}_floor`, vertical.verticalId, storeyId, stop.id), nodeIds: [stop.id], verticalIds: [vertical.verticalId] }));
      }
    }
  }
  for (const n of dataset.nodes) if (n.nodeType === "internal_mobility" && n.mobilityType === "horizontal" && ["axis_endpoint", "axis_junction"].includes(n.nodeRole)) {
    const degree = new Set(topo.get(n.id) ?? []).size;
    cases.push(caseFor("internal_dead_end", n.id, `Internal node · ${n.id}`, n.storeyId, degree <= 1 ? "fail" : "pass", `${degree} distinct neighbours. Nodes with a protected access role are not checked by this rule.`, { nodeIds: [n.id] }));
  }
  const duplicates = new Map<string, number>();
  for (const edge of dataset.edges) {
    const a = nodes.get(edge.source), b = nodes.get(edge.target);
    const length = edge.metadata.length_3d ?? edge.raw.length_3d;
    const invalid = !a || !b || edge.source === edge.target || ![a.x, a.y, a.z, b.x, b.y, b.z, ...edge.points.flat()].every(Number.isFinite) || (length !== undefined && length !== null && (!Number.isFinite(Number(length)) || Number(length) < 0));
    cases.push(caseFor("edge_integrity", edge.id, edge.edgeType, a?.storeyId ?? null, invalid ? "fail" : "pass", invalid ? "Missing endpoint, self-loop, non-finite coordinate or invalid length. Inspect the referenced endpoint IDs and geometry." : "Endpoints and geometry are numerically valid.", { nodeIds: [edge.source, edge.target] }));
    const signature = key(edge.source, edge.target, edge.edgeType, edge.mobilityMode, edge.points);
    const count = duplicates.get(signature) ?? 0;
    duplicates.set(signature, count + 1);
    cases.push(caseFor("duplicate_connection", edge.id, edge.edgeType, a?.storeyId ?? null, count ? "fail" : "pass", count ? "An earlier arc has identical ordered endpoints, type, mode and polyline." : "No earlier identical arc exists.", { nodeIds: [edge.source, edge.target] }));
  }
  const entrances: EntranceResult[] = doors.filter((d) => d.entrance).map((door) => {
    const start = nodes.get(door.id);
    const certainly = flood(strict, start && profileFlag(start, profile) === true ? [door.id] : []);
    const maybe = flood(possible, start && profileFlag(start, profile) !== false ? [door.id] : []);
    const rows = [...spaces].map(([id, space]) => {
      const members = spaceMembers.get(id) ?? [];
      const reached = members.some((n) => certainly.has(n));
      const possibleReach = members.some((n) => maybe.has(n));
      const scope = scopes.get(id)!;
      const status: Status = scope.excluded ? "excluded" : reached ? "pass" : possibleReach ? "unknown" : "fail";
      return caseFor("entrance_reachability", id, spaceLabel(space), space.storeyId, status, scope.excluded ? scope.reason + " Excluded from route destinations and transit; no access failure is assigned." : reached ? "A directed route with known permissions reaches this space for the selected profile." : possibleReach ? "A route exists only if unknown accessibility attributes are accepted." : !start ? "The inventoried exterior door has no node in the graph; a route cannot start from it." : "No directed route reaches this space for the selected profile. Check connections, arc directions and access restrictions.", { id: key("entrance_reachability", profile, door.id, id), nodeIds: members, spaceIds: [id], entranceId: door.id });
    });
    return { door, cases: rows, reachable: rows.filter((r) => r.status === "pass").length, unreachable: rows.filter((r) => r.status === "fail").length, unknown: rows.filter((r) => r.status === "unknown").length, excluded: rows.filter((r) => r.status === "excluded").length };
  });
  if (!entrances.length) warnings.push("No exterior doors are identified; exterior reachability cannot be evaluated.");
  return { cases, entrances, warnings, spaceMembers, scopes };
}

export function summarize(cases: ValidationCase[]) {
  return Object.entries(RULES).map(([rule, config]) => {
    const rows = cases.filter((c) => c.rule === rule);
    return { rule, label: config.label, total: rows.length, pass: rows.filter((c) => c.status === "pass").length, fail: rows.filter((c) => c.status === "fail").length, unknown: rows.filter((c) => c.status === "unknown").length, outOfScope: rows.filter((c) => c.status === "excluded").length };
  }).filter((r) => r.total);
}

export function metrics(cases: ValidationCase[], labels: ReferenceLabels) {
  let tp = 0, fp = 0, fn = 0, tn = 0, excluded = 0;
  for (const c of cases) {
    const label = labels[c.id];
    if (!label || c.status === "unknown" || c.status === "excluded") { excluded++; continue; }
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

export function importReference(text: string, fingerprint: string, validIds: Set<string>, overrides: ScopeOverrides = {}): ReferenceLabels {
  const value = JSON.parse(text);
  if (value.schema !== "hsimg-validation-reference" || value.version !== VALIDATION_VERSION || value.fingerprint !== fingerprint) throw new Error("The reference does not match this dataset and validator version.");
  if (!value.labels || typeof value.labels !== "object" || Array.isArray(value.labels)) throw new Error("The reference contains no valid labels.");
  if (scopeKey(value.scopeOverrides ?? {}) !== scopeKey(overrides)) throw new Error("The reference uses a different validation scope. Restore the matching space overrides before importing it.");
  const result: ReferenceLabels = {};
  for (const [id, label] of Object.entries(value.labels)) {
    if (!validIds.has(id) || !["anomaly", "normal"].includes(String(label))) throw new Error("The reference contains unknown cases or labels. Check the selected mobility profile as well.");
    result[id] = label as "anomaly" | "normal";
  }
  return result;
}

import type { GraphDataset, GraphEdge, GraphNode, VisibilityState } from "./types";
import { NODE_COLORS, VERTICAL_MOBILITY_COLOR } from "./types";

export const EXTERIOR_DOOR_COLOR = "#f2b705";
export const DOOR_SIDE_COLOR = "#f39aa5";
export const EXTERIOR_DOOR_SIDE_COLOR = "#f7cf55";

export function hasPositiveInout(node: GraphNode): boolean {
  const value = node.raw.inout ?? node.metadata.inout;
  return value === true || value === 1 || String(value).trim() === "1";
}

export function isDoorSideNode(node: GraphNode): boolean {
  return node.nodeType === "door_access" || node.nodeRole === "door_side";
}

export function isExteriorDoorNode(node: GraphNode): boolean {
  return node.nodeType === "door" && hasPositiveInout(node);
}

export function isOrphanDoorNode(node: GraphNode): boolean {
  const value = node.raw.orphan_external ?? node.metadata.orphan_external;
  return node.nodeType === "door"
    && (value === true || value === 1 || String(value).trim() === "1");
}

export function isExteriorDoorAccessNode(node: GraphNode): boolean {
  return (node.nodeType === "door" || node.nodeType === "door_access")
    && hasPositiveInout(node);
}

export function isVerticalMobilityNode(node: GraphNode): boolean {
  const mobilityType = (node.mobilityType ?? "").toLowerCase();
  return node.nodeType === "vertical_mobility"
    || ["stair", "ramp", "elevator"].includes(mobilityType);
}

export function nodeColor(node: GraphNode): string {
  if (isOrphanDoorNode(node)) return "#7b8790";
  if (isDoorSideNode(node)) {
    return hasPositiveInout(node) ? EXTERIOR_DOOR_SIDE_COLOR : DOOR_SIDE_COLOR;
  }
  if (isExteriorDoorAccessNode(node)) return EXTERIOR_DOOR_COLOR;
  if (isVerticalMobilityNode(node)) return VERTICAL_MOBILITY_COLOR;
  return NODE_COLORS[node.category];
}

export function nodeVisible(node: GraphNode, visibility: VisibilityState): boolean {
  if (isOrphanDoorNode(node)) {
    return visibility.doorSides && visibility.access;
  }
  if (isDoorSideNode(node)) {
    return visibility.doorSides
      && (hasPositiveInout(node) ? visibility.exteriorDoors : visibility.access);
  }
  if (isExteriorDoorAccessNode(node)) return visibility.exteriorDoors;
  if (isVerticalMobilityNode(node)) {
    return visibility.verticalMobility
      && (node.category !== "internal" || visibility.internal);
  }
  return visibility[node.category];
}

export function edgeVisibleForMode(
  edge: GraphEdge,
  nodeById: Map<string, GraphNode>,
  expanded: boolean,
  visibility?: VisibilityState,
): boolean {
  if (edge.edgeType === "axis_attachment") return false;
  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);
  if (visibility && (
    (source && !nodeVisible(source, visibility))
    || (target && !nodeVisible(target, visibility))
  )) return false;
  if (expanded) return true;
  return source?.category !== "internal" && target?.category !== "internal";
}

export interface ConceptualMobilityLink {
  id: string;
  source: GraphNode;
  target: GraphNode;
}

export function conceptualDoorLinks(
  dataset: GraphDataset,
  expandedMobility: boolean,
): ConceptualMobilityLink[] {
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  const incident = new Map<string, GraphEdge[]>();
  for (const edge of dataset.edges) {
    for (const endpoint of [edge.source, edge.target]) {
      const list = incident.get(endpoint) ?? [];
      list.push(edge);
      incident.set(endpoint, list);
    }
  }
  const links: ConceptualMobilityLink[] = [];
  const seen = new Set<string>();
  for (const side of dataset.nodes.filter(isDoorSideNode)) {
    const door = side.parentNodeId ? nodeById.get(side.parentNodeId) : null;
    if (!door || door.nodeType !== "door") continue;
    for (const edge of incident.get(side.id) ?? []) {
      const otherId = edge.source === side.id ? edge.target : edge.source;
      if (otherId === door.id || edge.edgeType === "portal_transition") continue;
      let target = nodeById.get(otherId);
      if (!target) continue;
      if (!expandedMobility && target.category === "internal" && target.parentNodeId) {
        target = nodeById.get(target.parentNodeId) ?? target;
      }
      const id = `${door.id}|${target.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      links.push({ id, source: door, target });
    }
  }
  return links;
}

export function conceptualMobilityLinks(dataset: GraphDataset): ConceptualMobilityLink[] {
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  const parentBySubgraph = new Map<string, GraphNode>();
  for (const node of dataset.nodes) {
    if (!node.subgraphId || !node.parentNodeId || node.category !== "internal") continue;
    const parent = nodeById.get(node.parentNodeId);
    if (parent?.category === "mobility") parentBySubgraph.set(node.subgraphId, parent);
  }
  const links: ConceptualMobilityLink[] = [];
  const seen = new Set<string>();
  for (const node of dataset.nodes) {
    if (node.nodeType !== "door_access" || !node.subgraphId) continue;
    const parent = parentBySubgraph.get(node.subgraphId);
    if (!parent) continue;
    const id = `${parent.id}|${node.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    links.push({ id, source: parent, target: node });
  }
  return links;
}

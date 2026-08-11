import type { GraphDataset, GraphEdge, GraphNode, Point3, SpaceFeature } from "./types";
import { categoryForNode } from "./types";

const floorA = "Level 0";
const floorB = "Level 1";

function node(
  id: string,
  x: number,
  y: number,
  z: number,
  name: string,
  nodeType: string,
  mobilityType: string | null,
  storeyId: string,
  parentNodeId: string | null = null,
  nodeRole = "semantic_parent",
  hierarchyLevel = 0,
  inout = 0,
): GraphNode {
  const raw = {
    node_id: id,
    node_type: nodeType,
    node_role: nodeRole,
    mobility_type: mobilityType,
    parent_node_id: parentNodeId,
    hierarchy_level: hierarchyLevel,
    storey_id: storeyId,
    name,
    inout,
  };
  return {
    id,
    x,
    y,
    z,
    name,
    nodeType,
    nodeRole,
    mobilityType,
    parentNodeId,
    subgraphId: parentNodeId ? `subgraph-${parentNodeId}` : null,
    hierarchyLevel,
    storeyId,
    accessibleGeneral: true,
    accessibleWheelchair: nodeType !== "vertical_mobility" || mobilityType !== "stair",
    category: categoryForNode(raw),
    metadata: {
      demo: true,
      classification_source: mobilityType === "horizontal" ? "hybrid:semantic_keyword" : "demo",
      accessible_wheelchair: nodeType !== "vertical_mobility" || mobilityType !== "stair",
      inout,
    },
    raw,
  };
}

const nodes: GraphNode[] = [
  node("space-a", 1.7, 2.2, 0, "Laboratory", "space", null, floorA),
  node("corridor-0", 7.0, 2.2, 0, "Main corridor", "space", "horizontal", floorA),
  node("space-b", 12.0, 2.2, 0, "Meeting room", "space", null, floorA),
  node("door-a", 4.0, 2.2, 0, "Door L-01", "door", "access", floorA, null, "portal", 0, 1),
  node("axis-a", 5.2, 2.2, 0, "Corridor axis A", "internal_mobility", "horizontal", floorA, "corridor-0", "axis_endpoint", 2),
  node("axis-b", 9.2, 2.2, 0, "Corridor axis B", "internal_mobility", "horizontal", floorA, "corridor-0", "axis_endpoint", 2),
  node("lift", 7.0, 5.2, 1.7, "Central elevator", "vertical_mobility", "elevator", floorA),
  node("lift-0", 7.0, 5.2, 0, "Level 0 stop", "internal_mobility", "elevator", floorA, "lift", "elevator_stop", 2),
  node("space-c", 1.7, 2.2, 3.4, "Office", "space", null, floorB),
  node("corridor-1", 7.0, 2.2, 3.4, "Lobby", "space", "horizontal", floorB),
  node("space-d", 12.0, 2.2, 3.4, "Classroom", "space", null, floorB),
  node("lift-1", 7.0, 5.2, 3.4, "Level 1 stop", "internal_mobility", "elevator", floorB, "lift", "elevator_stop", 2),
];

function edge(id: string, source: string, target: string, points: Point3[], type = "walk"): GraphEdge {
  return {
    id,
    source,
    target,
    edgeType: type,
    mobilityMode: type === "vertical_path" ? "elevator" : "walk",
    subgraphId: null,
    points,
    accessibleGeneral: true,
    accessibleWheelchair: true,
    metadata: { demo: true },
    raw: {},
  };
}

const byId = new Map(nodes.map((item) => [item.id, item]));
function between(id: string, source: string, target: string, type?: string) {
  const a = byId.get(source)!;
  const b = byId.get(target)!;
  return edge(id, source, target, [[a.x, a.y, a.z], [b.x, b.y, b.z]], type);
}

const edges = [
  between("e1", "space-a", "door-a"),
  between("e2", "door-a", "axis-a"),
  between("e3", "axis-a", "axis-b", "internal_axis"),
  between("e4", "axis-b", "space-b"),
  between("e5", "axis-a", "lift-0"),
  between("e6", "lift-0", "lift-1", "vertical_path"),
  between("e7", "lift-1", "corridor-1"),
  between("e8", "space-c", "corridor-1"),
  between("e9", "corridor-1", "space-d"),
];

function rectangularSpace(id: string, name: string, storeyId: string, x: number, width: number, z: number): SpaceFeature {
  return {
    id,
    spaceNodeId: id,
    name,
    storeyId,
    nodeClass: id.includes("corridor") ? "horizontal_mobility" : "finalist",
    rings: [[[x, 0, z], [x + width, 0, z], [x + width, 4.4, z], [x, 4.4, z], [x, 0, z]]],
    metadata: { demo: true },
  };
}

const spaces = [
  rectangularSpace("space-a", "Laboratory", floorA, 0, 4, 0),
  rectangularSpace("corridor-0", "Main corridor", floorA, 4, 6, 0),
  rectangularSpace("space-b", "Meeting room", floorA, 10, 4, 0),
  rectangularSpace("space-c", "Office", floorB, 0, 4, 3.4),
  rectangularSpace("corridor-1", "Lobby", floorB, 4, 6, 3.4),
  rectangularSpace("space-d", "Classroom", floorB, 10, 4, 3.4),
];

export const DEMO_DATASET: GraphDataset = {
  name: "Demo model",
  sourceType: "demo",
  nodes,
  edges,
  spaces,
  verticalFeatures: [],
  storeys: [
    { id: floorA, label: "Level 0 · Ground floor (main entrance) · elevation 0.00 m", elevation: 0 },
    { id: floorB, label: "Level 1 · First floor · elevation 3.40 m", elevation: 3.4 },
  ],
  warnings: ["Demo view. Load a GeoPackage or JSON file to analyse your model."],
};

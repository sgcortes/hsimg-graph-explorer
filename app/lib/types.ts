export type NodeCategory = "finalist" | "mobility" | "internal" | "access";

export type Point3 = [number, number, number];

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  z: number;
  name: string;
  nodeType: string;
  nodeRole: string;
  mobilityType: string | null;
  parentNodeId: string | null;
  subgraphId: string | null;
  hierarchyLevel: number;
  storeyId: string | null;
  accessibleGeneral: boolean | null;
  accessibleWheelchair: boolean | null;
  category: NodeCategory;
  metadata: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  edgeType: string;
  mobilityMode: string;
  subgraphId: string | null;
  points: Point3[];
  accessibleGeneral: boolean | null;
  accessibleWheelchair: boolean | null;
  metadata: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface SpaceFeature {
  id: string;
  spaceNodeId: string;
  name: string;
  storeyId: string | null;
  nodeClass: string;
  rings: Point3[][];
  metadata: Record<string, unknown>;
}

export interface VerticalFeature {
  id: string;
  verticalId: string;
  name: string;
  verticalType: string;
  routeType: string;
  pedestrianAccess: boolean | null;
  vehicleAccess: boolean | null;
  storeyIds: string[];
  rings: Point3[][];
  paths: Point3[][];
  metadata: Record<string, unknown>;
}

export interface StoreyOption {
  id: string;
  label: string;
  elevation: number;
}

export interface GraphDataset {
  name: string;
  sourceType: "demo" | "json" | "gpkg";
  nodes: GraphNode[];
  edges: GraphEdge[];
  spaces: SpaceFeature[];
  verticalFeatures: VerticalFeature[];
  storeys: StoreyOption[];
  warnings: string[];
}

export interface VisibilityState {
  finalist: boolean;
  mobility: boolean;
  verticalMobility: boolean;
  internal: boolean;
  access: boolean;
  exteriorDoors: boolean;
  doorSides: boolean;
  edges: boolean;
  spaces: boolean;
}

export const NODE_COLORS: Record<NodeCategory, string> = {
  finalist: "#168f78",
  mobility: "#d97706",
  internal: "#4263eb",
  access: "#d1495b",
};

export const VERTICAL_MOBILITY_COLOR = "#0088ad";

export function categoryForNode(raw: Record<string, unknown>): NodeCategory {
  const nodeType = String(raw.node_type ?? raw.nodeType ?? "");
  const mobility = String(raw.mobility_type ?? raw.mobilityType ?? "");
  const hierarchy = Number(raw.hierarchy_level ?? raw.hierarchyLevel ?? 0);
  const role = String(raw.node_role ?? raw.nodeRole ?? "");

  if (
    nodeType === "vertical_mobility" ||
    (nodeType === "space" && mobility === "horizontal")
  ) {
    return "mobility";
  }
  if (hierarchy >= 2 || nodeType === "internal_mobility") {
    return "internal";
  }
  if (
    nodeType === "door" ||
    nodeType === "door_access" ||
    role === "portal" ||
    role === "door_side"
  ) {
    return "access";
  }
  return "finalist";
}

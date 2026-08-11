"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { GraphDataset, GraphEdge, GraphNode, NodeCategory, VisibilityState } from "../lib/types";
import {
  conceptualDoorLinks,
  conceptualMobilityLinks,
  edgeVisibleForMode,
  hasPositiveInout,
  isDoorSideNode,
  isExteriorDoorAccessNode,
  isVerticalMobilityNode,
  nodeColor,
  nodeVisible,
} from "../lib/graph-view";
import { GraphLegend } from "./GraphLegend";

interface Graph3DProps {
  dataset: GraphDataset;
  selectedNodeId: string | null;
  visibility: VisibilityState;
  linkViews: boolean;
  resetToken: number;
  onSelectNode: (nodeId: string) => void;
}

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  nodeMeshes: Map<RenderGroup, THREE.InstancedMesh>;
  edgeLinesExpanded: THREE.LineSegments;
  edgeLinesCollapsed: THREE.LineSegments;
  verticalEdgeLinesExpanded: THREE.LineSegments;
  verticalEdgeLinesCollapsed: THREE.LineSegments;
  spaceLines: THREE.LineSegments;
  selection: THREE.Mesh;
  center: THREE.Vector3;
  radius: number;
  viewDistance: number;
  animation: number;
  resizeObserver: ResizeObserver;
}

type RenderGroup = NodeCategory
  | "verticalMobility"
  | "verticalInternal"
  | "exteriorDoors"
  | "doorSides"
  | "exteriorDoorSides";

const RENDER_GROUPS: RenderGroup[] = [
  "finalist",
  "mobility",
  "verticalMobility",
  "verticalInternal",
  "internal",
  "access",
  "exteriorDoors",
  "doorSides",
  "exteriorDoorSides",
];

function renderGroupForNode(node: GraphNode): RenderGroup {
  if (isDoorSideNode(node)) {
    return hasPositiveInout(node) ? "exteriorDoorSides" : "doorSides";
  }
  if (isExteriorDoorAccessNode(node)) return "exteriorDoors";
  if (isVerticalMobilityNode(node)) {
    return node.category === "internal" ? "verticalInternal" : "verticalMobility";
  }
  return node.category;
}

function categoryForRenderGroup(group: RenderGroup): NodeCategory {
  if (group === "verticalMobility") return "mobility";
  if (group === "verticalInternal") return "internal";
  if (group === "exteriorDoors" || group === "doorSides" || group === "exteriorDoorSides") {
    return "access";
  }
  return group;
}

function renderGroupVisible(group: RenderGroup, visibility: VisibilityState): boolean {
  if (group === "verticalMobility") return visibility.verticalMobility;
  if (group === "verticalInternal") return visibility.verticalMobility && visibility.internal;
  if (group === "exteriorDoors") return visibility.exteriorDoors;
  if (group === "doorSides") return visibility.doorSides && visibility.access;
  if (group === "exteriorDoorSides") return visibility.doorSides && visibility.exteriorDoors;
  return visibility[group];
}

function geometryFor(category: NodeCategory, group: RenderGroup) {
  if (group === "doorSides" || group === "exteriorDoorSides") {
    return new THREE.SphereGeometry(0.11, 10, 8);
  }
  if (category === "mobility") return new THREE.OctahedronGeometry(0.26, 0);
  if (category === "access") return new THREE.BoxGeometry(0.22, 0.22, 0.22);
  return new THREE.SphereGeometry(category === "internal" ? 0.105 : 0.19, 10, 8);
}

function isVerticalConnection(edge: GraphEdge, byId: Map<string, GraphNode>): boolean {
  const source = byId.get(edge.source);
  const target = byId.get(edge.target);
  const semantic = [
    edge.edgeType,
    edge.mobilityMode,
    edge.metadata.mobility_type,
    edge.metadata.connection_type,
    edge.raw.mobility_type,
    edge.raw.edge_type,
  ].map((value) => String(value ?? "").toLowerCase()).join(" ");
  const hasVerticalSemantics = /vertical|stair|ramp|elevator|lift|escalator/.test(semantic)
    || Boolean(source && isVerticalMobilityNode(source))
    || Boolean(target && isVerticalMobilityNode(target));
  const zValues = edge.points.length
    ? edge.points.map((point) => point[2])
    : [source?.z, target?.z].filter((value): value is number => value !== undefined);
  const verticalSpan = zValues.length > 1 ? Math.max(...zValues) - Math.min(...zValues) : 0;
  const crossesStoreys = Boolean(source?.storeyId && target?.storeyId && source.storeyId !== target.storeyId);
  return (hasVerticalSemantics && verticalSpan > 0.05)
    || (crossesStoreys && verticalSpan > 0.5);
}

function edgePositionsFor(
  dataset: GraphDataset,
  center: THREE.Vector3,
  expanded: boolean,
  visibility?: VisibilityState,
  connectionKind: "regular" | "vertical" = "regular",
) {
  const byId = new Map(dataset.nodes.map((node) => [node.id, node]));
  const positions: number[] = [];
  for (const edge of dataset.edges) {
    if (!edgeVisibleForMode(edge, byId, expanded, visibility)) continue;
    const vertical = isVerticalConnection(edge, byId);
    if ((connectionKind === "vertical") !== vertical) continue;
    const points = edge.points.length
      ? edge.points
      : [byId.get(edge.source), byId.get(edge.target)]
          .filter(Boolean)
          .map((node) => [node!.x, node!.y, node!.z] as [number, number, number]);
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      positions.push(
        a[0] - center.x, a[2] - center.y, -a[1] - center.z,
        b[0] - center.x, b[2] - center.y, -b[1] - center.z,
      );
    }
  }
  if (connectionKind === "regular" && visibility && !visibility.doorSides) {
    for (const link of conceptualDoorLinks(dataset, expanded)) {
      if (!nodeVisible(link.source, visibility) || !nodeVisible(link.target, visibility)) continue;
      positions.push(
        link.source.x - center.x, link.source.z - center.y, -link.source.y - center.z,
        link.target.x - center.x, link.target.z - center.y, -link.target.y - center.z,
      );
    }
  }
  if (connectionKind === "regular" && !expanded) {
    for (const link of conceptualMobilityLinks(dataset)) {
      if (visibility && (
        !nodeVisible(link.source, visibility) || !nodeVisible(link.target, visibility)
      )) continue;
      positions.push(
        link.source.x - center.x, link.source.z - center.y, -link.source.y - center.z,
        link.target.x - center.x, link.target.z - center.y, -link.target.y - center.z,
      );
    }
  }
  return positions;
}

export function Graph3D({
  dataset,
  selectedNodeId,
  visibility,
  linkViews,
  resetToken,
  onSelectNode,
}: Graph3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<SceneState | null>(null);
  const onSelectRef = useRef(onSelectNode);

  useEffect(() => {
    onSelectRef.current = onSelectNode;
  }, [onSelectNode]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#ffffff");
    const camera = new THREE.PerspectiveCamera(44, 1, 0.05, 50000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.5;
    controls.maxDistance = 50000;

    scene.add(new THREE.HemisphereLight("#ffffff", "#d8e1e6", 1.5));
    const keyLight = new THREE.DirectionalLight("#ffffff", 1.35);
    keyLight.position.set(8, 14, 10);
    scene.add(keyLight);

    const allPositions = dataset.nodes.map((node) => new THREE.Vector3(node.x, node.z, -node.y));
    const bounds = new THREE.Box3().setFromPoints(allPositions);
    const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    const size = bounds.isEmpty() ? new THREE.Vector3(10, 5, 10) : bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.54, 3);
    const nodeScale = Math.max(radius * 0.028, 0.85);
    const matrix = new THREE.Matrix4();
    const scaleMatrix = new THREE.Matrix4().makeScale(nodeScale, nodeScale, nodeScale);
    const nodeMeshes = new Map<RenderGroup, THREE.InstancedMesh>();

    for (const group of RENDER_GROUPS) {
      const category = categoryForRenderGroup(group);
      const members = dataset.nodes.filter((node) => renderGroupForNode(node) === group);
      const material = new THREE.MeshStandardMaterial({
        color: "#ffffff",
        emissive: "#000000",
        emissiveIntensity: 0,
        roughness: 0.52,
        metalness: 0.08,
      });
      if (!members.length) continue;
      const mesh = new THREE.InstancedMesh(geometryFor(category, group), material, members.length);
      mesh.name = `nodes-${group}`;
      mesh.userData.nodeIds = members.map((node) => node.id);
      members.forEach((node, index) => {
        matrix.makeTranslation(node.x - center.x, node.z - center.y, -node.y - center.z);
        matrix.multiply(scaleMatrix);
        mesh.setMatrixAt(index, matrix);
        mesh.setColorAt(
          index,
          new THREE.Color(nodeColor(node)),
        );
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
      nodeMeshes.set(group, mesh);
    }

    const makeEdgeLines = (expanded: boolean, vertical = false) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          edgePositionsFor(dataset, center, expanded, undefined, vertical ? "vertical" : "regular"),
          3,
        ),
      );
      const lines = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({
          color: vertical ? "#d62828" : expanded ? "#607985" : "#b86b12",
          transparent: true,
          opacity: vertical ? 0.96 : expanded ? 0.58 : 0.68,
          depthTest: !vertical,
        }),
      );
      if (vertical) lines.renderOrder = 10;
      return lines;
    };
    const edgeLinesExpanded = makeEdgeLines(true);
    const edgeLinesCollapsed = makeEdgeLines(false);
    const verticalEdgeLinesExpanded = makeEdgeLines(true, true);
    const verticalEdgeLinesCollapsed = makeEdgeLines(false, true);
    scene.add(
      edgeLinesExpanded,
      edgeLinesCollapsed,
      verticalEdgeLinesExpanded,
      verticalEdgeLinesCollapsed,
    );

    const spacePositions: number[] = [];
    for (const space of dataset.spaces) {
      for (const ring of space.rings) {
        for (let index = 0; index < ring.length - 1; index += 1) {
          const a = ring[index];
          const b = ring[index + 1];
          spacePositions.push(
            a[0] - center.x, a[2] - center.y, -a[1] - center.z,
            b[0] - center.x, b[2] - center.y, -b[1] - center.z,
          );
        }
      }
    }
    const spaceGeometry = new THREE.BufferGeometry();
    spaceGeometry.setAttribute("position", new THREE.Float32BufferAttribute(spacePositions, 3));
    const spaceLines = new THREE.LineSegments(
      spaceGeometry,
      new THREE.LineBasicMaterial({ color: "#8aa0aa", transparent: true, opacity: 0.58 }),
    );
    scene.add(spaceLines);

    const gridSize = Math.max(Math.ceil(Math.max(size.x, size.z) / 10) * 10, 10);
    const grid = new THREE.GridHelper(gridSize, 20, "#c2cdd3", "#e2e8eb");
    grid.position.y = -center.y - 0.05;
    scene.add(grid);

    const selection = new THREE.Mesh(
      new THREE.SphereGeometry(0.36 * nodeScale, 16, 12),
      new THREE.MeshBasicMaterial({ color: "#17232b", wireframe: true, transparent: true, opacity: 0.95 }),
    );
    selection.visible = false;
    scene.add(selection);

    let viewDistance = radius * 3;
    const resetView = () => {
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      const limitingFov = Math.max(Math.min(verticalFov, horizontalFov), 0.2);
      viewDistance = (radius / Math.sin(limitingFov / 2)) * 1.12;
      const direction = new THREE.Vector3(1.15, 0.84, 1.2).normalize();
      camera.position.copy(direction.multiplyScalar(viewDistance));
      controls.target.set(0, 0, 0);
      camera.near = Math.max(radius / 1000, 0.02);
      camera.far = Math.max(viewDistance + radius * 12, 1000);
      camera.updateProjectionMatrix();
      controls.update();
    };

    const resize = () => {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();
    resetView();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const intersections = raycaster.intersectObjects([...nodeMeshes.values()], false);
      const hit = intersections[0];
      if (hit?.instanceId !== undefined) {
        const ids = hit.object.userData.nodeIds as string[];
        const id = ids[hit.instanceId];
        if (id) onSelectRef.current(id);
      }
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      const animation = requestAnimationFrame(animate);
      if (stateRef.current) stateRef.current.animation = animation;
    };

    stateRef.current = {
      renderer,
      scene,
      camera,
      controls,
      nodeMeshes,
      edgeLinesExpanded,
      edgeLinesCollapsed,
      verticalEdgeLinesExpanded,
      verticalEdgeLinesCollapsed,
      spaceLines,
      selection,
      center,
      radius,
      viewDistance,
      animation: requestAnimationFrame(animate),
      resizeObserver,
    };

    return () => {
      const state = stateRef.current;
      if (state) cancelAnimationFrame(state.animation);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      stateRef.current = null;
    };
  }, [dataset]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    for (const group of RENDER_GROUPS) {
      const mesh = state.nodeMeshes.get(group);
      if (mesh) mesh.visible = renderGroupVisible(group, visibility);
    }
    state.edgeLinesExpanded.visible = visibility.edges && visibility.internal;
    state.edgeLinesCollapsed.visible = visibility.edges && !visibility.internal;
    state.verticalEdgeLinesExpanded.visible = visibility.edges
      && visibility.verticalMobility
      && visibility.internal;
    state.verticalEdgeLinesCollapsed.visible = visibility.edges
      && visibility.verticalMobility
      && !visibility.internal;
    state.edgeLinesExpanded.geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(edgePositionsFor(dataset, state.center, true, visibility), 3),
    );
    state.edgeLinesCollapsed.geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(edgePositionsFor(dataset, state.center, false, visibility), 3),
    );
    state.verticalEdgeLinesExpanded.geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        edgePositionsFor(dataset, state.center, true, visibility, "vertical"),
        3,
      ),
    );
    state.verticalEdgeLinesCollapsed.geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        edgePositionsFor(dataset, state.center, false, visibility, "vertical"),
        3,
      ),
    );
    state.edgeLinesExpanded.geometry.computeBoundingSphere();
    state.edgeLinesCollapsed.geometry.computeBoundingSphere();
    state.verticalEdgeLinesExpanded.geometry.computeBoundingSphere();
    state.verticalEdgeLinesCollapsed.geometry.computeBoundingSphere();
    state.spaceLines.visible = visibility.spaces;
  }, [dataset, visibility]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const node = dataset.nodes.find((item) => item.id === selectedNodeId);
    state.selection.visible = Boolean(node && nodeVisible(node, visibility));
    if (node) {
      state.selection.position.set(
        node.x - state.center.x,
        node.z - state.center.y,
        -node.y - state.center.z,
      );
    }
  }, [dataset, selectedNodeId, visibility]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state || !linkViews || !selectedNodeId) return;
    const node = dataset.nodes.find((item) => item.id === selectedNodeId);
    if (!node) return;
    const target = new THREE.Vector3(
      node.x - state.center.x,
      node.z - state.center.y,
      -node.y - state.center.z,
    );
    const displacement = target.clone().sub(state.controls.target);
    state.camera.position.add(displacement);
    state.controls.target.copy(target);
    state.controls.update();
  }, [dataset, linkViews, selectedNodeId]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const direction = new THREE.Vector3(1.15, 0.84, 1.2).normalize();
    state.camera.position.copy(direction.multiplyScalar(state.viewDistance));
    state.controls.target.set(0, 0, 0);
    state.controls.update();
  }, [resetToken]);

  return (
    <div
      ref={mountRef}
      className="viewport-canvas graph-3d"
      data-testid="graph-3d"
      role="img"
      aria-label="Interactive 3D mobility graph"
    >
      <GraphLegend />
    </div>
  );
}

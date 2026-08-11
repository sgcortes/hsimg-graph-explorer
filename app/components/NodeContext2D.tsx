"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphDataset, GraphNode } from "../lib/types";
import { NODE_COLORS } from "../lib/types";
import { isDoorSideNode, isExteriorDoorNode, nodeColor } from "../lib/graph-view";

interface NodeContext2DProps {
  dataset: GraphDataset;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

export function NodeContext2D({ dataset, selectedNodeId, onSelectNode }: NodeContext2DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const screenNodesRef = useRef<Array<{ id: string; x: number; y: number }>>([]);
  const [size, setSize] = useState({ width: 500, height: 260 });
  const byId = useMemo(() => new Map(dataset.nodes.map((node) => [node.id, node])), [dataset]);
  const selected = selectedNodeId ? byId.get(selectedNodeId) ?? null : null;

  const context = useMemo(() => {
    if (!selected) {
      return {
        nodes: [] as GraphNode[],
        edges: dataset.edges.slice(0, 0),
        spaces: dataset.spaces.slice(0, 0),
        mode: "No selection",
      };
    }

    const parent = selected.parentNodeId ? byId.get(selected.parentNodeId) : null;
    const doorRoot = selected.nodeType === "door"
      ? selected
      : isDoorSideNode(selected) && parent?.nodeType === "door"
        ? parent
        : null;
    const mobilityRoot = selected.category === "mobility"
      ? selected
      : selected.category === "internal" && parent?.category === "mobility"
        ? parent
        : null;
    const nodeIds = new Set<string>();
    const adjacentSpaceIds = new Set<string>();

    if (doorRoot) {
      nodeIds.add(doorRoot.id);
      const doorSides = dataset.nodes.filter((node) =>
        isDoorSideNode(node) && node.parentNodeId === doorRoot.id);
      for (const side of doorSides) {
        nodeIds.add(side.id);
        const spaceId = side.metadata.space_id;
        if (typeof spaceId === "string") adjacentSpaceIds.add(spaceId);
        for (const edge of dataset.edges) {
          if (edge.source !== side.id && edge.target !== side.id) continue;
          const otherId = edge.source === side.id ? edge.target : edge.source;
          if (otherId !== doorRoot.id) nodeIds.add(otherId);
        }
      }
    } else if (mobilityRoot) {
      nodeIds.add(mobilityRoot.id);
      for (const node of dataset.nodes) {
        if (node.parentNodeId === mobilityRoot.id) nodeIds.add(node.id);
      }
    } else if (selected.category === "finalist") {
      nodeIds.add(selected.id);
      for (const edge of dataset.edges) {
        if (edge.source === selected.id) nodeIds.add(edge.target);
        if (edge.target === selected.id) nodeIds.add(edge.source);
      }
    } else {
      nodeIds.add(selected.id);
    }

    const nodes = dataset.nodes.filter((node) => nodeIds.has(node.id));
    const edges = dataset.edges.filter((edge) =>
      edge.edgeType !== "axis_attachment"
      && nodeIds.has(edge.source)
      && nodeIds.has(edge.target));
    const connectionCount = new Set(edges.map((edge) => {
      const endpoints = [edge.source, edge.target].sort();
      return `${endpoints[0]}|${endpoints[1]}|${edge.edgeType}`;
    })).size;
    const boundaryNodeId = mobilityRoot?.id ?? selected.id;
    const spaces = dataset.spaces.filter((space) =>
      doorRoot
        ? adjacentSpaceIds.has(space.spaceNodeId)
        : space.spaceNodeId === boundaryNodeId);
    const boundaryLabel = spaces.length ? "with spatial boundary" : "without spatial boundary; use a GeoPackage";
    return {
      nodes,
      edges,
      spaces,
      mode: doorRoot
        ? `Door detail · ${nodes.filter(isDoorSideNode).length} side nodes · ${spaces.length} adjacent spaces`
        : mobilityRoot
        ? `Internal subgraph · ${Math.max(nodes.length - 1, 0)} nodes · ${connectionCount} connections · ${boundaryLabel}`
        : selected.category === "finalist"
          ? `Immediate surroundings · ${Math.max(nodes.length - 1, 0)} nearby nodes · ${boundaryLabel}`
          : `Selected node · ${boundaryLabel}`,
    };
  }, [byId, dataset, selected]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(() => {
      setSize({ width: Math.max(wrapper.clientWidth, 1), height: Math.max(wrapper.clientHeight, 1) });
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.width, size.height);
    if (!context.nodes.length) {
      ctx.fillStyle = "#667984";
      ctx.textAlign = "center";
      ctx.font = "13px system-ui";
      ctx.fillText("Select a node in either view", size.width / 2, size.height / 2);
      return;
    }
    const geometryPoints = context.spaces.flatMap((space) =>
      space.rings.flatMap((ring) => ring.map((point) => ({ x: point[0], y: point[1] }))),
    );
    const xs = [...context.nodes.map((node) => node.x), ...geometryPoints.map((point) => point.x)];
    const ys = [...context.nodes.map((node) => node.y), ...geometryPoints.map((point) => point.y)];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const scale = Math.min(
      (size.width - 58) / Math.max(maxX - minX, 1),
      (size.height - 54) / Math.max(maxY - minY, 1),
      70,
    );
    const screen = (x: number, y: number) => ({
      x: size.width / 2 + (x - (minX + maxX) / 2) * scale,
      y: size.height / 2 - (y - (minY + maxY) / 2) * scale,
    });

    for (const space of context.spaces) {
      for (const ring of space.rings) {
        if (!ring.length) continue;
        ctx.beginPath();
        ring.forEach((point, index) => {
          const position = screen(point[0], point[1]);
          if (index === 0) ctx.moveTo(position.x, position.y);
          else ctx.lineTo(position.x, position.y);
        });
        ctx.closePath();
        ctx.fillStyle = space.nodeClass === "horizontal_mobility"
          ? "rgba(217,119,6,.10)"
          : "rgba(22,143,120,.065)";
        ctx.strokeStyle = space.nodeClass === "horizontal_mobility"
          ? "rgba(185,103,12,.86)"
          : "rgba(82,107,119,.76)";
        ctx.lineWidth = 2.2;
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.strokeStyle = "rgba(82,107,119,.66)";
    ctx.lineWidth = 1.7;
    for (const edge of context.edges) {
      const a = byId.get(edge.source);
      const b = byId.get(edge.target);
      if (!a || !b) continue;
      const points = edge.points.length
        ? edge.points
        : [[a.x, a.y, a.z], [b.x, b.y, b.z]];
      ctx.beginPath();
      points.forEach((coordinate, index) => {
        const point = screen(coordinate[0], coordinate[1]);
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    }
    const screenNodes: Array<{ id: string; x: number; y: number }> = [];
    const orderedNodes = context.nodes.slice().sort((a, b) => {
      if (a.id === selectedNodeId) return 1;
      if (b.id === selectedNodeId) return -1;
      return Number(a.category === "mobility") - Number(b.category === "mobility");
    });
    for (const node of orderedNodes) {
      const point = screen(node.x, node.y);
      const exteriorDoor = isExteriorDoorNode(node);
      const doorSide = isDoorSideNode(node);
      const radius = node.id === selectedNodeId
        ? 8
        : doorSide
          ? 4
          : node.category === "mobility"
            ? 7
            : node.category === "internal"
              ? 4
              : 5.5;
      ctx.beginPath();
      if (node.nodeType === "door") {
        ctx.rect(point.x - radius, point.y - radius, radius * 2, radius * 2);
      } else {
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      }
      ctx.fillStyle = exteriorDoor ? NODE_COLORS.access : nodeColor(node);
      ctx.fill();
      ctx.strokeStyle = node.id === selectedNodeId ? "#17232b" : "#ffffff";
      ctx.lineWidth = node.id === selectedNodeId ? 2.5 : 1;
      ctx.stroke();
      if (exteriorDoor) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = "#b57d00";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      screenNodes.push({ id: node.id, ...point });
    }
    screenNodesRef.current = screenNodes;
  }, [byId, context, selectedNodeId, size]);

  return (
    <div ref={wrapperRef} className="context-canvas" data-testid="node-context-2d">
      <canvas
        ref={canvasRef}
        aria-label="Internal subgraph or immediate surroundings with spatial boundaries"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          const nearest = screenNodesRef.current
            .map((node) => ({ ...node, distance: Math.hypot(node.x - x, node.y - y) }))
            .sort((a, b) => a.distance - b.distance)[0];
          if (nearest && nearest.distance < 13) onSelectNode(nearest.id);
        }}
      />
      <span className="context-mode">{context.mode}</span>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphDataset, GraphNode, VisibilityState } from "../lib/types";
import { NODE_COLORS, nodeDisplayLabel } from "../lib/types";
import {
  conceptualDoorLinks,
  conceptualMobilityLinks,
  edgeVisibleForMode,
  isDoorSideNode,
  isExteriorDoorNode,
  isVerticalMobilityNode,
  nodeColor,
  nodeVisible,
} from "../lib/graph-view";
import { GraphLegend } from "./GraphLegend";

interface FloorPlan2DProps {
  dataset: GraphDataset;
  storeyId: string | null;
  selectedNodeId: string | null;
  visibility: VisibilityState;
  linkViews: boolean;
  onSelectNode: (nodeId: string) => void;
}

interface Transform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

function nodeShape(
  ctx: CanvasRenderingContext2D,
  node: GraphNode,
  x: number,
  y: number,
  selected: boolean,
) {
  const doorSide = isDoorSideNode(node);
  const size = doorSide ? 3.2 : node.category === "mobility" ? 6.5 : node.category === "internal" ? 3.2 : 5;
  const exteriorDoor = isExteriorDoorNode(node);
  ctx.beginPath();
  if (doorSide) {
    ctx.arc(x, y, size, 0, Math.PI * 2);
  } else if (node.category === "mobility" || isVerticalMobilityNode(node)) {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
  } else if (node.category === "access") {
    ctx.rect(x - size, y - size, size * 2, size * 2);
  } else {
    ctx.arc(x, y, size, 0, Math.PI * 2);
  }
  ctx.fillStyle = exteriorDoor ? NODE_COLORS.access : nodeColor(node);
  ctx.fill();
  ctx.strokeStyle = selected ? "#17232b" : "#ffffff";
  ctx.lineWidth = selected ? 3 : 1.25;
  ctx.stroke();
  if (exteriorDoor) {
    ctx.strokeStyle = "#b57d00";
    ctx.lineWidth = 2;
    ctx.strokeRect(x - size - 3, y - size - 3, (size + 3) * 2, (size + 3) * 2);
  }
  if (selected) {
    ctx.beginPath();
    ctx.arc(x, y, size + 5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(23,35,43,.55)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

export function FloorPlan2D({
  dataset,
  storeyId,
  selectedNodeId,
  visibility,
  linkViews,
  onSelectNode,
}: FloorPlan2DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const screenNodesRef = useRef<Array<{ id: string; x: number; y: number }>>([]);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [size, setSize] = useState({ width: 700, height: 480 });

  const floorNodes = useMemo(
    () => dataset.nodes.filter((node) => !storeyId || node.storeyId === storeyId),
    [dataset, storeyId],
  );
  const floorSpaces = useMemo(
    () => dataset.spaces.filter((space) => !storeyId || space.storeyId === storeyId),
    [dataset, storeyId],
  );
  const floorVerticalFeatures = useMemo(
    () => dataset.verticalFeatures.filter((feature) =>
      feature.verticalType === "ramp"
      && (!storeyId || feature.storeyIds.includes(storeyId))),
    [dataset, storeyId],
  );
  const nodeById = useMemo(() => new Map(dataset.nodes.map((node) => [node.id, node])), [dataset]);
  const floorEdges = useMemo(
    () => dataset.edges.filter((edge) => {
      if (!storeyId) return true;
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      return source?.storeyId === storeyId
        && target?.storeyId === storeyId
        && edgeVisibleForMode(edge, nodeById, visibility.internal, visibility);
    }),
    [dataset, nodeById, storeyId, visibility],
  );
  const floorConceptualLinks = useMemo(
    () => {
      const links = [
        ...(!visibility.internal ? conceptualMobilityLinks(dataset) : []),
        ...(!visibility.doorSides ? conceptualDoorLinks(dataset, visibility.internal) : []),
      ];
      return links.filter((link) =>
          (!storeyId || link.source.storeyId === storeyId)
          && (!storeyId || link.target.storeyId === storeyId)
          && nodeVisible(link.source, visibility)
          && nodeVisible(link.target, visibility));
    },
    [dataset, storeyId, visibility],
  );

  const floorBounds = useMemo(() => {
    const points = [
      ...floorNodes.map((node) => [node.x, node.y] as [number, number]),
      ...floorSpaces.flatMap((space) => space.rings.flatMap((ring) =>
        ring.map((point) => [point[0], point[1]] as [number, number]))),
      ...floorVerticalFeatures.flatMap((feature) => [
        ...feature.rings.flatMap((ring) =>
          ring.map((point) => [point[0], point[1]] as [number, number])),
        ...feature.paths.flatMap((path) =>
          path.map((point) => [point[0], point[1]] as [number, number])),
      ]),
    ];
    if (!points.length) return null;
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    return {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
    };
  }, [floorNodes, floorSpaces, floorVerticalFeatures]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(() => {
      setSize({ width: Math.max(wrapper.clientWidth, 1), height: Math.max(wrapper.clientHeight, 1) });
    });
    observer.observe(wrapper);
    setSize({ width: Math.max(wrapper.clientWidth, 1), height: Math.max(wrapper.clientHeight, 1) });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!linkViews || !selectedNodeId || !floorBounds) return;
    const selected = floorNodes.find((node) => node.id === selectedNodeId);
    if (!selected) return;
    const frame = requestAnimationFrame(() => {
      const padding = 34;
      const baseScale = Math.min(
        (size.width - padding * 2) / Math.max(floorBounds.maxX - floorBounds.minX, 1),
        (size.height - padding * 2) / Math.max(floorBounds.maxY - floorBounds.minY, 1),
      );
      setView((current) => {
        const zoom = Math.max(current.zoom, 2.25);
        const middleX = (floorBounds.minX + floorBounds.maxX) / 2;
        const middleY = (floorBounds.minY + floorBounds.maxY) / 2;
        return {
          zoom,
          panX: (middleX - selected.x) * baseScale * zoom,
          panY: (selected.y - middleY) * baseScale * zoom,
        };
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [floorBounds, floorNodes, linkViews, selectedNodeId, size]);

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

    const points = [
      ...floorNodes.map((node) => [node.x, node.y] as [number, number]),
      ...floorSpaces.flatMap((space) => space.rings.flatMap((ring) => ring.map((p) => [p[0], p[1]] as [number, number]))),
      ...floorVerticalFeatures.flatMap((feature) => [
        ...feature.rings.flatMap((ring) => ring.map((p) => [p[0], p[1]] as [number, number])),
        ...feature.paths.flatMap((path) => path.map((p) => [p[0], p[1]] as [number, number])),
      ]),
    ];
    if (!points.length) {
      ctx.fillStyle = "#667984";
      ctx.font = "14px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("No geometry is available for this level", size.width / 2, size.height / 2);
      return;
    }
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const padding = 34;
    const baseScale = Math.min(
      (size.width - padding * 2) / Math.max(maxX - minX, 1),
      (size.height - padding * 2) / Math.max(maxY - minY, 1),
    );
    const transform: Transform = {
      scale: baseScale * view.zoom,
      offsetX: size.width / 2 - ((minX + maxX) / 2) * baseScale * view.zoom + view.panX,
      offsetY: size.height / 2 + ((minY + maxY) / 2) * baseScale * view.zoom + view.panY,
    };
    const screen = (x: number, y: number) => ({
      x: x * transform.scale + transform.offsetX,
      y: -y * transform.scale + transform.offsetY,
    });

    if (visibility.spaces) {
      for (const space of floorSpaces) {
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
            ? "rgba(217,119,6,.075)"
            : "rgba(84,112,124,.035)";
          ctx.strokeStyle = "rgba(77,103,115,.62)";
          ctx.lineWidth = 1.2;
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    if (visibility.verticalMobility) {
      for (const feature of floorVerticalFeatures) {
        const vehicleOnly = feature.routeType === "vehicle_only";
        for (const ring of feature.rings) {
          if (!ring.length) continue;
          ctx.beginPath();
          ring.forEach((point, index) => {
            const position = screen(point[0], point[1]);
            if (index === 0) ctx.moveTo(position.x, position.y);
            else ctx.lineTo(position.x, position.y);
          });
          ctx.closePath();
          ctx.fillStyle = vehicleOnly
            ? "rgba(190,24,24,.14)"
            : "rgba(0,136,173,.13)";
          ctx.strokeStyle = vehicleOnly ? "#b91c1c" : "#0088ad";
          ctx.lineWidth = 2;
          ctx.fill();
          ctx.stroke();
        }
        ctx.save();
        ctx.setLineDash([7, 4]);
        ctx.strokeStyle = vehicleOnly ? "#b91c1c" : "#0088ad";
        ctx.lineWidth = 2.4;
        for (const path of feature.paths) {
          if (path.length < 2) continue;
          ctx.beginPath();
          path.forEach((point, index) => {
            const position = screen(point[0], point[1]);
            if (index === 0) ctx.moveTo(position.x, position.y);
            else ctx.lineTo(position.x, position.y);
          });
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    if (visibility.edges) {
      ctx.strokeStyle = "rgba(82,107,119,.58)";
      ctx.lineWidth = 1.2;
      for (const edge of floorEdges) {
        const points3d = edge.points.length
          ? edge.points
          : [nodeById.get(edge.source), nodeById.get(edge.target)]
              .filter(Boolean)
              .map((node) => [node!.x, node!.y, node!.z] as [number, number, number]);
        if (points3d.length < 2) continue;
        ctx.beginPath();
        points3d.forEach((point, index) => {
          const position = screen(point[0], point[1]);
          if (index === 0) ctx.moveTo(position.x, position.y);
          else ctx.lineTo(position.x, position.y);
        });
        ctx.stroke();
      }
      if (floorConceptualLinks.length) {
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = "rgba(185,103,12,.78)";
        ctx.lineWidth = 1.5;
        for (const link of floorConceptualLinks) {
          const start = screen(link.source.x, link.source.y);
          const end = screen(link.target.x, link.target.y);
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    const screenNodes: Array<{ id: string; x: number; y: number }> = [];
    const visibleNodes = floorNodes
      .filter((node) => nodeVisible(node, visibility))
      .sort((a, b) => {
        if (a.id === selectedNodeId) return 1;
        if (b.id === selectedNodeId) return -1;
        return Number(a.category === "mobility") - Number(b.category === "mobility");
      });
    for (const node of visibleNodes) {
      const position = screen(node.x, node.y);
      nodeShape(ctx, node, position.x, position.y, node.id === selectedNodeId);
      screenNodes.push({ id: node.id, ...position });
    }
    screenNodesRef.current = screenNodes;

    const selected = floorNodes.find((node) => node.id === selectedNodeId);
    if (selected) {
      const position = screen(selected.x, selected.y);
      ctx.font = "500 12px system-ui";
      const text = nodeDisplayLabel(selected);
      const width = ctx.measureText(text).width + 16;
      const labelX = Math.min(Math.max(position.x - width / 2, 6), size.width - width - 6);
      const labelY = Math.max(position.y - 34, 8);
      ctx.fillStyle = "rgba(255,255,255,.96)";
      ctx.fillRect(labelX, labelY, width, 24);
      ctx.strokeStyle = "#aebfc8";
      ctx.strokeRect(labelX, labelY, width, 24);
      ctx.fillStyle = "#17232b";
      ctx.textAlign = "center";
      ctx.fillText(text, labelX + width / 2, labelY + 16);
    }
  }, [dataset, floorConceptualLinks, floorEdges, floorNodes, floorSpaces, floorVerticalFeatures, nodeById, selectedNodeId, size, view, visibility]);

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  return (
    <div ref={wrapperRef} className="viewport-canvas floor-plan" data-testid="floor-plan-2d">
      <canvas
        ref={canvasRef}
        aria-label="2D floor plan for the selected building level"
        onPointerDown={(event) => {
          const point = pointerPosition(event);
          dragRef.current = { ...point, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          const point = pointerPosition(event);
          const dx = point.x - dragRef.current.x;
          const dy = point.y - dragRef.current.y;
          if (Math.abs(dx) + Math.abs(dy) > 2) dragRef.current.moved = true;
          setView((current) => ({ ...current, panX: current.panX + dx, panY: current.panY + dy }));
          dragRef.current.x = point.x;
          dragRef.current.y = point.y;
        }}
        onPointerUp={(event) => {
          const point = pointerPosition(event);
          if (dragRef.current && !dragRef.current.moved) {
            const nearest = screenNodesRef.current
              .map((node) => ({ ...node, distance: Math.hypot(node.x - point.x, node.y - point.y) }))
              .sort((a, b) => a.distance - b.distance)[0];
            if (nearest && nearest.distance <= 14) onSelectNode(nearest.id);
          }
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onWheel={(event) => {
          event.preventDefault();
          const factor = event.deltaY < 0 ? 1.14 : 0.88;
          setView((current) => ({
            ...current,
            zoom: Math.min(Math.max(current.zoom * factor, 0.45), 12),
          }));
        }}
      />
      <GraphLegend />
      <div className="canvas-hint">Drag to pan · wheel to zoom · click to inspect</div>
    </div>
  );
}

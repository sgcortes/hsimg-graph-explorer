"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphDataset, Point3 } from "../lib/types";
import type { Status, ValidationCase } from "../lib/validation";
import { spaceLabel } from "../lib/validation";

const COLORS: Record<Status, string> = { fail: "#e63f59", pass: "#30b394", unknown: "#edae35", excluded: "#8f9ba8" };
const rank = { excluded: -1, pass: 0, unknown: 1, fail: 2 };
const path = (points: Point3[]) => points.map((p, i) => `${i ? "L" : "M"}${p[0]},${-p[1]}`).join(" ");
export interface ValidationLayers { graph: boolean; doors: boolean; stairs: boolean; elevators: boolean }

export function ValidationMap2D({ dataset, storeyId, cases, inspectionCases, selected, entranceId, layers, onLayersChange, onSelect }: {
  dataset: GraphDataset; storeyId: string | null; cases: ValidationCase[];
  inspectionCases: ValidationCase[]; layers: ValidationLayers; onLayersChange: (layers: ValidationLayers) => void;
  selected: ValidationCase | null; entranceId?: string; onSelect: (row: ValidationCase) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; box: number[]; scale: number; moved: boolean } | null>(null);
  const [zoom, setZoom] = useState<number[] | null>(null);
  const nodeById = useMemo(() => new Map(dataset.nodes.map((n) => [n.id, n])), [dataset]);
  const floorSpaces = useMemo(() => dataset.spaces.filter((s) => s.storeyId === storeyId), [dataset, storeyId]);
  const floorNodes = useMemo(() => dataset.nodes.filter((n) => n.storeyId === storeyId), [dataset, storeyId]);
  const elevation = dataset.storeys.find((s) => s.id === storeyId)?.elevation ?? 0;
  const verticals = dataset.verticalFeatures.filter((v) => v.storeyIds.includes(storeyId ?? "") && (v.verticalType !== "stair" || layers.stairs) && (v.verticalType !== "elevator" || layers.elevators));
  const inspection = useMemo(() => {
    const doors = new Map<string, ValidationCase>(), spaces = new Map<string, ValidationCase>(), vertical = new Map<string, ValidationCase>();
    for (const c of inspectionCases) {
      if (c.storeyId && c.storeyId !== storeyId) continue;
      if (c.rule === "door_connection") doors.set(c.entityId, c);
      if (c.rule === "space_connection") spaces.set(c.entityId, c);
      for (const id of c.verticalIds) if (!vertical.has(id) || rank[c.status] > rank[vertical.get(id)!.status]) vertical.set(id, c);
    }
    return { doors, spaces, vertical };
  }, [inspectionCases, storeyId]);
  const doors = useMemo(() => {
    const inventory = new Map(dataset.validation?.doors.map((d) => [d.id, d]) ?? []);
    for (const n of dataset.nodes) if (n.nodeType === "door" && !inventory.has(n.id)) inventory.set(n.id, { id: n.id, name: n.name, storeyId: n.storeyId, spaceIds: [], exterior: false, entrance: false, point: [n.x, n.y, n.z], metadata: n.metadata });
    return [...inventory.values()].filter((d) => d.storeyId === storeyId).map((d) => {
      const node = nodeById.get(d.id);
      return { ...d, point: d.point ?? (node ? [node.x, node.y, node.z] as Point3 : null) };
    });
  }, [dataset, nodeById, storeyId]);
  const maps = useMemo(() => {
    const spaces = new Map<string, ValidationCase>(), nodes = new Map<string, ValidationCase>(), vertical = new Map<string, ValidationCase>();
    const put = (map: Map<string, ValidationCase>, id: string, row: ValidationCase) => {
      if (!map.has(id) || rank[row.status] > rank[map.get(id)!.status]) map.set(id, row);
    };
    for (const c of cases) {
      if (c.storeyId && c.storeyId !== storeyId) continue;
      for (const id of c.spaceIds) put(spaces, id, c);
      for (const id of c.nodeIds) put(nodes, id, c);
      for (const id of c.verticalIds) put(vertical, id, c);
    }
    return { spaces, nodes, vertical };
  }, [cases, storeyId]);
  const bounds = useMemo(() => {
    const points = [...floorSpaces.flatMap((s) => s.rings.flat()), ...floorNodes.map((n) => [n.x, n.y, n.z] as Point3)];
    if (!points.length) return [0, 0, 100, 100];
    const xs = points.map((p) => p[0]), ys = points.map((p) => -p[1]);
    const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(2, Math.max(...xs) - x), h = Math.max(2, Math.max(...ys) - y);
    return [x - 3, y - 3, w + 6, h + 6];
  }, [floorNodes, floorSpaces]);
  const box = zoom ?? bounds;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const scale = event.deltaY > 0 ? 1.18 : 1 / 1.18;
      if (box[2] * scale < 2 || box[2] * scale > bounds[2] * 8) return;
      setZoom([p.x + (box[0] - p.x) * scale, p.y + (box[1] - p.y) * scale, box[2] * scale, box[3] * scale]);
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [box, bounds]);
  const focus = () => {
    if (!selected) return;
    const points = [
      ...floorSpaces.filter((s) => selected.spaceIds.includes(s.spaceNodeId)).flatMap((s) => s.rings.flat()),
      ...selected.nodeIds.map((id) => nodeById.get(id)).filter((n) => n?.storeyId === storeyId).map((n) => [n!.x, n!.y, n!.z] as Point3),
      ...verticals.filter((v) => selected.verticalIds.includes(v.verticalId)).flatMap((v) => v.paths.flat()),
      ...doors.filter((d) => selected.nodeIds.includes(d.id) && d.point).map((d) => d.point!),
    ];
    if (!points.length) return;
    const xs = points.map((p) => p[0]), ys = points.map((p) => -p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    setZoom([x - 3, y - 3, Math.max(8, Math.max(...xs) - x + 6), Math.max(8, Math.max(...ys) - y + 6)]);
  };
  const select = (row: ValidationCase | undefined) => { if (row && !drag.current?.moved) onSelect(row); };
  const entrance = doors.find((d) => d.id === entranceId);
  return <div className="validation-map-wrap">
    <div className="validation-map-actions">
      <span>Validation map · drag to pan, wheel to zoom</span>
      {([["graph", "Context graph"], ["doors", "Doors"], ["stairs", "Stairs"], ["elevators", "Elevators"]] as const).map(([id, label]) => <label key={id}><input type="checkbox" checked={layers[id]} onChange={(e) => onLayersChange({ ...layers, [id]: e.target.checked })} />{label}</label>)}
      <button className="secondary-button" onClick={() => setZoom(null)}>Fit floor</button>
      <button className="secondary-button" onClick={focus} disabled={!selected}>Focus selection</button>
    </div>
    <svg ref={svgRef} className="validation-map" viewBox={box.join(" ")} aria-label="Independent 2D validation map" role="img"
      onPointerDown={(e) => { const scale = svgRef.current?.getScreenCTM()?.a ?? 1; drag.current = { x: e.clientX, y: e.clientY, box: [...box], scale, moved: false }; }}
      onPointerMove={(e) => { const d = drag.current; if (!d || !e.buttons) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 4) { d.moved = true; setZoom([d.box[0] - dx / d.scale, d.box[1] - dy / d.scale, d.box[2], d.box[3]]); } }}
      onPointerUp={() => { setTimeout(() => { drag.current = null; }, 0); }}
      onPointerLeave={() => { drag.current = null; }}>
      <title>Spaces, doors and vertical elements by floor. The table provides the same information as text.</title>
      {floorSpaces.map((s) => {
        const scopeCase = inspection.spaces.get(s.spaceNodeId);
        const row = scopeCase?.status === "excluded" ? scopeCase : maps.spaces.get(s.spaceNodeId), chosen = selected?.spaceIds.includes(s.spaceNodeId);
        return <path key={s.id} data-layer="space" data-entity-id={s.spaceNodeId} d={s.rings.map((ring) => path(ring) + " Z").join(" ")} fillRule="evenodd" fill={row ? COLORS[row.status] : "#e9eef1"} fillOpacity={row ? 0.5 : 0.6} stroke={chosen ? "#222f88" : "#8198a5"} strokeWidth={chosen ? 3 : 0.7} vectorEffect="non-scaling-stroke" onClick={() => select(row ?? scopeCase)} data-status={row?.status ?? "context"}><title>{`${spaceLabel(s)} · ${row?.detail ?? "Context"}`}</title></path>;
      })}
      {layers.graph && dataset.edges.filter((e) => nodeById.get(e.source)?.storeyId === storeyId && nodeById.get(e.target)?.storeyId === storeyId).map((e) => <path key={e.id} data-layer="context" d={path(e.points)} fill="none" stroke="#466276" strokeOpacity=".35" strokeWidth=".7" vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
      {verticals.map((v) => {
        const row = maps.vertical.get(v.verticalId) ?? inspection.vertical.get(v.verticalId), color = row ? COLORS[row.status] : "#82949d";
        const stop = floorNodes.find((n) => n.parentNodeId === v.verticalId && ["landing", "elevator_stop"].includes(n.nodeRole));
        const point = stop ? [stop.x, stop.y, stop.z] : v.paths.flat().filter((p) => Math.abs(p[2] - elevation) < 0.6)[0] ?? v.paths[0]?.[0];
        return <g key={v.id} data-layer={v.verticalType} data-entity-id={v.verticalId} onClick={() => select(row)} data-status={row?.status ?? "context"}>
          {v.paths.map((points, i) => <path key={i} d={path(points)} fill="none" stroke={color} strokeWidth={row?.status === "fail" ? 4 : 2} vectorEffect="non-scaling-stroke" />)}
          {point && <><circle cx={point[0]} cy={-point[1]} r={0.7} fill={color} stroke={selected?.verticalIds.includes(v.verticalId) ? "#222f88" : "white"} strokeWidth="2" vectorEffect="non-scaling-stroke" /><text x={point[0]} y={-point[1] + 0.23} textAnchor="middle" fontSize=".65" fill="white" fontWeight="700">{v.verticalType === "elevator" ? "E" : v.verticalType === "stair" ? "S" : "R"}</text></>}
          <title>{`${v.verticalType} · ${v.verticalId} · ${row?.detail ?? "Context"}`}</title>
        </g>;
      })}
      {floorNodes.filter((n) => { const r = maps.nodes.get(n.id); return r && (r.status !== "pass" || selected?.nodeIds.includes(n.id)) && !r.verticalIds.length && !r.spaceIds.length && !["door", "door_access"].includes(n.nodeType) && !["stair", "elevator", "ramp"].includes(n.mobilityType ?? ""); }).map((n) => <circle key={n.id} cx={n.x} cy={-n.y} r={0.38} fill={COLORS[maps.nodes.get(n.id)!.status]} stroke={selected?.nodeIds.includes(n.id) ? "#222f88" : "white"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" onClick={() => select(maps.nodes.get(n.id))}><title>{`Node · ${n.id} · ${maps.nodes.get(n.id)?.detail}`}</title></circle>)}
      {layers.doors && doors.filter((d) => d.point).map((d) => {
        const row = inspection.doors.get(d.id);
        return <rect key={d.id} data-layer="door" data-entity-id={d.id} data-status={row?.status ?? "context"} x={d.point![0] - .36} y={-d.point![1] - .36} width=".72" height=".72" rx=".08" fill={row ? COLORS[row.status] : "#397dc1"} stroke={selected?.entityId === d.id ? "#222f88" : d.exterior ? "#c98700" : "white"} strokeWidth={d.exterior ? "2" : "1.2"} vectorEffect="non-scaling-stroke" onClick={() => select(row)}><title>{`Door · ${d.id} · ${row?.detail ?? "No local check available"}${!nodeById.has(d.id) ? " · Inventoried door without a graph node" : ""}`}</title></rect>;
      })}
      {layers.doors && entrance?.point && <g data-layer="origin"><circle cx={entrance.point[0]} cy={-entrance.point[1]} r="1" fill="#182961" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" /><text x={entrance.point[0]} y={-entrance.point[1] + .28} textAnchor="middle" fontSize=".85" fill="white">D</text><title>Selected exterior door</title></g>}
    </svg>
    <div className="validation-legend"><span><i style={{ background: COLORS.fail }} /> Issue / unreachable</span><span><i style={{ background: COLORS.pass }} /> Pass / reachable</span><span><i style={{ background: COLORS.unknown }} /> Unknown</span><span><i style={{ background: COLORS.excluded }} /> Excluded by scope</span><span><i style={{ background: "#e9eef1" }} /> Unchecked context</span><span>Square: door · gold outline: exterior</span><span>E: elevator · S: stair · R: ramp · D: origin</span></div>
    <p className="validation-map-note">Door and vertical-element colours show their local connection checks. Layer switches control visibility only; the context graph is independent and results are unchanged.</p>
    {layers.doors && doors.some((d) => !d.point) && <p className="validation-note">{doors.filter((d) => !d.point).length} doors have no coordinates and are listed in the table only.</p>}
    {!floorSpaces.length && <p className="validation-note">This floor has no space polygons. Available nodes and paths are shown.</p>}
  </div>;
}

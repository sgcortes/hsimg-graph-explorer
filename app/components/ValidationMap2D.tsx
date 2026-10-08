"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphDataset, Point3 } from "../lib/types";
import type { Status, ValidationCase } from "../lib/validation";

const COLORS: Record<Status, string> = { fail: "#e63f59", pass: "#30b394", unknown: "#edae35" };
const rank = { pass: 0, unknown: 1, fail: 2 };
const path = (points: Point3[]) => points.map((p, i) => `${i ? "L" : "M"}${p[0]},${-p[1]}`).join(" ");

export function ValidationMap2D({ dataset, storeyId, cases, selected, entranceId, onSelect }: {
  dataset: GraphDataset; storeyId: string | null; cases: ValidationCase[];
  selected: ValidationCase | null; entranceId?: string; onSelect: (row: ValidationCase) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; box: number[]; scale: number; moved: boolean } | null>(null);
  const [showGraph, setShowGraph] = useState(false);
  const [zoom, setZoom] = useState<number[] | null>(null);
  const nodeById = useMemo(() => new Map(dataset.nodes.map((n) => [n.id, n])), [dataset]);
  const floorSpaces = useMemo(() => dataset.spaces.filter((s) => s.storeyId === storeyId), [dataset, storeyId]);
  const floorNodes = useMemo(() => dataset.nodes.filter((n) => n.storeyId === storeyId), [dataset, storeyId]);
  const elevation = dataset.storeys.find((s) => s.id === storeyId)?.elevation ?? 0;
  const verticals = dataset.verticalFeatures.filter((v) => v.storeyIds.includes(storeyId ?? ""));
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
    ];
    if (!points.length) return;
    const xs = points.map((p) => p[0]), ys = points.map((p) => -p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    setZoom([x - 3, y - 3, Math.max(8, Math.max(...xs) - x + 6), Math.max(8, Math.max(...ys) - y + 6)]);
  };
  const select = (row: ValidationCase | undefined) => { if (row && !drag.current?.moved) onSelect(row); };
  const entrance = entranceId ? nodeById.get(entranceId) : null;
  return <div className="validation-map-wrap">
    <div className="validation-map-actions">
      <span>Plano de validación · arrastrar y rueda para ampliar</span>
      <label><input type="checkbox" checked={showGraph} onChange={(e) => setShowGraph(e.target.checked)} /> Grafo de contexto</label>
      <button className="secondary-button" onClick={() => setZoom(null)}>Encuadrar planta</button>
      <button className="secondary-button" onClick={focus} disabled={!selected}>Centrar selección</button>
    </div>
    <svg ref={svgRef} className="validation-map" viewBox={box.join(" ")} aria-label="Plano 2D independiente de validación" role="img"
      onPointerDown={(e) => { const scale = svgRef.current?.getScreenCTM()?.a ?? 1; drag.current = { x: e.clientX, y: e.clientY, box: [...box], scale, moved: false }; }}
      onPointerMove={(e) => { const d = drag.current; if (!d || !e.buttons) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 4) { d.moved = true; setZoom([d.box[0] - dx / d.scale, d.box[1] - dy / d.scale, d.box[2], d.box[3]]); } }}
      onPointerUp={() => { setTimeout(() => { drag.current = null; }, 0); }}
      onPointerLeave={() => { drag.current = null; }}>
      <title>Espacios y elementos verticales por planta; la tabla ofrece la misma información en texto.</title>
      {floorSpaces.map((s) => {
        const row = maps.spaces.get(s.spaceNodeId), chosen = selected?.spaceIds.includes(s.spaceNodeId);
        return <path key={s.id} d={s.rings.map((ring) => path(ring) + " Z").join(" ")} fillRule="evenodd" fill={row ? COLORS[row.status] : "#e9eef1"} fillOpacity={row ? 0.5 : 0.6} stroke={chosen ? "#222f88" : "#8198a5"} strokeWidth={chosen ? 3 : 0.7} vectorEffect="non-scaling-stroke" onClick={() => select(row)} data-status={row?.status ?? "context"}><title>{s.name} · {row?.detail ?? "Contexto"}</title></path>;
      })}
      {showGraph && dataset.edges.filter((e) => nodeById.get(e.source)?.storeyId === storeyId && nodeById.get(e.target)?.storeyId === storeyId).map((e) => <path key={e.id} d={path(e.points)} fill="none" stroke="#466276" strokeOpacity=".35" strokeWidth=".7" vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
      {verticals.map((v) => {
        const row = maps.vertical.get(v.verticalId), color = row ? COLORS[row.status] : "#82949d";
        const stop = floorNodes.find((n) => n.parentNodeId === v.verticalId && ["landing", "elevator_stop"].includes(n.nodeRole));
        const point = stop ? [stop.x, stop.y, stop.z] : v.paths.flat().filter((p) => Math.abs(p[2] - elevation) < 0.6)[0] ?? v.paths[0]?.[0];
        return <g key={v.id} onClick={() => select(row)} data-status={row?.status ?? "context"}>
          {v.paths.map((points, i) => <path key={i} d={path(points)} fill="none" stroke={color} strokeWidth={row?.status === "fail" ? 4 : 2} vectorEffect="non-scaling-stroke" />)}
          {point && <><circle cx={point[0]} cy={-point[1]} r={0.7} fill={color} stroke={selected?.verticalIds.includes(v.verticalId) ? "#222f88" : "white"} strokeWidth="2" vectorEffect="non-scaling-stroke" /><text x={point[0]} y={-point[1] + 0.23} textAnchor="middle" fontSize=".65" fill="white" fontWeight="700">{v.verticalType === "elevator" ? "A" : v.verticalType === "stair" ? "E" : "R"}</text></>}
          <title>{v.name} · {row?.detail ?? "Contexto"}</title>
        </g>;
      })}
      {floorNodes.filter((n) => { const r = maps.nodes.get(n.id); return r && (r.status !== "pass" || selected?.nodeIds.includes(n.id)) && !r.verticalIds.length && (n.nodeType === "door" || !r.spaceIds.length); }).map((n) => <circle key={n.id} cx={n.x} cy={-n.y} r={0.38} fill={COLORS[maps.nodes.get(n.id)!.status]} stroke={selected?.nodeIds.includes(n.id) ? "#222f88" : "white"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" onClick={() => select(maps.nodes.get(n.id))}><title>{n.name} · {maps.nodes.get(n.id)?.detail}</title></circle>)}
      {dataset.validation?.doors.filter((d) => d.storeyId === storeyId && !nodeById.has(d.id) && d.point && maps.nodes.has(d.id)).map((d) => <rect key={d.id} x={d.point![0] - .45} y={-d.point![1] - .45} width=".9" height=".9" fill={COLORS[maps.nodes.get(d.id)!.status]} onClick={() => select(maps.nodes.get(d.id))}><title>{d.name} · Puerta del inventario sin nodo de grafo</title></rect>)}
      {entrance?.storeyId === storeyId && <g><circle cx={entrance.x} cy={-entrance.y} r="1" fill="#182961" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" /><text x={entrance.x} y={-entrance.y + .28} textAnchor="middle" fontSize=".85" fill="white">P</text><title>Puerta exterior seleccionada</title></g>}
    </svg>
    <div className="validation-legend"><span><i style={{ background: COLORS.fail }} /> Incidencia / sin ruta</span><span><i style={{ background: COLORS.pass }} /> Conforme / con ruta</span><span><i style={{ background: COLORS.unknown }} /> No evaluable</span><span><i style={{ background: "#e9eef1" }} /> Sin comprobar en esta vista</span><span>A: ascensor · E: escalera · R: rampa · P: puerta de origen</span></div>
    {!floorSpaces.length && <p className="validation-note">Esta planta no dispone de polígonos de espacios. Se muestran los nodos y trazados disponibles.</p>}
  </div>;
}

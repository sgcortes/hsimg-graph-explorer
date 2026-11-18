"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphDataset, Point3 } from "../lib/types";
import type { Status, ValidationCase } from "../lib/validation";
import { spaceLabel } from "../lib/validation";
import { fitPlan, planViewBox, zoomPlan } from "../lib/plan-camera";
import type { PlanCamera, PlanCameraProps } from "../lib/plan-camera";

const COLORS: Record<Status, string> = { fail: "#e63f59", pass: "#30b394", unknown: "#edae35", excluded: "#8f9ba8" };
const rank = { excluded: -1, pass: 0, unknown: 1, fail: 2 };
const path = (points: Point3[]) => points.map((p, i) => `${i ? "L" : "M"}${p[0]},${-p[1]}`).join(" ");
export interface ValidationLayers { graph: boolean; doors: boolean; stairs: boolean; elevators: boolean; ramps?: boolean; unreachableSpaces?: boolean; doorIssues?: boolean; elevatorIssues?: boolean; rampIssues?: boolean; stairIssues?: boolean }

export function ValidationMap2D({ dataset, storeyId, cases, inspectionCases, reachabilityCases = [], selected, entranceId, layers, onLayersChange, onSelect, camera: sharedCamera, onCameraChange }: PlanCameraProps & {
  dataset: GraphDataset; storeyId: string | null; cases: ValidationCase[];
  inspectionCases: ValidationCase[]; reachabilityCases?: ValidationCase[]; layers: ValidationLayers; onLayersChange: (layers: ValidationLayers) => void;
  selected: ValidationCase | null; entranceId?: string; onSelect: (row: ValidationCase) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; box: number[]; scale: number; moved: boolean } | null>(null);
  const [localCamera, setLocalCamera] = useState<PlanCamera>();
  const [viewport, setViewport] = useState({ width: 700, height: 620 });
  useEffect(() => {
    if (!svgRef.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width && entry.contentRect.height) setViewport({width:entry.contentRect.width,height:entry.contentRect.height}); });
    observer.observe(svgRef.current); return () => observer.disconnect();
  }, []);
  const nodeById = useMemo(() => new Map(dataset.nodes.map((n) => [n.id, n])), [dataset]);
  const floorSpaces = useMemo(() => dataset.spaces.filter((s) => s.storeyId === storeyId), [dataset, storeyId]);
  const floorNodes = useMemo(() => dataset.nodes.filter((n) => n.storeyId === storeyId), [dataset, storeyId]);
  const elevation = dataset.storeys.find((s) => s.id === storeyId)?.elevation ?? 0;
  const verticals = dataset.verticalFeatures.filter((v) => v.storeyIds.includes(storeyId ?? ""));
  const reachability = useMemo(() => new Map(reachabilityCases.filter(c => c.rule === "entrance_reachability").map(c => [c.entityId, c])), [reachabilityCases]);
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
      // Door/element problems must NEVER determine the fill of an associated space.
      if (c.rule === "entrance_reachability") for (const id of c.spaceIds) put(spaces, id, c);
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
  const fitted = fitPlan(bounds[0] + 3, -bounds[1] - bounds[3] + 3, bounds[0] + bounds[2] - 3, -bounds[1] - 3, viewport.width, viewport.height);
  const camera = sharedCamera ?? localCamera ?? fitted;
  const changeCamera = (value: PlanCamera) => { if (onCameraChange) onCameraChange(value); else setLocalCamera(value); };
  const box = planViewBox(camera, viewport.width, viewport.height);
  useEffect(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!sharedCamera && !localCamera && rect?.width && rect.height) {
      changeCamera(fitPlan(bounds[0] + 3, -bounds[1] - bounds[3] + 3, bounds[0] + bounds[2] - 3, -bounds[1] - 3, rect.width, rect.height));
    }
  }, [sharedCamera, localCamera, bounds, viewport]);
  const issueRadius = Math.max(1.35, 9 / Math.min(viewport.width / box[2], viewport.height / box[3]));
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const scale = event.deltaY > 0 ? 1.18 : 1 / 1.18;
      changeCamera(zoomPlan(camera, scale, (p.x - camera.x) / camera.unitsPerPixel, (p.y + camera.y) / camera.unitsPerPixel));
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [camera, onCameraChange]);
  const focus = () => {
    if (!selected) return;
    const points = [
      ...floorSpaces.filter((s) => selected.entityId === s.spaceNodeId).flatMap((s) => s.rings.flat()),
      ...selected.nodeIds.map((id) => nodeById.get(id)).filter((n) => n?.storeyId === storeyId).map((n) => [n!.x, n!.y, n!.z] as Point3),
      ...verticals.filter((v) => selected.verticalIds.includes(v.verticalId)).flatMap((v) => v.paths.flat()),
      ...doors.filter((d) => selected.nodeIds.includes(d.id) && d.point).map((d) => d.point!),
    ];
    if (!points.length) return;
    const xs = points.map((p) => p[0]), ys = points.map((p) => -p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    changeCamera(fitPlan(x - 3, -Math.max(...ys) - 3, Math.max(...xs) + 3, -y + 3, viewport.width, viewport.height));
  };
  const select = (row: ValidationCase | undefined) => { if (row && !drag.current?.moved) onSelect(row); };
  const entrance = doors.find((d) => d.id === entranceId);
  return <div className="validation-map-wrap">
    <div className="validation-map-actions">
      <span>Validation map · drag to pan · + / − or wheel to zoom</span>
      {([["graph", "Context graph"], ["doors", "Doors"], ["stairs", "Stairs"], ["elevators", "Elevators"], ["ramps", "Ramps"]] as const).map(([id, label]) => <label key={id}><input type="checkbox" checked={layers[id] ?? true} onChange={(e) => onLayersChange({ ...layers, [id]: e.target.checked })} />{label}</label>)}
      <button className="secondary-button" aria-label="Zoom in 2D" title="Zoom in" onClick={() => changeCamera(zoomPlan(camera, 1 / 1.35))}>+</button>
      <button className="secondary-button" aria-label="Zoom out 2D" title="Zoom out" onClick={() => changeCamera(zoomPlan(camera, 1.35))}>−</button>
      <button className="secondary-button" onClick={() => changeCamera(fitted)}>Fit floor</button>
      <button className="secondary-button" onClick={focus} disabled={!selected}>Focus selection</button>
    </div>
    <div className="validation-map-actions" aria-label="Problem layers"><strong>Problem layers</strong>{([["unreachableSpaces", "Unreachable spaces"], ["doorIssues", "Door issues"], ["elevatorIssues", "Elevator issues"], ["rampIssues", "Ramp issues"], ["stairIssues", "Stair issues"]] as const).map(([id,label]) => <label key={id}><input type="checkbox" checked={layers[id] ?? true} onChange={e=>onLayersChange({...layers,[id]:e.target.checked})}/>{label}</label>)}</div>
    <p className="validation-map-note">{entranceId ? "Space colours: access from the selected exterior door." : "Space colours: access from any exterior entrance."} Pink means no directed route for the selected profile; amber means uncertain permissions. Arrival means reaching at least one interior node. Problem rings are independent of space reachability and table filters.</p>
    <svg ref={svgRef} className="validation-map" viewBox={box.join(" ")} data-camera={JSON.stringify(camera)} aria-label="Independent 2D validation map" role="img"
      onPointerDown={(e) => { const scale = svgRef.current?.getScreenCTM()?.a ?? 1; drag.current = { x: e.clientX, y: e.clientY, box: [...box], scale, moved: false }; }}
      onPointerMove={(e) => { const d = drag.current; if (!d || !e.buttons) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 4) { d.moved = true; changeCamera({ x: d.box[0] + d.box[2] / 2 - dx / d.scale, y: -(d.box[1] + d.box[3] / 2) + dy / d.scale, unitsPerPixel: 1 / d.scale }); } }}
      onPointerUp={() => { setTimeout(() => { drag.current = null; }, 0); }}
      onPointerLeave={() => { drag.current = null; }}>
      <title>Spaces, doors and vertical elements by floor. The table provides the same information as text.</title>
      {floorSpaces.map((s) => {
        const scopeCase = inspection.spaces.get(s.spaceNodeId);
        const row = scopeCase?.status === "excluded" ? scopeCase : reachability.get(s.spaceNodeId), chosen = selected?.entityId === s.spaceNodeId;
        const hiddenFailure = row?.status === "fail" && layers.unreachableSpaces === false;
        const fill = hiddenFailure || !row ? "#e9eef1" : row.status === "fail" ? "#f39bad" : COLORS[row.status];
        return <path key={s.id} data-layer="space" data-entity-id={s.spaceNodeId} d={s.rings.map((ring) => path(ring) + " Z").join(" ")} fillRule="evenodd" fill={fill} fillOpacity={row?.status === "fail" && !hiddenFailure ? 0.8 : 0.5} stroke={chosen ? "#222f88" : "#8198a5"} strokeWidth={chosen ? 3 : 0.7} vectorEffect="non-scaling-stroke" onClick={() => select(row ?? scopeCase)} data-status={row?.status ?? "context"}><title>{`${spaceLabel(s)} · ${row?.detail ?? "Reachability not evaluated"}`}</title></path>;
      })}
      {layers.graph && dataset.edges.filter((e) => nodeById.get(e.source)?.storeyId === storeyId && nodeById.get(e.target)?.storeyId === storeyId).map((e) => <path key={e.id} data-layer="context" d={path(e.points)} fill="none" stroke="#466276" strokeOpacity=".35" strokeWidth=".7" vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
      {verticals.map((v) => {
        const row = inspection.vertical.get(v.verticalId), color = "#397dc1";
        const normal = v.verticalType === "elevator" ? layers.elevators : v.verticalType === "stair" ? layers.stairs : layers.ramps !== false;
        const issue = row?.status === "fail" && (v.verticalType === "elevator" ? layers.elevatorIssues !== false : v.verticalType === "stair" ? layers.stairIssues !== false : layers.rampIssues !== false);
        if (!normal && !issue) return null;
        const stop = floorNodes.find((n) => n.parentNodeId === v.verticalId && ["landing", "elevator_stop"].includes(n.nodeRole));
        const point = stop ? [stop.x, stop.y, stop.z] : v.paths.flat().filter((p) => Math.abs(p[2] - elevation) < 0.6)[0] ?? v.paths[0]?.[0] ?? v.rings[0]?.[0];
        return <g key={v.id} data-layer={normal ? v.verticalType : `${v.verticalType}-issue-only`} data-entity-id={v.verticalId} onClick={() => select(row)} data-status={row?.status ?? "context"}>
          {normal && v.paths.map((points, i) => <path key={i} d={path(points)} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
          {point && <>{normal && <><circle cx={point[0]} cy={-point[1]} r={0.7} fill={color} stroke={selected?.verticalIds.includes(v.verticalId) ? "#222f88" : "white"} strokeWidth="2" vectorEffect="non-scaling-stroke" /><text x={point[0]} y={-point[1] + 0.23} textAnchor="middle" fontSize=".65" fill="white" fontWeight="700">{v.verticalType === "elevator" ? "E" : v.verticalType === "stair" ? "S" : "R"}</text></>}{issue && <circle data-layer={`${v.verticalType}-issue`} role="button" tabIndex={0} aria-label={`${v.verticalType} issue: ${row!.detail}`} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(row!);}}} cx={point[0]} cy={-point[1]} r={issueRadius} fill="transparent" stroke="#d7193f" strokeWidth="3" vectorEffect="non-scaling-stroke" />}</>}
          <title>{`${v.verticalType} · ${v.verticalId} · ${row?.detail ?? "Context"}`}</title>
        </g>;
      })}
      {floorNodes.filter((n) => { const r = maps.nodes.get(n.id); return r && (r.status !== "pass" || selected?.nodeIds.includes(n.id)) && !r.verticalIds.length && !r.spaceIds.length && !["door", "door_access"].includes(n.nodeType) && !["stair", "elevator", "ramp"].includes(n.mobilityType ?? ""); }).map((n) => <circle key={n.id} cx={n.x} cy={-n.y} r={0.38} fill={COLORS[maps.nodes.get(n.id)!.status]} stroke={selected?.nodeIds.includes(n.id) ? "#222f88" : "white"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" onClick={() => select(maps.nodes.get(n.id))}><title>{`Node · ${n.id} · ${maps.nodes.get(n.id)?.detail}`}</title></circle>)}
      {doors.filter((d) => d.point).map((d) => {
        const row = inspection.doors.get(d.id);
        const issue = row?.status === "fail" && layers.doorIssues !== false;
        if (!layers.doors && !issue) return null;
        return <g key={d.id} data-entity-id={d.id} onClick={()=>select(row)}><title>{`Door · ${d.id} · ${row?.detail ?? "No local check available"}${!nodeById.has(d.id) ? " · Inventoried door without a graph node" : ""}`}</title>{layers.doors && <rect data-layer="door" data-entity-id={d.id} data-status={row?.status ?? "context"} x={d.point![0] - .36} y={-d.point![1] - .36} width=".72" height=".72" rx=".08" fill="#397dc1" stroke={selected?.entityId === d.id ? "#222f88" : d.exterior ? "#c98700" : "white"} strokeWidth={d.exterior ? "2" : "1.2"} vectorEffect="non-scaling-stroke" />}{issue && <circle data-layer="door-issue" role="button" tabIndex={0} aria-label={`Door issue: ${row!.detail}`} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(row!);}}} cx={d.point![0]} cy={-d.point![1]} r={issueRadius} fill="transparent" stroke="#d7193f" strokeWidth="3" vectorEffect="non-scaling-stroke" />}</g>;
      })}
      {layers.doors && entrance?.point && <g data-layer="origin"><circle cx={entrance.point[0]} cy={-entrance.point[1]} r="1" fill="#182961" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" /><text x={entrance.point[0]} y={-entrance.point[1] + .28} textAnchor="middle" fontSize=".85" fill="white">D</text><title>Selected exterior door</title></g>}
    </svg>
    <div className="validation-legend"><span><i style={{ background: "#f39bad" }} /> Unreachable space</span><span><i style={{ border: "3px solid #d7193f", borderRadius: "50%", background: "transparent" }} /> Element issue (select ring)</span><span><i style={{ background: COLORS.pass }} /> Reachable space</span><span><i style={{ background: COLORS.unknown }} /> Unknown reachability</span><span><i style={{ background: COLORS.excluded }} /> Excluded by scope</span><span><i style={{ background: "#e9eef1" }} /> Unchecked / hidden highlight</span><span>Square: door · gold outline: exterior</span><span>E: elevator · S: stair · R: ramp · D: origin</span></div>
    <p className="validation-map-note">Red rings show local element issues, not inaccessible spaces. Normal layers and problem layers can be toggled independently. Turning off Unreachable spaces removes the pink highlight but keeps the floor outline. Source checks and routing results are unchanged.</p>
    {layers.doors && doors.some((d) => !d.point) && <p className="validation-note">{doors.filter((d) => !d.point).length} doors have no coordinates and are listed in the table only.</p>}
    {!floorSpaces.length && <p className="validation-note">This floor has no space polygons. Available nodes and paths are shown.</p>}
  </div>;
}

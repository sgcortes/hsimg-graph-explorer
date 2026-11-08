"use client";
import { useMemo, useState } from 'react';
import type { GraphDataset, VisibilityState } from '../lib/types';
import { nodeDisplayLabel } from '../lib/types';
import { validateGraph } from '../lib/validation';
import { doorOpen, mobilityNetwork, travel, routePath, TIME_BANDS, timeColor } from '../lib/mobility';
import { FloorPlan2D } from './FloorPlan2D';

const visibility: VisibilityState = { finalist:true, mobility:true, verticalMobility:true, internal:true, access:true, exteriorDoors:true, doorSides:false, edges:false, spaces:true };
const fmt = (n:number) => Number.isFinite(n) ? `${(n/60).toFixed(2)} min` : 'Unreachable';
export function MobilityWorkbench({dataset}:{dataset:GraphDataset}) {
  const [wheelchair,setWheelchair]=useState(false), [unknown,setUnknown]=useState(false), [elevators,setElevators]=useState(false);
  const [speed,setSpeed]=useState(1.2), [states,setStates]=useState<Record<string,boolean>>({});
  const [floor,setFloor]=useState(dataset.storeys[0]?.id??null), [selected,setSelected]=useState<string|null>(null);
  const [origin,setOrigin]=useState(''), [destination,setDestination]=useState(''), [pick,setPick]=useState<'origin'|'destination'>('origin');
  const [doorId,setDoorId]=useState(''), [mode,setMode]=useState('evacuation'), [query,setQuery]=useState('');
  const nodeById=useMemo(()=>new Map(dataset.nodes.map(n=>[n.id,n])),[dataset]);
  const label=(id:string)=>nodeById.has(id)?nodeDisplayLabel(nodeById.get(id)!):id;
  const validation=useMemo(()=>validateGraph(dataset,wheelchair?'wheelchair':'general'),[dataset,wheelchair]);
  const exits=validation.entrances.map(e=>e.door);
  const excluded=useMemo(()=>new Set([...validation.spaceMembers].filter(([id])=>validation.scopes.get(id)?.excluded).flatMap(([,ids])=>ids)),[validation]);
  const options=useMemo(()=>({wheelchair,allowUnknown:unknown,elevators,speed,excluded,doorStates:states}),[wheelchair,unknown,elevators,speed,excluded,states]);
  const network=useMemo(()=>mobilityNetwork(dataset,options),[dataset,options]);
  const baseline=useMemo(()=>mobilityNetwork(dataset,{...options,doorStates:{}}),[dataset,wheelchair,unknown,elevators,speed,excluded]);
  const open=(id:string)=> states[id] ?? (dataset.nodes.find(n=>n.id===id) ? doorOpen(dataset.nodes.find(n=>n.id===id)!) : true);
  const results=useMemo(()=>{
    const exitIds=validation.entrances.map(e=>e.door.id);
    const now=travel(network.reverse,exitIds), before=travel(baseline.reverse,exitIds);
    const reachable=new Map<string,number>(), perExit=new Map<string,Map<string,number>>();
    for(const id of exitIds){const distances=travel(network.reverse,[id]).distance;perExit.set(id,distances);for(const n of distances.keys())reachable.set(n,(reachable.get(n)??0)+1);}
    return {now,before,reachable,perExit};
  },[validation,network,baseline]);
  const fromDoor=useMemo(()=>travel(network.forward,[doorId||exits[0]?.id||'']),[network,doorId,validation]);
  const pair=useMemo(()=>({out:travel(network.forward,[origin]),back:travel(network.forward,[destination])}),[network,origin,destination]);
  const rows=useMemo(()=>validation.cases.filter(c=>c.rule==='space_connection').map(c=>{
    const ids=validation.spaceMembers.get(c.entityId)??[];
    // Conservative space aggregation: every navigable member must have an exit.
    const worst=(d:Map<string,number>)=>ids.length?Math.max(...ids.map(id=>d.get(id)??Infinity)):Infinity;
    return {...c,seconds:worst(results.now.distance),before:worst(results.before.distance),reached:ids.some(id=>fromDoor.distance.has(id)),allExits:ids.length?Math.min(...ids.map(id=>results.reachable.get(id)??0)):0,excluded:validation.scopes.get(c.entityId)?.excluded};
  }),[validation,results,fromDoor]);
  const colors=useMemo(()=>new Map(rows.map(r=>{
    const members=validation.spaceMembers.get(r.entityId)??[];
    const selectedExitTime=members.length?Math.max(...members.map(id=>results.perExit.get(doorId||exits[0]?.id)?.get(id)??Infinity)):Infinity;
    return [r.entityId,r.excluded?'#d1d5db':mode==='from-door'?(r.reached?'#86efac':'#374151'):timeColor(mode==='to-exit'?selectedExitTime:r.seconds)];
  })),[rows,mode,results,validation,doorId]);
  const route=useMemo(()=>routePath(pair.out.previous,origin,destination),[pair,origin,destination]);
  const parents=useMemo(()=>new Set(dataset.nodes.map(n=>n.parentNodeId).filter(Boolean)),[dataset]);
  const candidates=dataset.nodes.filter(n=>n.nodeRole!=='semantic_parent'||!parents.has(n.id));
  const outgoing=pair.out.distance.get(destination)??Infinity, returning=pair.back.distance.get(origin)??Infinity;
  const required=rows.filter(r=>!r.excluded), affected=required.filter(r=>r.seconds>r.before);
  const filtered=rows.filter(r=>(!floor||r.storeyId===floor)&&`${r.label} ${r.entityId}`.toLowerCase().includes(query.toLowerCase()));
  const choose=(id:string)=>{setSelected(id);const members=validation.spaceMembers.get(id);const point=!network.forward.has(id)&&members?.length?members.find(n=>network.forward.has(n))??members[0]:id;if(pick==='origin')setOrigin(point);else setDestination(point);};
  const exportScenario=()=>{const payload={dataset:dataset.name,fingerprint:dataset.validation?.fingerprint,profile:wheelchair?'wheelchair':'general',allowUnknown:unknown,elevators,speed,doorStates:states,spaces:rows.map(r=>({id:r.entityId,excluded:r.excluded,seconds:Number.isFinite(r.seconds)?r.seconds:null,baselineSeconds:Number.isFinite(r.before)?r.before:null,reachableExits:r.allExits}))};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='mobility-scenario.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const exportPointCoverage=()=>{
    const payload={dataset:dataset.name,profile:wheelchair?'wheelchair':'general',doorStates:states,points:candidates.map(n=>({id:n.id,fid:n.raw.fid??n.metadata.fid,storeyId:n.storeyId,allowed:network.forward.has(n.id),exits:exits.map(d=>({id:d.id,open:open(d.id),seconds:results.perExit.get(d.id)?.get(n.id)??null}))}))};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='mobility-point-exit-coverage.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <section className="mobility-workbench">
    <h2>Mobility · connectivity and exit scenarios</h2>
    <p>Directed travel times to open exterior doors. Space colours use the slowest navigable member; one stranded member makes the space unreachable. These are free-flow travel estimates, excluding occupancy, queues and reaction time. Exterior classification and intended access must be checked against the BIM.</p>
    <div className="mobility-controls">
      <label><input type="checkbox" checked={wheelchair} onChange={e=>setWheelchair(e.target.checked)}/> Wheelchair profile</label>
      <label><input type="checkbox" checked={unknown} onChange={e=>setUnknown(e.target.checked)}/> Allow unknown permissions (exploratory)</label>
      <label><input type="checkbox" checked={elevators} onChange={e=>setElevators(e.target.checked)}/> Include elevators</label>
      <label>Fallback speed (m/s) <input type="number" min="0.1" max="3" step="0.1" value={speed} onChange={e=>setSpeed(Math.max(.1,Math.min(3,Number(e.target.value)||1.2)))}/></label>
      <button onClick={()=>setStates({})}>Restore source door states</button><button onClick={exportScenario}>Export scenario JSON</button>
    </div>
    <p>{network.fallbackTimes} arcs use distance / speed; other arcs use exported estimated_time in seconds. Unknown door states are assumed open until overridden. Closed doors block transit in both directions. Scope follows Validation’s default exclusions.</p>
    {!exits.length&&<p role="alert">No exterior entrance/exit inventory is available. Exit coverage cannot be evaluated.</p>}
    <div className="mobility-summary" aria-live="polite"><span>{required.filter(r=>!Number.isFinite(r.seconds)).length} / {required.length} spaces without a complete exit route</span><span>{affected.length} spaces worsened</span><span>{exits.filter(d=>open(d.id)).length} / {exits.length} exits open</span><span>Longest space travel: {fmt(Math.max(0,...required.map(r=>r.seconds)))}</span></div>
    <div className="mobility-layout"><aside>
      <h3>Exterior doors · scenario open state</h3><p>Changes are scenario overrides; the source file stays intact.</p>
      <div className="mobility-door-list">{exits.map(d=>{const n=dataset.nodes.find(n=>n.id===d.id);return <label key={d.id}><input type="checkbox" checked={open(d.id)} onChange={e=>setStates(s=>({...s,[d.id]:e.target.checked}))}/><span>{n?nodeDisplayLabel(n):d.name} · {dataset.storeys.find(s=>s.id===d.storeyId)?.label.split(' · ')[0]??'No level'}{!n?' (missing graph node)':''}</span></label>;})}</div>
      <h3>Door → spaces</h3><select aria-label="Exterior origin door" value={doorId||exits[0]?.id||''} onChange={e=>setDoorId(e.target.value)}>{exits.map(d=><option key={d.id} value={d.id}>{dataset.nodes.find(n=>n.id===d.id)?nodeDisplayLabel(dataset.nodes.find(n=>n.id===d.id)!):d.name}</option>)}</select>
      <p>{required.filter(r=>r.reached).length} / {required.length} required spaces reachable from this door.</p>
      <h3>Compare A → B and B → A</h3>
      <label>Origin A<select value={origin} onChange={e=>setOrigin(e.target.value)}><option value="">Choose a point</option>{candidates.map(n=><option key={n.id} value={n.id}>{nodeDisplayLabel(n)} · {n.nodeRole}</option>)}</select></label>
      <label>Destination B<select value={destination} onChange={e=>setDestination(e.target.value)}><option value="">Choose a point</option>{candidates.map(n=><option key={n.id} value={n.id}>{nodeDisplayLabel(n)} · {n.nodeRole}</option>)}</select></label>
      <label>Map clicks set <select value={pick} onChange={e=>setPick(e.target.value as 'origin'|'destination')}><option value="origin">Origin A</option><option value="destination">Destination B</option></select></label>
      {origin&&destination&&<p aria-live="polite">A → B: {fmt(outgoing)} · B → A: {fmt(returning)}. {Number.isFinite(outgoing)&&Number.isFinite(returning)?`Difference: ${Math.abs(outgoing-returning).toFixed(2)} s. ${Math.abs(outgoing-returning)<.01?'Symmetric.':'Asymmetric: review directions, costs and restrictions.'}`:'Missing route in at least one direction.'}</p>}
    </aside><div>
      <div className="mobility-controls"><label>Floor <select value={floor??''} onChange={e=>setFloor(e.target.value)}>{dataset.storeys.map(s=><option value={s.id} key={s.id}>{s.label}</option>)}</select></label><label>Map <select value={mode} onChange={e=>setMode(e.target.value)}><option value="evacuation">Time to nearest open exit</option><option value="to-exit">Time to selected exterior door</option><option value="from-door">Reachability from selected door</option></select></label></div>
      <div className="mobility-map"><FloorPlan2D key={floor} dataset={dataset} storeyId={floor} selectedNodeId={selected} visibility={visibility} linkViews={false} onSelectNode={choose} routeNodeIds={route} originNodeId={origin} destinationNodeId={destination} navigationMode spaceColors={colors}/></div>
      <div className="mobility-controls">{(mode!=='from-door'?TIME_BANDS:[['Reachable','#86efac'],['Unreachable','#374151'],['Excluded','#d1d5db']]).map(([label,color])=><span key={label}><i style={{background:color,display:'inline-block',width:14,height:14,marginRight:5}}/>{label}</span>)}</div>
      <p>Red means under one minute, as requested; colours encode travel bands, not safety certification. The green line shows A → B on the current floor.</p>
    </div></div>
    <h3>Origin A → every exterior exit</h3>
    <button onClick={exportPointCoverage}>Export all point → exit results</button>
    <p>Choose origin A above or click a graph point. A missing route can indicate a disconnected graph, access restrictions or an incomplete IFC; it is not automatically a BIM error. Closed exits remain in the coverage denominator.</p>
    {origin ? <div className="mobility-table"><table><thead><tr><th>Exit</th><th>Scenario state</th><th>Travel from A</th></tr></thead><tbody>{exits.map(d=><tr key={d.id}><td>{label(d.id)}</td><td>{open(d.id)?'Open':'Closed'}</td><td>{fmt(results.perExit.get(d.id)?.get(origin)??Infinity)}</td></tr>)}</tbody></table></div>:<p>Select an origin to inspect individual exit routes.</p>}
    <h3>Spaces · baseline and scenario</h3><input aria-label="Filter spaces" placeholder="Filter spaces" value={query} onChange={e=>setQuery(e.target.value)}/>
    <div className="mobility-table"><table><thead><tr><th>Space</th><th>Source state</th><th>Scenario</th><th>Change</th><th>Minimum exit coverage per point</th><th>From selected door</th></tr></thead><tbody>{filtered.map(r=><tr key={r.id} onClick={()=>{if(r.nodeIds[0])choose(r.nodeIds[0]);}}><td>{r.label}</td><td>{r.excluded?'Excluded':fmt(r.before)}</td><td>{r.excluded?'Excluded':fmt(r.seconds)}</td><td>{r.excluded?'—':Number.isFinite(r.seconds)&&Number.isFinite(r.before)?`${((r.seconds-r.before)/60).toFixed(2)} min`:Number.isFinite(r.before)?'Lost access':Number.isFinite(r.seconds)?'Restored access':'Still unreachable'}</td><td>{r.excluded?'—':exits.length?`${r.allExits}/${exits.length}`:'Not evaluated'}</td><td>{r.excluded?'—':r.reached?'Reachable':'Unreachable'}</td></tr>)}</tbody></table></div>
    <h3>Stair, elevator and ramp access issues</h3><p>These source-graph checks use the selected profile; closing an exterior exit does not change the BIM inventory. Review the listed evidence in Validation before attributing an issue to the BIM.</p>
    <div className="mobility-table">{validation.cases.filter(c=>/^(stair|elevator|ramp)_floor$/.test(c.rule)&&c.status!=='pass'&&(!floor||c.storeyId===floor)).map(c=><p key={c.id}><button onClick={()=>{if(c.nodeIds[0])choose(c.nodeIds[0]);}}>{c.label}</button> {c.detail}</p>)}</div>
    {validation.warnings.map(w=><p key={w}>{w}</p>)}
  </section>;
}

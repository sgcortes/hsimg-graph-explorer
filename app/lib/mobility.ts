import type { GraphDataset, GraphNode } from './types';

export interface MobilityOptions { wheelchair: boolean; allowUnknown: boolean; elevators: boolean; speed: number; doorStates: Record<string, boolean>; excluded: Set<string> }
export type Network = Map<string, { id: string; seconds: number }[]>;
export function bool(value: unknown): boolean | null {
  if (value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'yes') return true;
  if (value === false || value === 0 || value === '0' || String(value).toLowerCase() === 'false' || String(value).toLowerCase() === 'no') return false;
  return null;
}
export function doorOpen(node: GraphNode): boolean {
  return bool(node.raw.door_open ?? node.metadata.door_open ?? node.metadata.is_open ?? node.metadata.open) !== false;
}
const number = (v: unknown) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
export function mobilityNetwork(dataset: GraphDataset, options: MobilityOptions) {
  const nodes = new Map(dataset.nodes.map(n => [n.id, n]));
  const parents = new Set(dataset.nodes.map(n => n.parentNodeId).filter(Boolean));
  const allowed = (n: GraphNode) => {
    const flag = options.wheelchair ? n.accessibleWheelchair : n.accessibleGeneral;
    const mode = n.mobilityType ?? '';
    return !options.excluded.has(n.id) && !(n.nodeRole === 'semantic_parent' && parents.has(n.id)) && flag !== false && (options.allowUnknown || flag === true)
      && !(options.wheelchair && /stair/i.test(mode)) && !(!options.elevators && /elevator|lift/i.test(mode))
      && !(n.nodeType === 'door' && !(options.doorStates[n.id] ?? doorOpen(n)))
      && !(n.parentNodeId && nodes.get(n.parentNodeId)?.nodeType === 'door' && !(options.doorStates[n.parentNodeId] ?? doorOpen(nodes.get(n.parentNodeId)!)));
  };
  const forward: Network = new Map(dataset.nodes.filter(allowed).map(n => [n.id, []]));
  const reverse: Network = new Map([...forward.keys()].map(id => [id, []]));
  let fallbackTimes = 0, rejected = 0;
  for (const e of dataset.edges) {
    const a = nodes.get(e.source), b = nodes.get(e.target);
    const flag = options.wheelchair ? e.accessibleWheelchair : e.accessibleGeneral;
    const mode = `${e.mobilityMode} ${e.edgeType} ${e.metadata.route_type ?? ''}`;
    if (!a || !b || !forward.has(a.id) || !forward.has(b.id) || flag === false || (!options.allowUnknown && flag !== true) || /vehicle|hierarch|containment|aggregation/i.test(mode) || (options.wheelchair && /stair/i.test(mode)) || (!options.elevators && /elevator|lift/i.test(mode))) { rejected++; continue; }
    let seconds = number(e.raw.estimated_time ?? e.metadata.estimated_time);
    if (seconds === null) {
      let length = number(e.raw.length_3d ?? e.metadata.length_3d);
      if (length === null) length = e.points.length > 1 ? e.points.slice(1).reduce((sum,p,i) => sum + Math.hypot(p[0]-e.points[i][0], p[1]-e.points[i][1], p[2]-e.points[i][2]),0) : Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
      seconds = length / Math.max(.1, options.speed); fallbackTimes++;
    }
    if (!Number.isFinite(seconds)) { rejected++; continue; }
    forward.get(a.id)!.push({ id:b.id, seconds }); reverse.get(b.id)!.push({ id:a.id, seconds });
  }
  return { forward, reverse, fallbackTimes, rejected };
}

// Multi-source Dijkstra on directed arcs. Reversed arcs measure travel TO exits.
export function travel(network: Network, starts: string[]) {
  const distance = new Map<string, number>(), previous = new Map<string,string>();
  const heap: { id:string; cost:number }[] = [];
  const push = (id:string,cost:number) => { let i=heap.length; heap.push({id,cost}); while(i>0){const p=(i-1)>>1; if(heap[p].cost<=cost)break; heap[i]=heap[p]; i=p;} heap[i]={id,cost}; };
  for (const id of starts) if(network.has(id)){distance.set(id,0);push(id,0);}
  while(heap.length){
    const head=heap[0], tail=heap.pop()!;
    if(heap.length){let i=0; while(i*2+1<heap.length){let c=i*2+1; if(c+1<heap.length && heap[c+1].cost<heap[c].cost)c++; if(heap[c].cost>=tail.cost)break; heap[i]=heap[c];i=c;}heap[i]=tail;}
    if(head.cost!==distance.get(head.id))continue;
    for(const e of network.get(head.id) ?? []){const cost=head.cost+e.seconds;if(cost<(distance.get(e.id)??Infinity)){distance.set(e.id,cost);previous.set(e.id,head.id);push(e.id,cost);}}
  }
  return {distance,previous};
}
export function routePath(previous: Map<string,string>, start:string, end:string): string[] {
  const result=[end]; let cursor=end; const seen=new Set([end]);
  while(cursor!==start){const next=previous.get(cursor);if(!next||seen.has(next))return [];seen.add(next);result.push(next);cursor=next;}
  return result.reverse();
}
export const TIME_BANDS = [ ['< 1 min','#ef4444'], ['1–2 min','#fb923c'], ['2–3 min','#facc15'], ['3–5 min','#60a5fa'], ['≥ 5 min','#a78bfa'], ['Unreachable','#374151'], ['Excluded','#d1d5db'] ];
export function timeColor(seconds:number){return TIME_BANDS[!Number.isFinite(seconds)?5:seconds<60?0:seconds<120?1:seconds<180?2:seconds<300?3:4][1];}

"use client";

import { useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { DEMO_DATASET } from "../lib/demo-data";
import { loadGraphFile } from "../lib/graph-loader";
import type { GraphDataset, GraphNode, VisibilityState } from "../lib/types";
import { FloorPlan2D } from "./FloorPlan2D";
import { Graph3D } from "./Graph3D";
import { NodeContext2D } from "./NodeContext2D";

const DEFAULT_VISIBILITY: VisibilityState = {
  finalist: true,
  mobility: true,
  verticalMobility: true,
  internal: true,
  access: true,
  exteriorDoors: true,
  doorSides: false,
  edges: true,
  spaces: true,
};

const VISIBILITY_LABELS: Array<[keyof VisibilityState, string]> = [
  ["finalist", "Finalist spaces"],
  ["mobility", "Horizontal mobility"],
  ["verticalMobility", "Vertical mobility"],
  ["internal", "Expanded mobility"],
  ["access", "Interior doors"],
  ["exteriorDoors", "Exterior access doors"],
  ["doorSides", "Door-side detail"],
  ["edges", "Connections"],
  ["spaces", "IfcSpace boundaries"],
];

function connectedComponents(dataset: GraphDataset): number {
  const parent = new Map(dataset.nodes.map((node) => [node.id, node.id]));
  const find = (id: string): string => {
    const value = parent.get(id);
    if (!value || value === id) return id;
    const root = find(value);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };
  dataset.edges.forEach((edge) => {
    if (parent.has(edge.source) && parent.has(edge.target)) union(edge.source, edge.target);
  });
  return new Set([...parent.keys()].map(find)).size;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4);
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function categoryLabel(node: GraphNode | null): string {
  if (!node) return "No selection";
  return {
    finalist: "Finalist node",
    mobility: "Mobility node",
    internal: "Internal node",
    access: "Door / access",
  }[node.category];
}

function MetadataPanel({ node }: { node: GraphNode | null }) {
  const entries = useMemo(() => {
    if (!node) return [];
    const merged = {
      node_id: node.id,
      name: node.name,
      category: categoryLabel(node),
      node_type: node.nodeType,
      node_role: node.nodeRole,
      mobility_type: node.mobilityType,
      parent_node_id: node.parentNodeId,
      subgraph_id: node.subgraphId,
      hierarchy_level: node.hierarchyLevel,
      storey_id: node.storeyId,
      x: node.x,
      y: node.y,
      z: node.z,
      accessible_general: node.accessibleGeneral,
      accessible_wheelchair: node.accessibleWheelchair,
      ...node.metadata,
    };
    return Object.entries(merged).filter(([, value]) => value !== undefined);
  }, [node]);

  if (!node) {
    return <div className="empty-detail">Select a node to inspect its attributes and metadata.</div>;
  }
  return (
    <dl className="metadata-list" data-testid="metadata-list">
      {entries.map(([key, value]) => (
        <div className="metadata-row" key={key}>
          <dt>{key}</dt>
          <dd>{formatValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function GraphWorkbench() {
  const [dataset, setDataset] = useState<GraphDataset>(DEMO_DATASET);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    DEMO_DATASET.nodes.find((node) => node.category === "mobility")?.id ?? null,
  );
  const [storeyId, setStoreyId] = useState<string | null>(DEMO_DATASET.storeys[0]?.id ?? null);
  const [visibility, setVisibility] = useState<VisibilityState>(DEFAULT_VISIBILITY);
  const [linkViews, setLinkViews] = useState(false);
  const [reset3D, setReset3D] = useState(0);
  const [reset2D, setReset2D] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [leftColumnWidth, setLeftColumnWidth] = useState(42);
  const [topRowHeight, setTopRowHeight] = useState(63);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dashboardRef = useRef<HTMLDivElement>(null);

  const selectedNode = useMemo(
    () => dataset.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [dataset, selectedNodeId],
  );
  const stats = useMemo(
    () => ({
      nodes: dataset.nodes.length,
      edges: dataset.edges.length,
      mobility: dataset.nodes.filter((node) => node.category === "mobility").length,
      components: connectedComponents(dataset),
    }),
    [dataset],
  );

  const selectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    const node = dataset.nodes.find((item) => item.id === nodeId);
    if (linkViews && node?.storeyId && dataset.storeys.some((storey) => storey.id === node.storeyId)) {
      setStoreyId(node.storeyId);
    }
  };

  const importFile = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadGraphFile(file);
      setDataset(loaded);
      const initial = loaded.nodes.find((node) => node.category === "mobility") ?? loaded.nodes[0] ?? null;
      setSelectedNodeId(initial?.id ?? null);
      setStoreyId(initial?.storeyId ?? loaded.storeys[0]?.id ?? null);
      setVisibility(DEFAULT_VISIBILITY);
      setReset3D((value) => value + 1);
      setReset2D((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The selected file could not be read.");
    } finally {
      setLoading(false);
    }
  };

  const beginColumnResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dashboard = dashboardRef.current;
    if (!dashboard) return;
    event.preventDefault();
    const updateWidth = (clientX: number) => {
      const bounds = dashboard.getBoundingClientRect();
      const percentage = ((clientX - bounds.left) / bounds.width) * 100;
      setLeftColumnWidth(Math.min(Math.max(percentage, 30), 62));
    };
    const handlePointerMove = (pointerEvent: PointerEvent) => updateWidth(pointerEvent.clientX);
    const handlePointerUp = () => {
      document.body.classList.remove("is-resizing-panels");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    document.body.classList.add("is-resizing-panels");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  };

  const beginRowResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dashboard = dashboardRef.current;
    if (!dashboard) return;
    event.preventDefault();
    const updateHeight = (clientY: number) => {
      const bounds = dashboard.getBoundingClientRect();
      const percentage = ((clientY - bounds.top) / bounds.height) * 100;
      setTopRowHeight(Math.min(Math.max(percentage, 44), 68));
    };
    const handlePointerMove = (pointerEvent: PointerEvent) => updateHeight(pointerEvent.clientY);
    const handlePointerUp = () => {
      document.body.classList.remove("is-resizing-rows");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    document.body.classList.add("is-resizing-rows");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  };

  return (
    <main className="workbench-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div>
            <p className="eyebrow">IFC2GRAPH · SPATIAL ANALYSIS</p>
            <h1>HSIMG Graph Explorer</h1>
          </div>
        </div>
        <div className="university-brand" aria-label="University of Oviedo">
          <img src="/university-oviedo.png" alt="University of Oviedo" />
        </div>
        <div className="file-status">
          <span className={`source-badge source-${dataset.sourceType}`}>
            {dataset.sourceType === "gpkg" ? "GeoPackage" : dataset.sourceType === "json" ? "Graph JSON" : "Demo"}
          </span>
          <span className="file-name" title={dataset.name}>{dataset.name}</span>
          <button className="primary-button" type="button" onClick={() => fileInputRef.current?.click()}>
            {loading ? "Processing…" : "Load graph"}
          </button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".gpkg,.json,.geojson,application/json"
            aria-label="Select a graph GeoPackage or JSON file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
              event.currentTarget.value = "";
            }}
          />
        </div>
      </header>

      <section
        className={`import-strip ${dragActive ? "is-dragging" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setDragActive(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          const file = event.dataTransfer.files[0];
          if (file) void importFile(file);
        }}
      >
        <div>
          <strong>GeoPackage recommended</strong>
          <span>Includes the graph, building levels and 2D space footprints.</span>
        </div>
        <div>
          <strong>JSON supported</strong>
          <span>Fast 3D graph loading without floor-plan boundaries.</span>
        </div>
        <span className="drop-copy">You can also drag and drop the file here</span>
      </section>

      {error && <div className="message message-error" role="alert">{error}</div>}
      {dataset.warnings.length > 0 && !error && (
        <div className="message" role="status">{dataset.warnings[0]}</div>
      )}

      <section className="stats-row" aria-label="Graph summary">
        <div><span>Nodes</span><strong>{stats.nodes.toLocaleString("en-US")}</strong></div>
        <div><span>Connections</span><strong>{stats.edges.toLocaleString("en-US")}</strong></div>
        <div><span>Mobility nodes</span><strong>{stats.mobility.toLocaleString("en-US")}</strong></div>
        <div><span>Components</span><strong>{stats.components.toLocaleString("en-US")}</strong></div>
        <div className="visibility-controls" aria-label="Visible layers">
          {VISIBILITY_LABELS.map(([key, label]) => (
            <label key={key} className="toggle-control">
              <input
                type="checkbox"
                checked={visibility[key]}
                onChange={(event) => setVisibility((current) => ({ ...current, [key]: event.target.checked }))}
              />
              <span>{label}</span>
            </label>
          ))}
          <label className="toggle-control link-views-control">
            <input
              type="checkbox"
              checked={linkViews}
              onChange={(event) => setLinkViews(event.target.checked)}
            />
            <span>Link 2D / 3D focus</span>
          </label>
        </div>
      </section>

      <div
        ref={dashboardRef}
        className="dashboard-grid"
        style={{
          "--left-column-width": `${leftColumnWidth}%`,
          "--top-row-height": `${topRowHeight}%`,
        } as CSSProperties}
      >
        <article className="view-panel view-panel-3d">
          <div className="panel-heading">
            <div>
              <span className="panel-index">01</span>
              <div><h2>3D graph</h2><p>Rotate · pan · zoom · select</p></div>
            </div>
            <button className="secondary-button" type="button" onClick={() => setReset3D((value) => value + 1)}>
              Reset view
            </button>
          </div>
          <Graph3D
            dataset={dataset}
            selectedNodeId={selectedNodeId}
            visibility={visibility}
            linkViews={linkViews}
            resetToken={reset3D}
            onSelectNode={selectNode}
          />
        </article>

        <article className="view-panel view-panel-2d">
          <div className="panel-heading">
            <div>
              <span className="panel-index">02</span>
              <div><h2>2D floor plan</h2><p>IfcSpace boundaries and graph for the selected level</p></div>
            </div>
            <div className="floor-controls">
              <label>
                <span className="visually-hidden">Building level</span>
                <select
                  value={storeyId ?? ""}
                  onChange={(event) => setStoreyId(event.target.value || null)}
                  disabled={!dataset.storeys.length}
                  aria-label="Building level"
                >
                  {!dataset.storeys.length && <option value="">No levels available</option>}
                  {dataset.storeys.map((storey) => <option key={storey.id} value={storey.id}>{storey.label}</option>)}
                </select>
              </label>
              <button className="icon-button" type="button" onClick={() => setReset2D((value) => value + 1)} aria-label="Reset 2D floor plan">
                Fit view
              </button>
            </div>
          </div>
          <FloorPlan2D
            key={`${dataset.name}:${storeyId ?? "all"}:${reset2D}`}
            dataset={dataset}
            storeyId={storeyId}
            selectedNodeId={selectedNodeId}
            visibility={visibility}
            linkViews={linkViews}
            onSelectNode={selectNode}
          />
        </article>
        <button
          className="column-resizer"
          type="button"
          aria-label="Resize the left and right panel columns"
          title="Drag to resize panel columns"
          onPointerDown={beginColumnResize}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setLeftColumnWidth((value) => Math.max(30, value - 2));
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              setLeftColumnWidth((value) => Math.min(62, value + 2));
            }
            if (event.key === "Home") setLeftColumnWidth(42);
          }}
        >
          <span aria-hidden="true" />
        </button>
        <button
          className="row-resizer"
          type="button"
          aria-label="Resize the upper and lower panel rows"
          title="Drag to resize panel rows"
          onPointerDown={beginRowResize}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setTopRowHeight((value) => Math.max(44, value - 2));
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setTopRowHeight((value) => Math.min(68, value + 2));
            }
            if (event.key === "Home") setTopRowHeight(63);
          }}
        >
          <span aria-hidden="true" />
        </button>
        <article className="detail-panel context-panel">
          <div className="detail-heading">
            <div>
              <span className="panel-index">03</span>
              <div><h2>Node inspector</h2><p>{selectedNode ? `${categoryLabel(selectedNode)} · ${selectedNode.name}` : "Select a node"}</p></div>
            </div>
            {selectedNode && <span className={`node-type-badge type-${selectedNode.category}`}>{selectedNode.mobilityType ?? selectedNode.nodeType}</span>}
          </div>
          <NodeContext2D dataset={dataset} selectedNodeId={selectedNodeId} onSelectNode={selectNode} />
        </article>

        <article className="detail-panel metadata-panel">
          <div className="detail-heading">
            <div>
              <span className="panel-index">04</span>
              <div><h2>Metadata</h2><p>Attributes of the selected node</p></div>
            </div>
            {selectedNode && <code className="node-id">{selectedNode.id}</code>}
          </div>
          <MetadataPanel node={selectedNode} />
        </article>
      </div>

      <footer className="app-footer">
        <span>Processing runs entirely in your browser; the file is not uploaded to any server.</span>
        <span className="footer-contact">
          <a href="mailto:sgcortes@uniovi.es">sgcortes@uniovi.es</a>
          <span aria-hidden="true">·</span>
          GeoPackage layers: <code>graph_nodes</code>, <code>graph_edges</code> and <code>spaces</code>.
        </span>
      </footer>
    </main>
  );
}

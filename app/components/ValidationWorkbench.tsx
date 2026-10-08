"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphDataset } from "../lib/types";
import { caseExplanation, csvRows, importReference, metrics, readScopeOverrides, RULES, STATUS_LABEL, summarize, validateGraph, VALIDATION_VERSION } from "../lib/validation";
import type { Profile, ReferenceLabels, ScopeOverrides, ValidationCase } from "../lib/validation";
import { ValidationMap2D } from "./ValidationMap2D";
import type { ValidationLayers } from "./ValidationMap2D";

function download(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const number = (value: number | null) => value === null ? "—" : value.toFixed(3);
const PAGE_SIZE = 40;

export function ValidationWorkbench({ dataset }: { dataset: GraphDataset }) {
  const [profile, setProfile] = useState<Profile>("general");
  const [mode, setMode] = useState<"issues" | "reach">("issues");
  const [rule, setRule] = useState("");
  const [storeyId, setStoreyId] = useState<string | null>(dataset.storeys.find((s) => Math.abs(s.elevation) < .1)?.id ?? dataset.storeys[0]?.id ?? null);
  const [entranceId, setEntranceId] = useState("");
  const [status, setStatus] = useState("fail");
  const [query, setQuery] = useState("");
  const [wholeBuilding, setWholeBuilding] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [labels, setLabels] = useState<ReferenceLabels>({});
  const [scopeOverrides, setScopeOverrides] = useState<ScopeOverrides>({});
  const [layers, setLayers] = useState<ValidationLayers>({ graph: false, doors: true, stairs: true, elevators: true });
  const [referenceNote, setReferenceNote] = useState("");
  const [notice, setNotice] = useState("");
  const [referenceReady, setReferenceReady] = useState(false);
  const referenceFile = useRef<HTMLInputElement>(null);
  const result = useMemo(() => validateGraph(dataset, profile, scopeOverrides), [dataset, profile, scopeOverrides]);
  const entrance = result.entrances.find((e) => e.door.id === entranceId) ?? result.entrances[0];
  const allCases = useMemo(() => [...result.cases, ...result.entrances.flatMap((e) => e.cases)], [result]);
  const validIds = useMemo(() => new Set(allCases.map((c) => c.id)), [allCases]);
  const selected = allCases.find((c) => c.id === selectedId) ?? null;
  const selectedScope = selected && ["space_connection", "entrance_reachability"].includes(selected.rule) ? result.scopes.get(selected.entityId) : null;
  const explanation = selected ? caseExplanation(selected) : null;
  const fingerprint = dataset.validation?.fingerprint;
  const storageKey = fingerprint ? `hsimg-validation:${VALIDATION_VERSION}:${fingerprint}` : null;
  useEffect(() => {
    if (storageKey) try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      const ids = new Set([...dataset.spaces.map((s) => s.spaceNodeId), ...dataset.nodes.filter((n) => n.nodeType === "space").map((n) => n.id)]);
      setScopeOverrides(readScopeOverrides(saved.scopeOverrides ?? {}, ids)); setLabels(saved.labels ?? {}); setReferenceNote(saved.note ?? "");
    } catch { setNotice("The saved review could not be restored from this browser."); }
    setReferenceReady(true);
  }, [storageKey, dataset]);
  useEffect(() => {
    if (!referenceReady || !storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ labels, note: referenceNote, scopeOverrides })); }
    catch { setNotice("The review could not be saved in this browser. Export the reference JSON to preserve it."); }
  }, [labels, referenceNote, scopeOverrides, referenceReady, storageKey]);
  const viewCases = useMemo(() => mode === "reach" ? entrance?.cases ?? [] : result.cases.filter((c) => !rule || c.rule === rule), [mode, entrance, result, rule]);
  const filtered = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return viewCases.filter((c) => (status === "all" || c.status === status) && (wholeBuilding || c.storeyId === storeyId || !c.storeyId) && (!text || `${c.label} ${c.entityId} ${c.detail}`.toLocaleLowerCase().includes(text)));
  }, [viewCases, status, wholeBuilding, storeyId, query]);
  useEffect(() => { setPage(0); }, [mode, rule, status, wholeBuilding, storeyId, query, entranceId, profile, scopeOverrides]);
  const summaries = useMemo(() => summarize(result.cases), [result]);
  const metricRows = useMemo(() => summarize(allCases).map((row) => ({ ...row, ...metrics(allCases.filter((c) => c.rule === row.rule), labels) })), [allCases, labels]);
  const totalMetrics = useMemo(() => metrics(allCases, labels), [allCases, labels]);
  const failed = result.cases.filter((c) => c.status === "fail");
  const excludedSpaces = [...result.scopes.values()].filter((s) => s.excluded).length;
  const floorLabel = (id: string | null) => dataset.storeys.find((s) => s.id === id)?.label ?? "Multiple / unassigned";
  const select = (c: ValidationCase) => {
    setSelectedId(c.id);
    const floor = c.storeyId ?? dataset.nodes.find((n) => c.nodeIds.includes(n.id) && n.storeyId)?.storeyId ?? dataset.verticalFeatures.find((v) => c.verticalIds.includes(v.verticalId))?.storeyIds[0];
    if (floor) setStoreyId(floor);
  };
  const setLabel = (id: string, value: string) => setLabels((previous) => { const next = { ...previous }; if (value === "anomaly" || value === "normal") next[id] = value; else delete next[id]; return next; });
  const changeScope = (id: string, value: string) => {
    setScopeOverrides((previous) => { const next = { ...previous }; if (value === "include" || value === "exclude") next[id] = value; else delete next[id]; return next; });
    // Scope changes can alter routes anywhere: a previous reference is no longer comparable.
    setLabels({});
    setNotice("Scope updated. Reference labels were cleared because route results may change. Restore the previous scope before importing its reference JSON.");
  };
  const referenceSelect = (c: ValidationCase, name: string) => <select aria-label={name} disabled={c.status === "excluded" || c.status === "unknown"} value={labels[c.id] ?? ""} onChange={(e) => setLabel(c.id, e.target.value)}><option value="">Not reviewed</option><option value="anomaly">Confirmed anomaly</option><option value="normal">No actual anomaly</option></select>;
  const exportCases = () => download("validation-cases.csv", csvRows([
    ["case_id", "rule", "entity_id", "name", "storey_id", "entrance_id", "profile", "status", "predicted_anomaly", "reference", "evidence", "interpretation", "recommended_review", "criterion", "dataset_sha256", "validator_version", "scope_overrides"],
    ...allCases.map((c) => { const e = caseExplanation(c); return [c.id, c.rule, c.entityId, c.label, c.storeyId, c.entranceId, c.entranceId ? profile : "topology", c.status, ["unknown", "excluded"].includes(c.status) ? "" : c.status === "fail" ? 1 : 0, labels[c.id] ?? "", c.detail, e.interpretation, e.action, RULES[c.rule]?.criterion, fingerprint, VALIDATION_VERSION, JSON.stringify(scopeOverrides)]; }),
  ]), "text/csv;charset=utf-8");
  const exportMetrics = () => download("validation-metrics.csv", csvRows([
    ["rule", "total", "pass", "issue", "unknown", "out_of_scope", "reviewed_evaluable", "excluded_from_metrics", "TP", "FP", "FN", "TN", "precision", "recall", "F1", "dataset_sha256", "profile", "validator_version", "scope_overrides"],
    ...metricRows.map((r) => [r.rule, r.total, r.pass, r.fail, r.unknown, r.outOfScope, r.evaluated, r.excluded, r.tp, r.fp, r.fn, r.tn, r.precision, r.recall, r.f1, fingerprint, profile, VALIDATION_VERSION, JSON.stringify(scopeOverrides)]),
  ]), "text/csv;charset=utf-8");

  return <section className="validation-workbench" aria-label="IFC model and graph validation">
    <div className="validation-heading"><div><p className="eyebrow">CONNECTIVITY CHECKS</p><h2>Model and graph validation</h2><p>Locate issues by floor and inspect which spaces can be reached from each exterior door.</p></div><div className="validation-actions"><button className="secondary-button" onClick={exportCases}>Export cases CSV</button><button className="secondary-button" onClick={exportMetrics}>Export metrics CSV</button></div></div>
    {result.warnings.map((w) => <p className="validation-warning" key={w}>{w}</p>)}
    <div className="validation-cards" aria-label="Validation summary">
      {[["Spaces without connections", "space_connection"], ["Stair exits with issues", "stair_floor"], ["Elevator stops with issues", "elevator_floor"], ["Doors with issues", "door_connection"]].map(([label, id]) => <button key={id} className="validation-card" onClick={() => { setMode("issues"); setRule(id); setStatus("fail"); }}><span>{label}</span><strong>{failed.filter((c) => c.rule === id).length}</strong><small>View building cases →</small></button>)}
    </div>
    <div className="validation-scope-summary"><div><strong>{excludedSpaces} intentionally non-accessible spaces excluded</strong><p>Service shafts and construction zones are excluded by their IFC labels, never solely because a door is missing. They remain visible in grey and are not destinations or transit areas in exterior routes.</p></div><button className="secondary-button" onClick={() => { setMode("issues"); setRule("space_connection"); setStatus("excluded"); setQuery(""); setWholeBuilding(true); }}>Review excluded spaces</button></div>
    <div className="validation-controls">
      <label>Analysis<select aria-label="Validation analysis" value={mode} onChange={(e) => { setMode(e.target.value as "issues" | "reach"); setSelectedId(null); }}><option value="issues">Connection issues</option><option value="reach">Access from exterior doors</option></select></label>
      <label>Map floor<select aria-label="Validation floor" value={storeyId ?? ""} onChange={(e) => setStoreyId(e.target.value || null)}>{dataset.storeys.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}<option value="">Unassigned floor</option></select></label>
      {mode === "issues" ? <label>Check<select aria-label="Validation check" value={rule} onChange={(e) => { setRule(e.target.value); setSelectedId(null); }}><option value="">All checks</option>{summaries.map((r) => <option key={r.rule} value={r.rule}>{r.label}</option>)}</select></label> : <><label>Mobility profile<select aria-label="Mobility profile" value={profile} onChange={(e) => setProfile(e.target.value as Profile)}><option value="general">General</option><option value="wheelchair">Wheelchair</option></select></label><label>Exterior door<select aria-label="Exterior door" value={entrance?.door.id ?? ""} onChange={(e) => { setEntranceId(e.target.value); setSelectedId(null); }}>{result.entrances.map((e, i) => <option key={e.door.id} value={e.door.id}>D{i + 1} · {e.door.id}</option>)}</select></label></>}
    </div>
    {mode === "reach" && <div className="validation-reach-summary" aria-live="polite"><strong>{entrance ? `${entrance.reachable} reachable · ${entrance.unreachable} unreachable · ${entrance.unknown} unknown · ${entrance.excluded} excluded` : "No exterior doors identified"}</strong><span>Whole building · {profile} profile. Arrival means reaching at least one interior node, not every part of a space.</span></div>}
    <div className="validation-map-grid">
      <ValidationMap2D key={`${fingerprint ?? dataset.name}:${storeyId}`} dataset={dataset} storeyId={storeyId} cases={viewCases} inspectionCases={result.cases} selected={selected} entranceId={mode === "reach" ? entrance?.door.id : undefined} layers={layers} onLayersChange={setLayers} onSelect={select} />
      <aside className="validation-inspector" aria-label="Validation details">
        <p className="eyebrow">INSPECTOR</p><h3>{selected?.label ?? "Select a space or element"}</h3>
        {selected ? <><span className={`validation-badge ${selected.status}`}>{STATUS_LABEL[selected.status]}</span><h4>Evidence</h4><p>{selected.detail}</p><h4>What this means</h4><p>{explanation?.interpretation}</p><h4>Recommended review</h4><p>{explanation?.action}</p><dl><dt>Check</dt><dd>{RULES[selected.rule]?.label}</dd><dt>Identifier</dt><dd><code>{selected.entityId}</code></dd><dt>Floor</dt><dd>{floorLabel(selected.storeyId)}</dd></dl><details><summary>Check criterion</summary><p>{RULES[selected.rule]?.criterion}</p></details>
          {selectedScope && <div className="validation-scope-control"><label>Access requirement<select aria-label="Space access requirement" value={scopeOverrides[selected.entityId] ?? "auto"} onChange={(e) => changeScope(selected.entityId, e.target.value)}><option value="auto">Automatic from IFC labels</option><option value="include">Require access</option><option value="exclude">Intentionally non-accessible</option></select></label><p>{selectedScope.reason}</p><small>Changing scope clears reference labels. Export your reference first to retain it.</small></div>}
          <label>Independent reference{referenceSelect(selected, "Selected case reference")}</label></> : <p>Click a space, door, stair or elevator, or choose Locate in the table. Red indicates a case to review; it does not confirm an IFC error.</p>}
      </aside>
    </div>
    <div className="validation-table-heading"><div><h3>Checked cases</h3><p>{filtered.length.toLocaleString("en")} cases match these filters. The map uses the selected check and floor; table filters do not hide map features.</p></div><div className="validation-actions"><label>Status<select aria-label="Case status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="fail">Issues</option><option value="pass">Passes</option><option value="unknown">Unknown</option><option value="excluded">Excluded by scope</option><option value="all">All</option></select></label><label>Search<input aria-label="Search cases" value={query} placeholder="Name, identifier or evidence" onChange={(e) => setQuery(e.target.value)} /></label><label className="validation-inline"><input type="checkbox" checked={wholeBuilding} onChange={(e) => setWholeBuilding(e.target.checked)} /> Whole-building table</label></div></div>
    <div className="validation-table-scroll"><table className="validation-table"><thead><tr><th>Element</th><th>Check</th><th>Floor</th><th>Result</th><th>Independent reference</th><th>Map</th></tr></thead><tbody>{filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((c) => <tr key={c.id} className={selectedId === c.id ? "selected" : ""}><td><strong>{c.label}</strong><code>{c.entityId}</code></td><td>{RULES[c.rule]?.label}</td><td>{floorLabel(c.storeyId)}</td><td><span className={`validation-badge ${c.status}`}>{STATUS_LABEL[c.status]}</span><small>{c.detail}</small></td><td>{referenceSelect(c, `Reference ${c.entityId}`)}</td><td><button className="secondary-button" onClick={() => select(c)}>Locate</button></td></tr>)}</tbody></table>{!filtered.length && <p className="validation-empty">No cases match these filters.</p>}</div>
    <div className="validation-pagination"><span>Page {Math.min(page + 1, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)))} of {Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}</span><button className="secondary-button" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button><button className="secondary-button" disabled={(page + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage((p) => p + 1)}>Next</button></div>
    <details className="validation-section" open={mode === "reach"}><summary>Reachability from each exterior door · {result.entrances.length} doors</summary><p>All inventoried spaces remain listed. Percentages use required destinations only; excluded spaces count as neither passes nor failures. All identified exterior doors are retained, including disconnected or restricted doors.</p><div className="validation-table-scroll limited"><table className="validation-table"><thead><tr><th>Origin</th><th>Reachable</th><th>Unreachable</th><th>Unknown</th><th>Excluded</th><th>% required spaces reached</th><th>Map</th></tr></thead><tbody>{result.entrances.map((e, i) => <tr key={e.door.id}><td><strong>Exterior door D{i + 1}</strong><code>{e.door.id}</code></td><td>{e.reachable}</td><td>{e.unreachable}</td><td>{e.unknown}</td><td>{e.excluded}</td><td>{e.cases.length > e.excluded ? (100 * e.reachable / (e.cases.length - e.excluded)).toFixed(1) + "%" : "—"}</td><td><button className="secondary-button" onClick={() => { setMode("reach"); setEntranceId(e.door.id); if (e.door.storeyId) setStoreyId(e.door.storeyId); }}>View spaces</button></td></tr>)}</tbody></table></div></details>
    <section className="validation-section" aria-label="Metrics and reference"><div className="validation-table-heading"><div><h3>Detection results and metrics</h3><p>Whole building and all exterior doors · routing profile: {profile}. Positive = a flagged issue or an unreachable required space, depending on the check.</p></div><div className="validation-actions"><button className="secondary-button" disabled={!fingerprint} onClick={() => referenceFile.current?.click()}>Import reference JSON</button><button className="secondary-button" disabled={!fingerprint} onClick={() => download("validation-reference.json", JSON.stringify({ schema: "hsimg-validation-reference", version: VALIDATION_VERSION, fingerprint, profile, scopeOverrides, note: referenceNote, labels: Object.fromEntries(Object.entries(labels).filter(([id]) => validIds.has(id))) }, null, 2), "application/json")}>Export reference JSON</button></div></div>
      <input ref={referenceFile} className="visually-hidden" type="file" accept=".json" aria-label="Reference file" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file || !fingerprint) return; try { const imported = importReference(await file.text(), fingerprint, validIds, scopeOverrides); setLabels((old) => ({ ...old, ...imported })); setNotice(`Imported ${Object.keys(imported).length} reference labels.`); } catch (error) { setNotice(error instanceof Error ? error.message : "Invalid reference."); } }} />
      <label className="validation-reference-note">Reference provenance<input value={referenceNote} onChange={(e) => setReferenceNote(e.target.value)} placeholder="Reviewer, date, plan or site inspection used" /></label>
      <p className="validation-warning">{totalMetrics.evaluated ? `${totalMetrics.evaluated} of ${totalMetrics.total} cases have an evaluable independent reference. Metrics describe that subset only; review passing cases too to identify false negatives.` : "Precision, recall and F1 require an independent reference. Review cases or import reference labels; automatic predictions are never used as ground truth."}</p>
      {notice && <p className="validation-note" role="status">{notice}</p>}
      <div className="validation-table-scroll"><table className="validation-table" aria-label="Metrics table"><thead><tr><th>Check</th><th>Cases</th><th>Pass</th><th>Issue</th><th>Unknown</th><th>Out of scope</th><th>Reviewed</th><th>TP</th><th>FP</th><th>FN</th><th>TN</th><th>Precision</th><th>Recall</th><th>F1</th></tr></thead><tbody>{metricRows.map((r) => <tr key={r.rule}><td>{r.label}</td><td>{r.total}</td><td>{r.pass}</td><td>{r.fail}</td><td>{r.unknown}</td><td>{r.outOfScope}</td><td>{r.evaluated}</td><td>{r.tp}</td><td>{r.fp}</td><td>{r.fn}</td><td>{r.tn}</td><td>{number(r.precision)}</td><td>{number(r.recall)}</td><td>{number(r.f1)}</td></tr>)}</tbody></table></div><p className="validation-note">Precision = TP/(TP+FP) · Recall = TP/(TP+FN) · F1 = 2TP/(2TP+FP+FN). “—” means no reference or a zero denominator. Unreviewed, unknown and out-of-scope cases are excluded from metrics. Labels and scope are saved in this browser and bound to the dataset SHA-256 and validator version. Export JSON to share the review.</p>
    </section>
    <details className="validation-section"><summary>Validation criteria and limits</summary><dl className="validation-criteria">{Object.entries(RULES).map(([id, r]) => <div key={id}><dt>{r.label}</dt><dd>{r.criterion}</dd></div>)}</dl><p>Local topology checks do not impose a mobility profile. Exterior routes respect arc direction and profile permissions. Unknown accessibility is not reported as confirmed. The exported storeys, access associations and inventories can themselves contain errors. Source IFC identifiers and original model attributes are preserved.</p><p>Alternative routes around obstacles are not duplicates by definition. This graph alone does not prove a physically shortest route or validate clear widths, safety or evacuation. Those require walkable geometry or an independent reference. Stair continuity applies to exported elements; omitted IFC elements require comparison with the original IFC inventory.</p></details>
    <details className="validation-section"><summary>Generator diagnostics · {dataset.validation?.sourceIssues.length ?? 0} source records</summary><p>Extraction log, including repairs and rejected connections. These historical records are not added to current issues or detection metrics. Source identifiers and model attributes are retained as supplied.</p><div className="validation-table-scroll limited"><table className="validation-table"><thead><tr><th>Type</th><th>Severity</th><th>Element</th><th>Details</th></tr></thead><tbody>{dataset.validation?.sourceIssues.map((i) => <tr key={i.id}><td>{i.type}</td><td>{i.severity}</td><td><code>{i.nodeId || i.ifcGuid}</code></td><td>{i.message}<small>{i.action}</small></td></tr>)}</tbody></table></div></details>
  </section>;
}

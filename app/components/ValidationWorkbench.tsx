"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphDataset } from "../lib/types";
import { csvRows, importReference, metrics, RULES, STATUS_LABEL, summarize, validateGraph, VALIDATION_VERSION } from "../lib/validation";
import type { Profile, ReferenceLabels, ValidationCase } from "../lib/validation";
import { ValidationMap2D } from "./ValidationMap2D";

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
  const [referenceNote, setReferenceNote] = useState("");
  const [notice, setNotice] = useState("");
  const [referenceReady, setReferenceReady] = useState(false);
  const referenceFile = useRef<HTMLInputElement>(null);
  const result = useMemo(() => validateGraph(dataset, profile), [dataset, profile]);
  const entrance = result.entrances.find((e) => e.door.id === entranceId) ?? result.entrances[0];
  const allCases = useMemo(() => [...result.cases, ...result.entrances.flatMap((e) => e.cases)], [result]);
  const validIds = useMemo(() => new Set(allCases.map((c) => c.id)), [allCases]);
  const selected = allCases.find((c) => c.id === selectedId) ?? null;
  const fingerprint = dataset.validation?.fingerprint;
  const storageKey = fingerprint ? `hsimg-validation:${VALIDATION_VERSION}:${fingerprint}` : null;
  useEffect(() => {
    if (storageKey) try { const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}"); setLabels(saved.labels ?? {}); setReferenceNote(saved.note ?? ""); } catch { setNotice("No se pudo recuperar la referencia guardada en este navegador."); }
    setReferenceReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (!referenceReady || !storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ labels, note: referenceNote })); } catch { setNotice("No se pudo guardar la revisión en el navegador. Exporte la referencia JSON para conservarla."); }
  }, [labels, referenceNote, referenceReady, storageKey]);
  const viewCases = useMemo(() => mode === "reach" ? entrance?.cases ?? [] : result.cases.filter((c) => !rule || c.rule === rule), [mode, entrance, result, rule]);
  const filtered = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return viewCases.filter((c) => (status === "all" || c.status === status) && (wholeBuilding || c.storeyId === storeyId || !c.storeyId) && (!text || `${c.label} ${c.entityId} ${c.detail}`.toLocaleLowerCase().includes(text)));
  }, [viewCases, status, wholeBuilding, storeyId, query]);
  useEffect(() => { setPage(0); }, [mode, rule, status, wholeBuilding, storeyId, query, entranceId, profile]);
  const summaries = useMemo(() => summarize(result.cases), [result]);
  const metricRows = useMemo(() => summarize(allCases).map((row) => ({ ...row, ...metrics(allCases.filter((c) => c.rule === row.rule), labels) })), [allCases, labels]);
  const totalMetrics = useMemo(() => metrics(allCases, labels), [allCases, labels]);
  const failed = result.cases.filter((c) => c.status === "fail");
  const select = (c: ValidationCase) => {
    setSelectedId(c.id);
    const floor = c.storeyId ?? dataset.nodes.find((n) => c.nodeIds.includes(n.id) && n.storeyId)?.storeyId ?? dataset.verticalFeatures.find((v) => c.verticalIds.includes(v.verticalId))?.storeyIds[0];
    if (floor) setStoreyId(floor);
  };
  const setLabel = (id: string, value: string) => setLabels((previous) => { const next = { ...previous }; if (value === "anomaly" || value === "normal") next[id] = value; else delete next[id]; return next; });
  const exportCases = () => download("validacion-casos.csv", csvRows([
    ["case_id", "rule", "entity_id", "name", "storey_id", "entrance_id", "profile", "status", "predicted_anomaly", "reference", "detail", "dataset_sha256", "validator_version"],
    ...allCases.map((c) => [c.id, c.rule, c.entityId, c.label, c.storeyId, c.entranceId, c.entranceId ? profile : "topology", c.status, c.status === "unknown" ? "" : c.status === "fail" ? 1 : 0, labels[c.id] ?? "", c.detail, fingerprint, VALIDATION_VERSION]),
  ]), "text/csv;charset=utf-8");
  const exportMetrics = () => download("validacion-metricas.csv", csvRows([
    ["rule", "total", "conforme", "incidencia", "no_evaluable", "revisados", "excluidos", "TP", "FP", "FN", "TN", "precision", "recall", "F1", "dataset_sha256", "profile"],
    ...metricRows.map((r) => [r.rule, r.total, r.pass, r.fail, r.unknown, r.evaluated, r.excluded, r.tp, r.fp, r.fn, r.tn, r.precision, r.recall, r.f1, fingerprint, profile]),
  ]), "text/csv;charset=utf-8");
  return <section className="validation-workbench" aria-label="Validación del modelo IFC y del grafo">
    <div className="validation-heading"><div><p className="eyebrow">CONTROL DE CONECTIVIDAD</p><h2>Validación del modelo y del grafo</h2><p>Localice incidencias por planta y compruebe qué espacios se alcanzan desde cada puerta exterior.</p></div><div className="validation-actions"><button className="secondary-button" onClick={exportCases}>Exportar casos CSV</button><button className="secondary-button" onClick={exportMetrics}>Exportar métricas CSV</button></div></div>
    {result.warnings.map((w) => <p className="validation-warning" key={w}>{w}</p>)}
    <div className="validation-cards" aria-label="Resumen de validación">
      {[ ["Espacios sin comunicación", failed.filter((c) => c.rule === "space_connection").length, "space_connection"], ["Salidas de escalera con incidencia", failed.filter((c) => c.rule === "stair_floor").length, "stair_floor"], ["Paradas de ascensor con incidencia", failed.filter((c) => c.rule === "elevator_floor").length, "elevator_floor"], ["Puertas con incidencia", failed.filter((c) => c.rule === "door_connection").length, "door_connection"] ].map(([label, count, id]) => <button key={id} className="validation-card" onClick={() => { setMode("issues"); setRule(String(id)); setStatus("fail"); }}><span>{label}</span><strong>{count}</strong><small>Ver casos del edificio →</small></button>)}
    </div>
    <div className="validation-controls">
      <label>Análisis<select aria-label="Análisis de validación" value={mode} onChange={(e) => { setMode(e.target.value as "issues" | "reach"); setSelectedId(null); }}><option value="issues">Incidencias de conexión</option><option value="reach">Acceso desde el exterior</option></select></label>
      <label>Planta del plano<select aria-label="Planta de validación" value={storeyId ?? ""} onChange={(e) => setStoreyId(e.target.value || null)}>{dataset.storeys.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}<option value="">Sin planta asignada</option></select></label>
      {mode === "issues" ? <label>Comprobación<select aria-label="Comprobación" value={rule} onChange={(e) => { setRule(e.target.value); setSelectedId(null); }}><option value="">Todas las comprobaciones</option>{summaries.map((r) => <option key={r.rule} value={r.rule}>{r.label}</option>)}</select></label> : <><label>Perfil de movilidad<select aria-label="Perfil de movilidad" value={profile} onChange={(e) => setProfile(e.target.value as Profile)}><option value="general">General</option><option value="wheelchair">Silla de ruedas</option></select></label><label>Puerta exterior<select aria-label="Puerta exterior" value={entrance?.door.id ?? ""} onChange={(e) => { setEntranceId(e.target.value); setSelectedId(null); }}>{result.entrances.map((e, i) => <option key={e.door.id} value={e.door.id}>P{i + 1} · {e.door.name} · {e.door.id}</option>)}</select></label></>}
    </div>
    {mode === "reach" && <div className="validation-reach-summary" aria-live="polite"><strong>{entrance ? `${entrance.reachable} con ruta · ${entrance.unreachable} sin ruta · ${entrance.unknown} no evaluables` : "Sin puertas exteriores identificadas"}</strong><span>Todo el edificio · {profile === "general" ? "perfil general" : "silla de ruedas"}. Llegar a un espacio significa alcanzar al menos un nodo de su interior; no garantiza recorrer toda su superficie.</span></div>}
    <div className="validation-map-grid">
      <ValidationMap2D key={`${fingerprint ?? dataset.name}:${storeyId}`} dataset={dataset} storeyId={storeyId} cases={viewCases} selected={selected} entranceId={mode === "reach" ? entrance?.door.id : undefined} onSelect={select} />
      <aside className="validation-inspector" aria-label="Detalle de validación">
        <p className="eyebrow">INSPECTOR</p><h3>{selected?.label ?? "Seleccione una incidencia"}</h3>
        {selected ? <><span className={`validation-badge ${selected.status}`}>{STATUS_LABEL[selected.status]}</span><p>{selected.detail}</p><dl><dt>Comprobación</dt><dd>{RULES[selected.rule]?.label}</dd><dt>Identificador</dt><dd><code>{selected.entityId}</code></dd><dt>Planta</dt><dd>{dataset.storeys.find((s) => s.id === selected.storeyId)?.label ?? "Varias plantas / no asignada"}</dd></dl><p className="validation-note">{RULES[selected.rule]?.criterion}</p><label>Referencia independiente<select aria-label="Referencia del caso seleccionado" value={labels[selected.id] ?? ""} onChange={(e) => setLabel(selected.id, e.target.value)}><option value="">Sin revisar</option><option value="anomaly">Anomalía real</option><option value="normal">Sin anomalía real</option></select></label></> : <p>Pulse un espacio o elemento del plano, o «Localizar» en la tabla. El color rojo señala un caso que revisar, no confirma por sí solo un error del IFC.</p>}
      </aside>
    </div>
    <div className="validation-table-heading"><div><h3>Casos comprobados</h3><p>{filtered.length.toLocaleString("es")} casos con estos filtros. El plano muestra los estados de la comprobación elegida en su planta.</p></div><div className="validation-actions"><label>Estado<select aria-label="Estado de los casos" value={status} onChange={(e) => setStatus(e.target.value)}><option value="fail">Incidencias</option><option value="pass">Conformes</option><option value="unknown">No evaluables</option><option value="all">Todos</option></select></label><label>Buscar<input aria-label="Buscar caso" value={query} placeholder="Nombre, identificador o detalle" onChange={(e) => setQuery(e.target.value)} /></label><label className="validation-inline"><input type="checkbox" checked={wholeBuilding} onChange={(e) => setWholeBuilding(e.target.checked)} /> Tabla de todo el edificio</label></div></div>
    <div className="validation-table-scroll"><table className="validation-table"><thead><tr><th>Elemento</th><th>Comprobación</th><th>Planta</th><th>Resultado</th><th>Referencia independiente</th><th>Plano</th></tr></thead><tbody>{filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((c) => <tr key={c.id} className={selectedId === c.id ? "selected" : ""}><td><strong>{c.label}</strong><code>{c.entityId}</code></td><td>{RULES[c.rule]?.label}</td><td>{dataset.storeys.find((s) => s.id === c.storeyId)?.label ?? "Varias / sin asignar"}</td><td><span className={`validation-badge ${c.status}`}>{STATUS_LABEL[c.status]}</span><small>{c.detail}</small></td><td><select aria-label={`Referencia ${c.entityId}`} value={labels[c.id] ?? ""} onChange={(e) => setLabel(c.id, e.target.value)}><option value="">Sin revisar</option><option value="anomaly">Anomalía real</option><option value="normal">Sin anomalía real</option></select></td><td><button className="secondary-button" onClick={() => select(c)}>Localizar</button></td></tr>)}</tbody></table>{!filtered.length && <p className="validation-empty">No hay casos con estos filtros.</p>}</div>
    <div className="validation-pagination"><span>Página {Math.min(page + 1, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)))} de {Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}</span><button className="secondary-button" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</button><button className="secondary-button" disabled={(page + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage((p) => p + 1)}>Siguiente</button></div>
    <details className="validation-section" open={mode === "reach"}><summary>Alcanzabilidad desde cada puerta exterior · {result.entrances.length} puertas</summary><p>Universo: todos los espacios inventariados y todas las puertas identificadas como exteriores, incluidas las desconectadas o restringidas. Una ruta bloqueada por el perfil no demuestra un fallo del modelo.</p><div className="validation-table-scroll limited"><table className="validation-table"><thead><tr><th>Origen</th><th>Con ruta</th><th>Sin ruta</th><th>No evaluables</th><th>% con ruta</th><th>Plano</th></tr></thead><tbody>{result.entrances.map((e, i) => <tr key={e.door.id}><td><strong>P{i + 1} · {e.door.name}</strong><code>{e.door.id}</code></td><td>{e.reachable}</td><td>{e.unreachable}</td><td>{e.unknown}</td><td>{e.cases.length ? (100 * e.reachable / e.cases.length).toFixed(1) : "—"}%</td><td><button className="secondary-button" onClick={() => { setMode("reach"); setEntranceId(e.door.id); if (e.door.storeyId) setStoreyId(e.door.storeyId); }}>Ver espacios</button></td></tr>)}</tbody></table></div></details>
    <section className="validation-section" aria-label="Métricas y referencia"><div className="validation-table-heading"><div><h3>Resultados y métricas de detección</h3><p>Todo el edificio y todas las puertas · perfil de rutas: {profile === "general" ? "general" : "silla de ruedas"}. Positivo = incidencia o espacio sin ruta, según la regla.</p></div><div className="validation-actions"><button className="secondary-button" disabled={!fingerprint} onClick={() => referenceFile.current?.click()}>Importar referencia JSON</button><button className="secondary-button" disabled={!fingerprint} onClick={() => download("validacion-referencia.json", JSON.stringify({ schema: "hsimg-validation-reference", version: VALIDATION_VERSION, fingerprint, profile, note: referenceNote, labels: Object.fromEntries(Object.entries(labels).filter(([id]) => validIds.has(id))) }, null, 2), "application/json")}>Exportar referencia JSON</button></div></div>
      <input ref={referenceFile} className="visually-hidden" type="file" accept=".json" aria-label="Archivo de referencia" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file || !fingerprint) return; try { const imported = importReference(await file.text(), fingerprint, validIds); setLabels((old) => ({ ...old, ...imported })); setNotice(`Importadas ${Object.keys(imported).length} etiquetas de referencia.`); } catch (error) { setNotice(error instanceof Error ? error.message : "Referencia no válida."); } }} />
      <label className="validation-reference-note">Procedencia de la referencia<input value={referenceNote} onChange={(e) => setReferenceNote(e.target.value)} placeholder="Revisor, fecha, plano o inspección utilizados" /></label>
      <p className="validation-warning">{totalMetrics.evaluated ? `${totalMetrics.evaluated} de ${totalMetrics.total} casos evaluados con referencia. Las métricas describen solo ese subconjunto; revisar también casos conformes permite detectar falsos negativos.` : "Precisión, exhaustividad y F1 no son calculables sin referencia independiente. Etiquete los casos o importe una revisión; no se utiliza el resultado automático como verdad de referencia."}</p>
      {notice && <p className="validation-note" role="status">{notice}</p>}
      <div className="validation-table-scroll"><table className="validation-table" aria-label="Tabla de métricas"><thead><tr><th>Comprobación</th><th>Casos</th><th>Conformes</th><th>Incidencias</th><th>No evaluables</th><th>Revisados</th><th>TP</th><th>FP</th><th>FN</th><th>TN</th><th>Precisión</th><th>Exhaustividad</th><th>F1</th></tr></thead><tbody>{metricRows.map((r) => <tr key={r.rule}><td>{r.label}</td><td>{r.total}</td><td>{r.pass}</td><td>{r.fail}</td><td>{r.unknown}</td><td>{r.evaluated}</td><td>{r.tp}</td><td>{r.fp}</td><td>{r.fn}</td><td>{r.tn}</td><td>{number(r.precision)}</td><td>{number(r.recall)}</td><td>{number(r.f1)}</td></tr>)}</tbody></table></div><p className="validation-note">Precisión = TP/(TP+FP) · Exhaustividad = TP/(TP+FN) · F1 = 2TP/(2TP+FP+FN). «—» indica denominador cero o ausencia de referencia. Los casos sin revisar y no evaluables se excluyen. Las etiquetas se guardan en este navegador y se vinculan al SHA-256 del GeoPackage; exporte el JSON para compartirlas.</p>
    </section>
    <details className="validation-section"><summary>Criterios y límites de la validación</summary><dl className="validation-criteria">{Object.entries(RULES).map(([id, r]) => <div key={id}><dt>{r.label}</dt><dd>{r.criterion}</dd></div>)}</dl><p>La conectividad local se comprueba sin imponer un perfil y puede ser conforme aunque una ruta esté restringida. Las rutas exteriores respetan el sentido de los arcos y los atributos del perfil. Una accesibilidad desconocida no se presenta como confirmada. Las plantas y los accesos declarados por la exportación también pueden contener errores.</p><p>Los caminos alternativos alrededor de obstáculos no son duplicados por definición. El grafo por sí solo no demuestra que una ruta sea la más corta físicamente posible ni valida anchuras, seguridad o evacuación. Eso requiere contraste con geometría navegable o una referencia independiente. La continuidad de escaleras se verifica a nivel de los tramos exportados; los elementos IFC omitidos requieren cotejo con el inventario IFC original.</p></details>
    <details className="validation-section"><summary>Diagnósticos del generador · {dataset.validation?.sourceIssues.length ?? 0} registros de origen</summary><p>Registro de extracción: incluye reparaciones y conexiones rechazadas. No se suma a las incidencias actuales ni a las métricas.</p><div className="validation-table-scroll limited"><table className="validation-table"><thead><tr><th>Tipo</th><th>Nivel</th><th>Elemento</th><th>Detalle</th></tr></thead><tbody>{dataset.validation?.sourceIssues.map((i) => <tr key={i.id}><td>{i.type}</td><td>{i.severity}</td><td><code>{i.nodeId || i.ifcGuid}</code></td><td>{i.message}<small>{i.action}</small></td></tr>)}</tbody></table></div></details>
  </section>;
}

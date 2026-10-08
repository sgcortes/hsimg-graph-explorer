import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import initSqlJs from "sql.js";
import { validateGraph, metrics, importReference, csvRows, spaceScope, readScopeOverrides, VALIDATION_VERSION } from "../app/lib/validation.ts";

const node = (id, props = {}) => ({ id, name: id, x: 0, y: 0, z: 0, nodeType: "internal_mobility", nodeRole: "axis_junction", mobilityType: "horizontal", parentNodeId: null, subgraphId: null, hierarchyLevel: 2, storeyId: "L0", accessibleGeneral: true, accessibleWheelchair: true, category: "internal", metadata: {}, raw: {}, ...props });
const edge = (source, target, props = {}) => ({ id: `${source}-${target}`, source, target, edgeType: "connection", mobilityMode: "walk", subgraphId: null, points: [[0, 0, 0], [1, 0, 0]], accessibleGeneral: true, accessibleWheelchair: true, metadata: {}, raw: {}, ...props });
const space = (id, storeyId = "L0") => ({ id, spaceNodeId: id, name: id, storeyId, nodeClass: "finalist", rings: [], metadata: {} });
const door = (id, exterior = true, spaceIds = []) => ({ id, name: id, storeyId: "L0", spaceIds, exterior, entrance: exterior, point: [0, 0, 0], metadata: {} });
function dataset(nodes, edges, spaces = [], doors = [], verticalFeatures = []) {
  return { name: "test", sourceType: "gpkg", nodes, edges, spaces, verticalFeatures, storeys: [{ id: "L0", elevation: 0, label: "Ground" }, { id: "L1", elevation: 3, label: "First" }], warnings: [], validation: { fingerprint: "test-sha", doors, subgraphs: [], sourceIssues: [], modelMetadata: {}, inventory: { spaces: true, doors: true, vertical: true } } };
}
test("horizontal semantic parent is not an isolated space; omitted space is detected", () => {
  const data = dataset([node("hall", { nodeType: "space", nodeRole: "semantic_parent" }), node("axis", { parentNodeId: "hall" }), node("door", { nodeType: "door" })], [edge("door", "axis")], [space("hall"), space("missing")]);
  const result = validateGraph(data);
  assert.equal(result.cases.find((c) => c.entityId === "hall" && c.rule === "space_connection").status, "pass");
  assert.equal(result.cases.find((c) => c.entityId === "missing").status, "fail");
});
test("directed reachability preserves disconnected doors and distinguishes unknown permissions", () => {
  const data = dataset([node("door", { nodeType: "door" }), node("a", { nodeType: "space" }), node("b", { nodeType: "space" })], [edge("door", "a"), edge("a", "b", { accessibleWheelchair: null })], [space("a"), space("b")], [door("door"), door("absent")]);
  const result = validateGraph(data, "wheelchair");
  assert.deepEqual([result.entrances[0].reachable, result.entrances[0].unknown, result.entrances[1].unreachable], [1, 1, 2]);
  data.edges = [edge("a", "door")];
  assert.equal(validateGraph(data).entrances[0].unreachable, 2);
});
test("IfcSpace-derived elevator cabins are represented by their stop nodes", () => {
  const v = { id: "lift", verticalId: "lift", verticalType: "elevator", name: "Lift", storeyIds: ["L0"], paths: [], rings: [], metadata: { properties: { "HSIMG.SourceSpaceIdsByStorey": { L0: ["cabin"] } } } };
  const data = dataset([node("cabin", { nodeType: "space" }), node("stop", { parentNodeId: "lift", nodeRole: "elevator_stop" }), node("d", { nodeType: "door" })], [edge("d", "stop")], [space("cabin")], [door("d")], [v]);
  const r = validateGraph(data);
  assert.equal(r.cases.find((c) => c.rule === "space_connection").status, "pass");
  assert.equal(r.entrances[0].reachable, 1);
  // The cabin itself cannot satisfy the required exit to a floor.
  assert.equal(r.cases.find((c) => c.rule === "elevator_floor").status, "fail");
});
test("door connection cannot be satisfied by a detour through another door", () => {
  const data = dataset([node("d", { nodeType: "door" }), node("other", { nodeType: "door" }), node("a", { nodeType: "space" }), node("b", { nodeType: "space" })], [edge("d", "a"), edge("a", "other"), edge("other", "b")], [space("a"), space("b")], [door("d", false, ["a", "b"])]);
  assert.equal(validateGraph(data).cases.find((c) => c.rule === "door_connection").status, "fail");
});
test("elevator needs access on its own floor; a missing expected stop is a failure", () => {
  const v = { id: "v", verticalId: "v", verticalType: "elevator", name: "Lift", routeType: "pedestrian", pedestrianAccess: true, vehicleAccess: false, storeyIds: ["L0", "L1", "L2"], paths: [], rings: [], metadata: {} };
  const data = dataset([node("v", { nodeType: "vertical_mobility" }), node("stop0", { parentNodeId: "v", mobilityType: "elevator", nodeRole: "elevator_stop" }), node("stop1", { parentNodeId: "v", mobilityType: "elevator", nodeRole: "elevator_stop", storeyId: "L1", z: 3 }), node("hall", { nodeType: "space", storeyId: "L1", z: 3 })], [edge("stop0", "stop1", { edgeType: "vertical_path" }), edge("stop1", "hall")], [space("hall", "L1")], [], [v]);
  assert.deepEqual(validateGraph(data).cases.filter((c) => c.rule === "elevator_floor").map((c) => [c.storeyId, c.status]), [["L0", "fail"], ["L1", "pass"], ["L2", "fail"]]);
});
test("stairs detect broken flights without demanding exits from intermediate landings", () => {
  const v = { id: "s", verticalId: "s", verticalType: "stair", name: "Stair", routeType: "pedestrian", pedestrianAccess: true, vehicleAccess: false, storeyIds: ["L0", "L1"], paths: [], rings: [], metadata: {} };
  const data = dataset([node("first", { parentNodeId: "s", nodeRole: "landing" }), node("middle", { parentNodeId: "s", nodeRole: "intermediate_landing", storeyId: null, z: 1.5 }), node("last", { parentNodeId: "s", nodeRole: "landing", storeyId: "L1", z: 3 })], [edge("first", "middle", { edgeType: "vertical_path" })], [], [], [v]);
  const result = validateGraph(data);
  assert.equal(result.cases.find((c) => c.rule === "vertical_continuity").status, "fail");
  assert.equal(result.cases.filter((c) => c.rule === "stair_floor").length, 2);
});
test("reverse arcs and distinct routes are not duplicates; repeated geometry and missing endpoints fail", () => {
  const data = dataset([node("a"), node("b")], [edge("a", "b"), edge("b", "a"), edge("a", "b", { id: "different", points: [[0, 0, 0], [2, 1, 0], [1, 0, 0]] }), edge("a", "b", { id: "duplicate" }), edge("a", "absent")]);
  const result = validateGraph(data);
  assert.deepEqual(result.cases.filter((c) => c.rule === "duplicate_connection" && c.status === "fail").map((c) => c.entityId), ["duplicate"]);
  assert.equal(result.cases.filter((c) => c.rule === "edge_integrity" && c.status === "fail").length, 1);
});
test("metrics require reference labels, including conforming cases to measure false negatives", () => {
  const cases = [{ id: "tp", status: "fail" }, { id: "fp", status: "fail" }, { id: "fn", status: "pass" }, { id: "tn", status: "pass" }, { id: "unknown", status: "unknown" }, { id: "unreviewed", status: "fail" }];
  assert.equal(metrics(cases, {}).f1, null);
  const r = metrics(cases, { tp: "anomaly", fp: "normal", fn: "anomaly", tn: "normal", unknown: "anomaly" });
  assert.deepEqual([r.tp, r.fp, r.fn, r.tn, r.excluded, r.precision, r.recall, r.f1], [1, 1, 1, 1, 2, .5, .5, .5]);
});
test("reference import rejects other models and invalid labels; CSV neutralizes formulas", () => {
  const pack = { schema: "hsimg-validation-reference", version: VALIDATION_VERSION, fingerprint: "test", labels: { x: "anomaly" } };
  assert.deepEqual(importReference(JSON.stringify(pack), "test", new Set(["x"])), { x: "anomaly" });
  assert.throws(() => importReference(JSON.stringify(pack), "other", new Set(["x"])));
  assert.throws(() => importReference(JSON.stringify({ ...pack, labels: { x: true } }), "test", new Set(["x"])));
  assert.match(csvRows([["=SUM(1,2)", 'a"b']]), /"'=SUM\(1,2\)","a""b"/);
});

test("semantic exclusions never infer intended inaccessibility from a missing door alone", () => {
  const spaces = [space("shaft"), space("works"), space("office"), space("lift")];
  spaces[0].metadata.long_name = "Patinillo";
  spaces[1].metadata.long_name = "Obra";
  spaces[2].metadata.long_name = "Office";
  spaces[3].metadata.long_name = "Elevator shaft";
  const data = dataset(spaces.map((s) => node(s.id, { nodeType: "space" })), [], spaces);
  const cases = validateGraph(data).cases.filter((c) => c.rule === "space_connection");
  assert.deepEqual(cases.map((c) => c.status), ["excluded", "excluded", "fail", "fail"]);
  assert.equal(validateGraph(data, "general", { shaft: "include" }).cases.find((c) => c.entityId === "shaft").status, "fail");
  assert.equal(spaceScope({ ...space("x"), name: "Obra 103" }).excluded, true);
  assert.equal(spaceScope({ ...space("x"), name: "Obra laboratory" }).excluded, false);
  assert.throws(() => readScopeOverrides({ absent: "exclude" }, new Set(["shaft"])));
});

test("excluded spaces cannot act as route shortcuts or satisfy an elevator floor exit", () => {
  const shaft = { ...space("shaft"), metadata: { long_name: "Patinillo" } };
  const data = dataset([node("d", { nodeType: "door" }), node("shaft", { nodeType: "space" }), node("room", { nodeType: "space" })], [edge("d", "shaft"), edge("shaft", "room")], [shaft, space("room")], [door("d")]);
  const result = validateGraph(data);
  assert.deepEqual([result.entrances[0].reachable, result.entrances[0].unreachable, result.entrances[0].excluded], [0, 1, 1]);
  assert.equal(validateGraph(data, "general", { shaft: "include" }).entrances[0].reachable, 2);
  data.nodes.push(node("stop", { parentNodeId: "lift", nodeRole: "elevator_stop" }));
  data.edges = [edge("stop", "shaft")];
  data.verticalFeatures = [{ id: "lift", verticalId: "lift", name: "Lift", verticalType: "elevator", storeyIds: ["L0"], metadata: {} }];
  assert.equal(validateGraph(data).cases.find((c) => c.rule === "elevator_floor").status, "fail");
});

test("out-of-scope cases never improve metrics; references require matching scope", () => {
  const counts = metrics([{ id: "x", status: "excluded" }, { id: "y", status: "pass" }], { x: "normal", y: "normal" });
  assert.deepEqual([counts.tn, counts.excluded, counts.evaluated], [1, 1, 1]);
  const pack = JSON.stringify({ schema: "hsimg-validation-reference", version: VALIDATION_VERSION, fingerprint: "test", scopeOverrides: { x: "include" }, labels: { x: "normal" } });
  assert.throws(() => importReference(pack, "test", new Set(["x"])), /different validation scope/);
  assert.deepEqual(importReference(pack, "test", new Set(["x"]), { x: "include" }), { x: "normal" });
});

test("validation map shows normal and omitted doors and independent vertical layers", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const source = await readFile(new URL("../app/components/ValidationMap2D.tsx", import.meta.url), "utf8");
  let js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const id of ["react", "react/jsx-runtime"]) js = js.replaceAll(`from "${id}"`, `from "${import.meta.resolve(id)}"`);
  js = js.replaceAll('from "../lib/validation"', `from "${new URL("../app/lib/validation.ts", import.meta.url).href}"`);
  const { ValidationMap2D } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  const vertical = (id, kind) => ({ id, verticalId: id, name: id, verticalType: kind, storeyIds: ["L0"], paths: [[[0, 0, 0], [1, 1, 3]]], rings: [], metadata: {} });
  const data = dataset([node("d", { nodeType: "door" }), node("s", { nodeType: "space" })], [edge("d", "s")], [space("s")], [door("d", true, ["s"]), door("omitted")], [vertical("stairs", "stair"), vertical("lift", "elevator")]);
  const cases = validateGraph(data).cases;
  const render = (layers) => renderToStaticMarkup(createElement(ValidationMap2D, { dataset: data, storeyId: "L0", cases, inspectionCases: cases, selected: null, layers, onLayersChange() {}, onSelect() {} }));
  const all = render({ graph: false, doors: true, stairs: true, elevators: true });
  assert.equal((all.match(/data-layer="door"/g) ?? []).length, 2);
  assert.match(all, /data-entity-id="d" data-status="pass"/);
  assert.match(all, /data-layer="stair"/);
  assert.match(all, /data-layer="elevator"/);
  const stairsOnly = render({ graph: false, doors: false, stairs: true, elevators: false });
  assert.match(stairsOnly, /data-layer="stair"/);
  assert.doesNotMatch(stairsOnly, /data-layer="door"|data-layer="elevator"/);
  const elevatorOnly = render({ graph: true, doors: false, stairs: false, elevators: true });
  assert.match(elevatorOnly, /data-layer="elevator"/);
  assert.doesNotMatch(elevatorOnly, /data-layer="stair"|data-layer="door"/);
});

test("bundled IFC v13: complete inventories, known stair failures, and reachability", async (t) => {
  const source = async (path) => readFile(new URL(path, import.meta.url), "utf8");
  const moduleUrl = (text) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString("base64")}`;
  const types = moduleUrl(await source("../app/lib/types.ts"));
  const { readGeoPackage } = await import(moduleUrl((await source("../app/lib/graph-loader.ts")).replaceAll('from "./types";', `from "${types}";`)));
  const bytes = await readFile(new URL("../public/EPM_IFC_v13_HSIMG_v14.gpkg", import.meta.url));
  const hash = createHash("sha256").update(bytes).digest("hex");
  const SQL = await initSqlJs({ wasmBinary: await readFile(new URL("../public/sql-wasm.wasm", import.meta.url)) });
  const db = new SQL.Database(bytes);
  const data = readGeoPackage(db, "IFC-v13", hash);
  db.close();
  assert.equal(new Set(data.spaces.map((s) => s.spaceNodeId)).size, 1517);
  assert.equal(data.validation.doors.length, 1401);
  assert.equal(data.verticalFeatures.length, 80);
  assert.equal(data.verticalFeatures.filter((v) => v.verticalType === "stair").length, 55);
  assert.equal(data.verticalFeatures.filter((v) => v.verticalType === "elevator").length, 13);
  const result = validateGraph(data);
  const rules = ["space_connection", "door_connection", "stair_floor", "elevator_floor", "vertical_continuity", "edge_integrity", "duplicate_connection", "internal_dead_end"];
  const counts = Object.fromEntries(rules.map((rule) => [rule, result.cases.filter((c) => c.rule === rule && c.status === "fail").length]));
  t.diagnostic(JSON.stringify({ failures: counts, entrances: result.entrances.length, reach: result.entrances.map((e) => [e.door.id, e.reachable, e.unreachable, e.unknown]) }));
  assert.equal(counts.stair_floor, 3);
  assert.equal(counts.space_connection, 167);
  assert.equal([...result.scopes.values()].filter((s) => s.excluded).length, 166);
  assert.equal([...result.scopes.values()].filter((s) => s.excluded && s.category === "Service shaft").length, 96);
  assert.equal([...result.scopes.values()].filter((s) => s.excluded && s.category === "Construction zone").length, 70);
  assert.ok(result.entrances.every((e) => e.excluded === 166 && e.reachable + e.unreachable + e.unknown === 1351));
  assert.equal(counts.vertical_continuity, 0);
  assert.equal(counts.edge_integrity, 0);
  assert.equal(counts.duplicate_connection, 0);
  assert.ok(result.entrances.length >= 23);
  assert.ok(result.entrances.every((e) => e.cases.length === 1517));
  assert.equal(new Set([...result.cases, ...result.entrances.flatMap((e) => e.cases)].map((c) => c.id)).size, result.cases.length + result.entrances.length * 1517);
});

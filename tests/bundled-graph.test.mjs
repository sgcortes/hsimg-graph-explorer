import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import initSqlJs from "sql.js";

test("bundled IFC v13 graph is complete, traceable and internally consistent", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/graph-manifest.json", import.meta.url), "utf8"));
  const data = await readFile(new URL(`../public/${manifest.geopackage}`, import.meta.url));
  assert.equal(createHash("sha256").update(data).digest("hex"), manifest.geopackage_sha256);
  const SQL = await initSqlJs({ wasmBinary: await readFile(new URL("../public/sql-wasm.wasm", import.meta.url)) });
  const db = new SQL.Database(data);
  const scalar = (sql) => db.exec(sql)[0].values[0][0];
  try {
    assert.equal(scalar("PRAGMA integrity_check"), "ok");
    assert.equal(scalar("SELECT COUNT(*) FROM graph_nodes"), manifest.nodes);
    assert.equal(scalar("SELECT COUNT(*) FROM graph_edges"), manifest.directed_edges);
    assert.equal(scalar("SELECT COUNT(*) FROM spaces"), 1517);
    assert.equal(scalar("SELECT COUNT(*) FROM doors"), 1401);
    assert.equal(scalar("SELECT source_ifc_sha256 FROM model_metadata"), manifest.source_ifc_sha256);
    assert.equal(scalar("SELECT COUNT(*) FROM graph_edges e LEFT JOIN graph_nodes s ON e.source_id=s.node_id LEFT JOIN graph_nodes t ON e.target_id=t.node_id WHERE s.node_id IS NULL OR t.node_id IS NULL"), 0);
    const cleanup = JSON.parse(scalar("SELECT data_json FROM horizontal_cleanup_v14 WHERE record_type='summary'"));
    assert.equal(cleanup.status, "passed");
    assert.ok(cleanup.checked_finite_terminal_routes > 0);
    assert.ok(cleanup.maximum_cost_change < 1e-7);
  } finally {
    db.close();
  }
});

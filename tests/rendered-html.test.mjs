import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the complete HSIMG Graph Explorer", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>HSIMG Graph Explorer<\/title>/i);
  assert.match(html, /src="university-oviedo\.png"/);
  assert.match(html, /id="tab-validation" role="tab" aria-selected="false" aria-controls="panel-validation"/);
  assert.match(html, /id="panel-explorer" role="tabpanel"/);
  assert.match(html, />3D graph</);
  assert.match(html, />2D floor plan</);
  assert.match(html, />Node inspector</);
  assert.match(html, />Metadata</);
  assert.match(html, />Vertical connection</);
  assert.match(html, />Vehicle-only ramp</);
  assert.match(html, /aria-label="Resize the left and right panel columns"/);
  assert.match(html, /aria-label="Resize the upper and lower panel rows"/);
  assert.match(html, /mailto:sgcortes@uniovi\.es/);
  assert.doesNotMatch(html, /codex-preview|Building your site/);
});

test("keeps the light layout and renders V5 vertical features", async () => {
  const [css, workbench, graph3d, loader, floorPlan, graphView] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/GraphWorkbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/Graph3D.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/graph-loader.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/FloorPlan2D.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/graph-view.ts", import.meta.url), "utf8"),
  ]);

  assert.match(css, /--background:\s*#ffffff/);
  assert.match(css, /\.dashboard-grid[\s\S]*grid-template-columns:/);
  assert.match(css, /\.view-legend[\s\S]*grid-template-columns:\s*max-content/);
  assert.match(css, /\.column-resizer/);
  assert.match(css, /\.row-resizer/);
  assert.match(workbench, /useState\(42\)/);
  assert.match(workbench, /useState\(63\)/);
  assert.match(workbench, /setLeftColumnWidth/);
  assert.match(workbench, /setTopRowHeight/);
  assert.match(workbench, /university-oviedo\.png/);
  assert.match(graph3d, /function isVerticalConnection/);
  assert.match(graph3d, /verticalEdgeLinesExpanded/);
  assert.match(graph3d, /color: vertical \? "#d62828"/);
  assert.match(graph3d, /depthTest: !vertical/);
  assert.match(loader, /vertical_footprints/);
  assert.match(loader, /verticalFeatures/);
  assert.match(floorPlan, /feature\.routeType === "vehicle_only"/);
  assert.match(floorPlan, /floorVerticalFeatures/);
  assert.match(graphView, /isOrphanDoorNode/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkKit } from "./kit.ts";
import { nonOwnerView, previewReport, readReport } from "./report.ts";
import { DOMAIN } from "./domain.ts";

test("non-owner view: a preview example shows its spec and start values, never the owner's moves or settled result", () => {
  const checked = checkKit({ controls: [{ id: "size", type: "slider", label: "Size", meaning: "font size of the text in px", min: 8, max: 20, initial: 12 }], view: { type: "preview", html: '<p style="font-size:{{size}}px">x</p>' }, outputs: [{ id: "result", label: "Result", template: "{{size}}px" }] } as never);
  assert.equal(checked.ok, true);
  const kit = (checked as unknown as { kit: never }).kit;
  const p = {
    domain: { id: "probe", question: "Probe", product: "", metrics: [], features: [], vendors: [] },
    createdAt: "2026-11-14T00:00:00Z", sources: {}, decision: null, events: [],
    exploration: null,
    kit: { kit, rev: "r", brandData: null, brandError: null, preview: { status: "ok", error: null, at: null }, settled: { values: { size: 18 }, outputs: { result: "18px" }, at: "2026-11-14T01:00:00Z" }, exploration: { controls: { size: { start: 12, final: 19, min: 12, max: 19, tried: [] } }, updatedAt: "2026-11-14T01:01:00Z" } },
  } as never;
  const own = JSON.stringify(previewReport(p, "u"));
  assert.match(own, /18px/); // the owner's agent gets the settled result
  const other = JSON.stringify(previewReport(nonOwnerView(p), "u"));
  for (const leak of ["18px", "19px", '"now":19', '"now":18', "Carry it out", "tried"]) assert.ok(!other.includes(leak), leak);
  assert.match(other, /12px/); // the outputs at the start values
  // A preview error saved from the owner's browser can name their values: a non-owner learns only that there is one.
  const failed = { ...(p as { kit: object }), kit: { ...(p as { kit: object }).kit, preview: { status: "failed", error: "Uncaught Error: Cannot render size 19", at: null } } } as never;
  const view = JSON.stringify(previewReport(nonOwnerView(failed), "u"));
  assert.ok(!view.includes("Cannot render size 19"));
  assert.match(view, /"status":"failed"/);
});

test("non-owner view: a price example keeps its saved decision and events, not the owner's exploration", () => {
  const p = { domain: DOMAIN, createdAt: "", sources: {}, decision: { usage: { mau: 50000 }, required: [], chosen: "clerk", tolerance: 25, savedAt: "2026-11-14T00:00:00Z" }, events: [], exploration: { metrics: { mau: { start: 20000, min: 900, max: 910000, final: 777777 } }, features: {}, selected: null, updatedAt: "" } } as never;
  const other = JSON.stringify(readReport(nonOwnerView(p), "u", null));
  assert.ok(!other.includes("777777") && !other.includes("910000"), "exploration leaked");
  assert.match(other, /50000|50,000/); // the saved decision stays
});

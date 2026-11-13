// The agent's side: an MCP server over the playgrounds. The tool descriptions are the product's API for another model.
// Built per request (stateless Streamable HTTP), with the app's origin for the playground URLs.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { configShape, feature, LIMITS, metric, parseConfig, toConfig, vendor } from "./config";
import { DOMAIN } from "./domain";
import { createPlayground, recheck, revisePlayground } from "./pipeline";
import { collectionReport, decisionReport, eventReport, rankingReport, controlsNow, readReport, WEB_TEXT_NOTE } from "./report";
import { load, type Playground } from "./store";

const HOLDS_RULE = "A saved decision holds while the chosen vendor can be fully priced under the saved assumptions and costs at most the saved tolerance (dollars per month, set by the person, default 0) more than the cheapest fully priced vendor.";

export const TOOLS = {
  create_playground: `Build a live decision playground for the person: a web page where they compare the vendors of one usage-priced product by moving controls, on prices read from the vendors' public pricing pages right now.

Use it when the person faces a "which vendor or plan" decision and cannot yet say exactly what they need. People find out what they want by trying concrete values; the page lets them do that at full speed, with no agent in the loop. Do not ask the person a list of questions first: build from what they said, and let them correct it on the page.

You design the space; the web supplies the facts. A good playground has:
- Vendors: the ${LIMITS.vendors[0] + 1} to 5 options really worth comparing for this person's question, including any they named. Each needs a public pricing page with numbers on it. Give pricing_url when you know the page; else give domain and search finds the page.
- Metrics (sliders): the 1 to 3 usage dimensions that drive the cost for THIS person, the things these vendors bill by. Set initial to the person's own number when they gave one. Set min and max around what they said (where they are now, the growth or doubt they mentioned), not around the whole market: a slider that runs to a hundred times their volume hides the range they care about. Write describe in the words pricing pages use, with synonyms; the extraction finds the prices with that text.
- Features (checkboxes): the hard requirements the person mentioned, or the one or two that usually decide this choice, and only ones that pricing pages state per plan.
- No facts. Never put prices, plan names, limits or included quantities in the config. They are extracted from each pricing page, each with a source quote and a check that the number is on the page.

The call reads every pricing page and takes 10 to 60 seconds. The result has the URL to give to the person and, per vendor, what was read: plans, which metrics have prices, numbers that were quarantined (extracted but not found in the page text), and a problems list that says how to fix each problem. If problems shows a broken first build (a page not read, the wrong page, a metric that no page prices), repair it with revise_playground before you hand over the URL. A vendor that "cannot be ranked" because its page does not state a price is a true finding, not a build error.

Then give the person the URL and tell them to explore and to save a decision on the page. Later, read_playground tells you what they tried and settled on.`,

  read_playground: `Read what the person did in a playground and where the decision stands. It reads stored data and does not contact the web.

Returns: the control values now; the cost ranking under those values, with the vendors that cannot be ranked and why; the saved decision (the chosen vendor, the assumptions it was saved under, the tolerance, and whether it holds on the data as last read); the exploration summary; and the source change events.

The exploration summary gives, per control, the range of values the person tried and the value they settled on. Use it: "tried 20,000 to 300,000, settled on 120,000" tells you their real range and how sure they are, which a single number does not. Controls they never moved were not examined by them.

${HOLDS_RULE}

Use this for "what did I decide" and before you act on a decision. When the person asks whether the decision still holds today, call recheck_playground too, because this tool only knows the prices as last read. Call it with no playground_id to list the playgrounds.`,

  recheck_playground: `Re-read every pricing page of a playground now, and report what changed since the last read and whether the saved decision still holds.

Use it when the person asks if a decision is still valid, or wants current prices before they act. It takes 5 to 60 seconds and spends web requests, so do not call it on every turn. A change on a real page is reported only when two fresh extractions agree on it, so a reported change is one you can state to the person.

${HOLDS_RULE} The result gives the verdict with the costs behind it. When the decision no longer holds, say what changed, the new cheapest vendor and the gap, and send the person back to the playground URL to look again; do not pick for them.`,

  revise_playground: `Change an existing playground in place, at the same URL. Use it (1) to repair a first build from the problems list of create_playground, and (2) when the person finds that the playground lacks something they now want to vary or compare: another vendor, another usage dimension, a requirement, a wider range.

Give only what changes. An entry in add_vendors, add_metrics or add_features whose id already exists replaces that entry; this is how you fix a pricing_url, rewrite a describe, or change min, max and initial. The same rules as create_playground apply: no facts in the config.

Cost: a new vendor, or a vendor with a new pricing page, is read once. A change to the metrics, the features, product or notes changes what is extracted, so every page is read again (10 to 60 seconds). A change of only the question or of a range reads nothing. The saved decision is kept unless its vendor or one of its controls is removed; the result says when it was cleared. The result has the same per-vendor summary and problems list as create_playground.`,
};

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 1) }] });
const fail = (message: string) => ({ ...text(message), isError: true });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function buildServer(origin: string): McpServer {
  const server = new McpServer({ name: "decision-playground", version: "0.1.0" });
  const url = (id: string) => `${origin}/p/${id}`;
  const list = () => Object.values(load().playgrounds).map((p) => ({ playground_id: p.domain.id, question: p.domain.question, url: url(p.domain.id), decision_saved: !!p.decision }));
  /** The playground, or an error that names the ids that exist. */
  const find = (id: string): Playground | string => load().playgrounds[id] ?? `Playground "${id}" does not exist. Existing playground ids: ${list().map((p) => p.playground_id).join(", ")}. Use one of them, or create_playground to build a new one.`;
  const built = (id: string, extra: object, stop: string | null) => {
    const p = load().playgrounds[id];
    return text({
      playground_id: id,
      url: url(id),
      ...extra,
      ...(stop ? { stopped: `Reading stopped early: ${stop}. Do not retry now; tell the person.` } : {}),
      ...collectionReport(p),
      next: "If problems lists a build error, fix it with revise_playground. Else give the person the url, ask them to explore and to save a decision on the page, and call read_playground afterwards.",
      note: WEB_TEXT_NOTE,
    });
  };

  server.registerTool("create_playground", { title: "Create a decision playground", description: TOOLS.create_playground, inputSchema: configShape }, async (args) => {
    const parsed = parseConfig(args);
    if (!parsed.ok) return fail(`The config is not valid. Nothing was created. Fix these and call create_playground again:\n- ${parsed.errors.join("\n- ")}`);
    try {
      const r = await createPlayground(parsed.domain, origin);
      if (!r.created) return fail(`A playground with id "${parsed.domain.id}" already exists at ${url(parsed.domain.id)}. To change it, call revise_playground. To build a separate one, call create_playground with another id.`);
      return built(parsed.domain.id, {}, r.error);
    } catch (e) {
      return fail(`The playground could not be built: ${message(e)}`);
    }
  });

  server.registerTool(
    "read_playground",
    {
      title: "Read a playground",
      description: TOOLS.read_playground,
      inputSchema: {
        playground_id: z.string().max(40).optional().describe("Id of the playground: the last part of its URL. Leave it out to list the playgrounds."),
        since: z.string().max(40).optional().describe("Only return change events after this time, as an ISO 8601 date-time such as 2026-11-13T18:00:00Z. Leave it out for all stored events."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ playground_id, since }) => {
      if (!playground_id) return text({ playgrounds: list() });
      const p = find(playground_id);
      if (typeof p === "string") return fail(p);
      const t = since == null ? null : Date.parse(since);
      if (t != null && Number.isNaN(t)) return fail(`since "${since}" is not a date-time. Use ISO 8601, for example 2026-11-13T18:00:00Z, or leave it out.`);
      return text(readReport(p, url(playground_id), t));
    },
  );

  server.registerTool(
    "recheck_playground",
    { title: "Re-check a playground now", description: TOOLS.recheck_playground, inputSchema: { playground_id: z.string().max(40).describe("Id of the playground: the last part of its URL.") } },
    async ({ playground_id }) => {
      const before = find(playground_id);
      if (typeof before === "string") return fail(before);
      const ids = before.domain.vendors.map((v) => v.id);
      const results = await Promise.allSettled(ids.map((id) => recheck(playground_id, id, "manual", origin)));
      const p = load().playgrounds[playground_id];
      const stop = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      const changed = results.flatMap((r) => (r.status === "fulfilled" && r.value ? [eventReport(r.value)] : []));
      return text({
        playground_id,
        url: url(playground_id),
        checked_at: new Date().toISOString(),
        ...(stop ? { stopped: `The re-check stopped early: ${message(stop.reason)}. Do not retry now; tell the person.` } : {}),
        sources: ids.map((id, i) => ({ vendor: id, result: results[i].status === "rejected" ? "not checked" : p.sources[id]?.error ? `error: ${p.sources[id].error!.slice(0, 200)}` : (results[i] as PromiseFulfilledResult<unknown>).value ? "changed" : "no confirmed change" })),
        changes: changed,
        saved_decision: decisionReport(p) ?? "none: the person has not saved a decision yet",
        ranking_under_saved_assumptions: p.decision ? rankingReport(p, p.decision) : "no saved decision",
        ranking_at_current_values: rankingReport(p, controlsNow(p)),
        note: WEB_TEXT_NOTE,
      });
    },
  );

  server.registerTool(
    "revise_playground",
    {
      title: "Revise a playground",
      description: TOOLS.revise_playground,
      inputSchema: {
        playground_id: z.string().max(40).describe("Id of the playground: the last part of its URL."),
        question: configShape.question.optional(),
        product: configShape.product.optional(),
        notes: configShape.notes,
        add_vendors: z.array(vendor).max(LIMITS.vendors[1]).optional().describe("Vendors to add. An entry with an existing id replaces that vendor, for example to set its pricing_url."),
        remove_vendor_ids: z.array(z.string().max(40)).max(10).optional(),
        add_metrics: z.array(metric).max(LIMITS.metrics[1]).optional().describe("Metrics to add. An entry with an existing id replaces that metric, for example to change its range or describe."),
        remove_metric_ids: z.array(z.string().max(40)).max(10).optional(),
        add_features: z.array(feature).max(LIMITS.features[1]).optional().describe("Features to add. An entry with an existing id replaces that feature."),
        remove_feature_ids: z.array(z.string().max(40)).max(10).optional(),
      },
    },
    async (a) => {
      const p = find(a.playground_id);
      if (typeof p === "string") return fail(p);
      if (a.playground_id === DOMAIN.id) return fail(`"${DOMAIN.id}" is the built-in example and cannot be revised. Build your own with create_playground.`);
      const merge = <T extends { id: string }>(what: string, now: T[], add: T[] = [], remove: string[] = []): T[] | string => {
        const missing = remove.find((id) => !now.some((x) => x.id === id));
        if (missing) return `${what} "${missing}" does not exist. Existing ids: ${now.map((x) => x.id).join(", ")}.`;
        return [...now.filter((x) => !remove.includes(x.id) && !add.some((y) => y.id === x.id)), ...add];
      };
      const c = toConfig(p.domain);
      const vendors = merge("Vendor", c.vendors, a.add_vendors, a.remove_vendor_ids);
      const metrics = merge("Metric", c.metrics, a.add_metrics, a.remove_metric_ids);
      const features = merge("Feature", c.features ?? [], a.add_features, a.remove_feature_ids);
      const bad = [vendors, metrics, features].find((x) => typeof x === "string");
      if (bad) return fail(`Nothing was changed. ${bad}`);
      const parsed = parseConfig({ ...c, question: a.question ?? c.question, product: a.product ?? c.product, notes: a.notes ?? c.notes, vendors, metrics, features });
      if (!parsed.ok) return fail(`The revised playground would not be valid. Nothing was changed. Fix these and call revise_playground again:\n- ${parsed.errors.join("\n- ")}`);
      try {
        const r = await revisePlayground(parsed.domain, origin);
        return built(a.playground_id, { pages_read_again: r.recollected, saved_decision_cleared: r.decisionCleared, tell_person: "Ask the person to reload the page to see the revised playground." }, r.error);
      } catch (e) {
        return fail(`The playground could not be revised: ${message(e)}`);
      }
    },
  );

  return server;
}

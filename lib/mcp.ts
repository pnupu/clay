// The agent's side: an MCP server over the playgrounds. The tool descriptions are the product's API for another model.
// Built per request (stateless Streamable HTTP), with the app's origin for the playground URLs.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LIMITS } from "./config";
import { DOMAIN } from "./domain";
import { initialValues, renderOutputs } from "./kit";
import { createPlayground, createPreview, recheck, revisePlayground, revisePreview } from "./pipeline";
import { KIT_REFERENCE } from "./reference";
import { BRAND_NOTE, collectionReport, controlsNow, dataReport, decisionReport, eventReport, previewReport, previewStatus, rankingReport, readReport, WEB_TEXT_NOTE } from "./report";
import { mergeSpec, parseSpec, specShape, toSpec, type Spec } from "./spec";
import { load, type Playground } from "./store";
import { canRead, canWrite, currentActor, playgroundCapMessage } from "./accounts";

const HOLDS_RULE = "A saved decision holds while the chosen vendor can be fully priced under the saved assumptions and costs at most the saved tolerance (dollars per month, set by the person, default 0) more than the cheapest fully priced vendor.";

/**
 * Server instructions. Many MCP clients load tool descriptions only on demand and show the agent just the tool names,
 * so this short text is what decides whether the agent thinks of the playground at all.
 */
export const INSTRUCTIONS = `Clay builds a playground: a web page on which a person finds out what they want by trying concrete things, alone and at full speed. You build it from prebuilt parts, the person explores it, the settled result comes back to you as a precise instruction, and you carry it out.

Build a playground instead of guessing or asking a list of questions when the person cannot yet say exactly what they want. Two kinds:

1. A preview playground, for anything the person must see or feel to judge: a component that "looks off", an animation that "feels dead" or "too slow", spacing, colour, timing. Do not guess new values and edit their code. Read their real file, call kit_reference once (format and two worked examples), then create_playground with view.type "preview": their real code in the preview, a few controls from the kit, and outputs that render the final code. When they name a brand or a site, add data.brand: Clay reads the brand's colours live.

2. A price playground, for "which service, vendor or plan" of a usage-priced product (an API, a SaaS product, a cloud service). Call create_playground with view.type "price_ranking" before you answer from memory or search the web: prices from memory are out of date, and Clay reads the current pricing pages with a source quote for every number.

Give the person the URL. When they come back ("done", "I settled it", "what did I decide", "does it still hold"), call read_playground and carry out the settled result: write the outputs into their code, or report the decision. recheck_playground re-reads prices today. revise_playground repairs a playground or adds what the person now wants to try.`;

export const TOOLS = {
  create_playground: `Build a playground for the person: a web page where they explore one question by moving controls, at full speed, with no agent in the loop. You give them the URL; read_playground later returns what they settled on, and you carry it out.

Use it when the person cannot yet say exactly what they want. People find out by trying concrete values. Do not ask a list of questions first, and do not guess and edit: build from what they said and from their real files, and let them settle it by hand.

One spec describes the playground. Choose the view:

view.type "preview": the person must see or feel the real thing (a component's look, colours, spacing, an animation's spring or timing). Call kit_reference before your first one. The rules:
- Real code. Copy the person's actual markup, classes or motion code from their file into view.html, view.css and view.js, so that every control maps to a line in their file. A sketch of the thing is not the thing.
- Controls come only from the kit: slider, toggle, select, color. Choose the 3 to 6 dimensions behind THIS person's complaint. initial is the value in their code now, so the page opens on what they have. Ranges sit around that value. Each control has one meaning.
- Bind controls with {{control_id}} in view.html and view.css (updated in place on every move), or read clay.values.<id> in view.js.
- Brand: when the person names a brand or a site, add data.brand {"domain"}. Clay reads its colours live; a color control with palette "brand" offers them. Never write brand colours from memory.
- Outputs are templates of the final code: the class string, the config object. At hand-back you paste them.
- The spec is validated before anything is built; each error says how to fix it. The preview code runs only in a browser, so the result says "unverified" until the person opens the page. read_playground then reports that it ran, or the error to repair.

view.type "price_ranking": a "which vendor or plan" decision for a usage-priced product. You design the space in data.price_pages; the web supplies the facts:
- Vendors: the ${LIMITS.vendors[0] + 1} to 5 options really worth comparing, including any the person named. Each needs a public pricing page with numbers on it. Give pricing_url when you know the page; else give domain and search finds it.
- Metrics (sliders): the 1 to 3 usage dimensions that drive the cost for THIS person. initial is their own number when they gave one; min and max sit around what they said, not around the whole market. Write describe in the words pricing pages use, with synonyms; the extraction finds the prices with that text.
- Features (checkboxes): the hard requirements the person mentioned, and only ones that pricing pages state per plan.
- No facts. Never put prices, plan names or limits in the spec. They are read from each pricing page, each with a source quote and a check that the number is on the page.
The call reads every pricing page: 10 to 60 seconds, up to 2 minutes when requests wait for the rate limit. The result lists per vendor what was read and a problems list that says how to fix each problem. Repair a broken first build with revise_playground before you hand over the URL: for a page that was not read, try once with the exact pricing_url (or only the domain); if the vendor still cannot be priced, remove it and tell the person. A vendor that "cannot be ranked" only at some values is a true finding and stays.

Then give the person the URL: for a preview, "move the controls until it is right, then press Settle"; for prices, "explore, select a vendor and save the decision". When they say they are done, call read_playground.`,

  read_playground: `Read what the person did in a playground. It reads stored data and does not contact the web. Call it when the person says they are done, and before you act on a result. With no playground_id it lists the playgrounds.

Preview playground: returns settled (the values, and the outputs as code-ready text), the exploration summary, and the preview status. When settled is present, carry it out: write settled.outputs into the person's file exactly as given, then say what you changed. When it is "none", the person has not pressed Settle: ask them to, and do not treat the current values as a decision. When preview.status is "failed", the error text is the browser's: repair the code with revise_playground and ask the person to reload.

Price playground: returns the control values now, the cost ranking, the saved decision (vendor, assumptions, tolerance, whether it holds on the data as last read), the exploration summary and the source change events. ${HOLDS_RULE} For "does it still hold today", call recheck_playground too.

The exploration summary gives, per control, the range the person tried and the value they settled on. Use it: "tried 4 to 16, settled on 10" tells you their real range and how sure they are. A control they never moved was not examined by them: leave its value in their code as it is.`,

  recheck_playground: `Re-read every pricing page of a price playground now, and report what changed since the last read and whether the saved decision still holds. A preview playground has nothing to re-check.

Use it when the person asks if a decision is still valid, or wants current prices before they act. It takes 5 to 60 seconds and spends web requests, so do not call it on every turn. A change on a real page is reported only when two fresh extractions agree on it, so a reported change is one you can state to the person.

${HOLDS_RULE} The result gives the verdict with the costs behind it. When the decision no longer holds, say what changed, the new cheapest vendor and the gap, and send the person back to the playground URL to look again; do not pick for them.`,

  revise_playground: `Change an existing playground in place, at the same URL. Use it (1) to repair a first build: a problem from the create result, or a preview error from read_playground; and (2) when the person wants to try something the playground lacks: another control, a wider range, another vendor.

Give playground_id and only the parts that change. Each part you give replaces that whole part: title, notes, controls (the full list), view (the full view), outputs (the full list), and inside data each source (data.price_pages whole, data.brand, data.inline). Parts you leave out stay. The result is validated like a new spec. When you no longer have the spec, read_playground with include_spec returns it.

Preview playground: the settled result is cleared and the preview is unverified again; what the person tried is kept for the controls you did not change. Ask the person to reload the page.

Price playground: a new vendor, or a vendor with a new pricing page, is read once. A change to the metrics, features, product or notes changes what is extracted, so every page is read again (10 seconds to 2 minutes). A change of only the title or of a range reads nothing. The saved decision is kept unless its vendor or one of its controls is removed. After one failed repair of a vendor, remove it and tell the person; do not keep trying pages.`,

  kit_reference: `Return the reference for preview playgrounds: the four control types, how the preview binds to them ({{control_id}} in html and css, clay.values in JavaScript), what the sandbox allows, how outputs work, and two complete worked specs (a Tailwind button with brand colours; spring physics tuned by feel). Read-only, instant, no web request. Call it once before your first create_playground with view.type "preview".`,
};

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 1) }] });
const fail = (message: string) => ({ ...text(message), isError: true });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function buildServer(origin: string): McpServer {
  const server = new McpServer({ name: "clay", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  const url = (id: string) => `${origin}/p/${id}`;
  // Ownership: the caller sees their own playgrounds (the admin sees all) and may read the examples (lib/accounts.ts).
  const list = async () => Object.values((await load()).playgrounds).filter((p) => canWrite(currentActor(), p)).map((p) => ({ playground_id: p.domain.id, title: p.domain.question, url: url(p.domain.id), ...(p.kit ? { kind: "preview", settled: !!p.kit.settled } : { kind: "price", decision_saved: !!p.decision }) }));
  /** The playground, or an error that names the ids that exist. */
  const find = async (id: string, write = false): Promise<Playground | string> => {
    const p = (await load()).playgrounds[id];
    if (p && (write ? canWrite : canRead)(currentActor(), p)) return p;
    if (p && canRead(currentActor(), p)) return `Playground "${id}" is an example and cannot be changed. Build your own with create_playground.`;
    return missing(id);
  };
  const missing = async (id: string) => {
    const ids = (await list()).map((p) => p.playground_id);
    return `Playground "${id}" does not exist. ${ids.length ? `Existing playground ids: ${ids.join(", ")}. Use one of them, or` : "You have no playgrounds yet. Use"} create_playground to build a new one.`;
  };
  /** `detail`: the vendors to describe in full. The others get one line, so a revise does not repeat what the agent already has. */
  const built = async (id: string, extra: object, stop: string | null, detail?: string[]) => {
    const report = collectionReport((await load()).playgrounds[id]);
    return text({
      playground_id: id,
      url: url(id),
      ...extra,
      ...(stop ? { stopped: `Reading stopped early: ${stop}. Do not retry now; tell the person.` } : {}),
      ...report,
      vendors: report.vendors.map((v) => (!detail || detail.includes(v.vendor) ? v : { vendor: v.vendor, pricing_page: v.pricing_page, plans_read: v.plans.length, unchanged: true })),
      kind: "price",
      next: "If problems lists a build error, fix it with revise_playground. Else give the person the url, ask them to explore and to save a decision on the page, and call read_playground afterwards.",
      note: WEB_TEXT_NOTE,
    });
  };

  /** The result of building or revising a preview playground. */
  const preview = async (id: string, extra: object, warnings: string[]) => {
    const k = (await load()).playgrounds[id].kit!;
    return text({
      playground_id: id,
      url: url(id),
      kind: "preview",
      ...extra,
      preview: previewStatus(k),
      outputs_at_initial_values: renderOutputs(k.kit, initialValues(k.kit.controls)),
      data: dataReport(k),
      problems: k.brandError ? [`data.brand: the brand of ${k.kit.brand?.domain} could not be read (${k.brandError.slice(0, 200)}). The playground works without it: a palette "brand" shows only the control's initial colour. Fix: revise_playground with data.brand giving the brand's own site domain, or give the colours as a palette list and tell the person they are not checked.`] : [],
      warnings,
      next: "Give the person the url and say: move the controls until it is right, then press Settle. When they say they are done, or that the preview is broken, call read_playground: it returns the settled outputs to write into their code, or the preview error to repair with revise_playground.",
      ...(k.kit.brand ? { note: BRAND_NOTE } : {}),
    });
  };

  server.registerTool("create_playground", { title: "Create a playground", description: TOOLS.create_playground, inputSchema: specShape }, async (args) => {
    const parsed = parseSpec(args);
    if (!parsed.ok) return fail(`The spec is not valid. Nothing was created. Fix these and call create_playground again:\n- ${parsed.errors.join("\n- ")}`);
    const id = parsed.domain.id;
    const exists = `A playground with id "${id}" already exists at ${url(id)}. To change it, call revise_playground. To build a separate one, call create_playground with another id.`;
    const capped = playgroundCapMessage((await load()).playgrounds);
    if (capped) return fail(capped);
    const taken = async () => !canWrite(currentActor(), (await load()).playgrounds[id] ?? {});
    const takenMessage = `The id "${id}" is taken. Call create_playground again with another id.`;
    try {
      if (parsed.kind === "preview") return (await createPreview(parsed.domain, parsed.kit)).created ? preview(id, {}, parsed.warnings) : fail((await taken()) ? takenMessage : exists);
      const r = await createPlayground(parsed.domain, origin);
      return r.created ? built(id, {}, r.error) : fail((await taken()) ? takenMessage : exists);
    } catch (e) {
      return fail(`The playground could not be built: ${message(e)}`);
    }
  });

  server.registerTool("kit_reference", { title: "Kit reference for preview playgrounds", description: TOOLS.kit_reference, inputSchema: {}, annotations: { readOnlyHint: true } }, async () => text(KIT_REFERENCE));

  server.registerTool(
    "read_playground",
    {
      title: "Read a playground",
      description: TOOLS.read_playground,
      inputSchema: {
        playground_id: z.string().max(40).optional().describe("Id of the playground: the last part of its URL. Leave it out to list the playgrounds."),
        since: z.string().max(40).optional().describe("Price playground: only return change events after this time, as an ISO 8601 date-time such as 2026-11-13T18:00:00Z. Leave it out for all stored events."),
        include_spec: z.boolean().optional().describe("true adds the playground's current spec, for a revise_playground when you no longer have it."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ playground_id, since, include_spec }) => {
      if (!playground_id) return text({ playgrounds: await list() });
      const p = await find(playground_id);
      if (typeof p === "string") return fail(p);
      const t = since == null ? null : Date.parse(since);
      if (t != null && Number.isNaN(t)) return fail(`since "${since}" is not a date-time. Use ISO 8601, for example 2026-11-13T18:00:00Z, or leave it out.`);
      return text({ ...(p.kit ? previewReport(p, url(playground_id)) : readReport(p, url(playground_id), t)), ...(include_spec ? { spec: toSpec(p) } : {}) });
    },
  );

  server.registerTool(
    "recheck_playground",
    { title: "Re-check a playground now", description: TOOLS.recheck_playground, inputSchema: { playground_id: z.string().max(40).describe("Id of the playground: the last part of its URL.") } },
    async ({ playground_id }) => {
      const before = await find(playground_id, true);
      if (typeof before === "string") return fail(before);
      if (before.kit) return fail(`"${playground_id}" is a preview playground: it has no pricing pages to re-check. Call read_playground for its settled result.`);
      const ids = before.domain.vendors.map((v) => v.id);
      const results = await Promise.allSettled(ids.map((id) => recheck(playground_id, id, "manual", origin)));
      const p = (await load()).playgrounds[playground_id];
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
        ...(p.decision ? { ranking_under_saved_assumptions: rankingReport(p, p.decision) } : {}),
        // The controls may have moved since the decision was saved. When they have not, one ranking says it all.
        ...(p.decision && JSON.stringify(controlsNow(p)) === JSON.stringify({ usage: p.decision.usage, required: p.decision.required }) ? {} : { ranking_at_current_values: rankingReport(p, controlsNow(p)) }),
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
        title: specShape.title.optional(),
        notes: specShape.notes,
        data: specShape.data,
        controls: specShape.controls.describe("The full new list of controls of a preview playground. It replaces the current list."),
        view: specShape.view.optional().describe("The full new view. It replaces the current view; the view type cannot change."),
        outputs: specShape.outputs.describe("The full new list of outputs of a preview playground. It replaces the current list."),
      },
    },
    async ({ playground_id, ...change }) => {
      const p = await find(playground_id, true);
      if (typeof p === "string") return fail(p);
      if (playground_id === DOMAIN.id) return fail(`"${DOMAIN.id}" is the built-in example and cannot be revised. Build your own with create_playground.`);
      const was = toSpec(p);
      if (change.view && change.view.type !== was.view.type) return fail(`Nothing was changed. "${playground_id}" has view.type "${was.view.type}", and the view type of a playground cannot change. Build a separate playground with create_playground.`);
      const parsed = parseSpec(mergeSpec(was, change as Partial<Spec>));
      if (!parsed.ok) return fail(`The revised playground would not be valid. Nothing was changed. Fix these and call revise_playground again:\n- ${parsed.errors.join("\n- ")}`);
      const tell_person = "Ask the person to reload the page to see the revised playground.";
      try {
        if (parsed.kind === "preview") {
          const settled_result_cleared = !!p.kit?.settled;
          await revisePreview(parsed.domain, parsed.kit);
          return preview(playground_id, { settled_result_cleared, tell_person }, parsed.warnings);
        }
        const r = await revisePlayground(parsed.domain, origin);
        return built(playground_id, { pages_read_again: r.recollected, saved_decision_cleared: r.decisionCleared, tell_person }, r.error, r.recollected);
      } catch (e) {
        return fail(`The playground could not be revised: ${message(e)}`);
      }
    },
  );

  return server;
}

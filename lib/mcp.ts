// The agent's side: an MCP server over the playgrounds. The tool descriptions are the product's API for another model.
// Built per request (stateless Streamable HTTP), with the app's origin for the playground URLs.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { INSTRUCTIONS, TOOLS } from "./texts";
import { DOMAIN } from "./domain";
import { BRAND_PENDING, brandPending, initialValues, renderOutputs } from "./kit";
import { createPlayground, createPreview, recheckAll, recheckWeb, revisePlayground, revisePreview, settled } from "./pipeline";
import { KIT_REFERENCE } from "./reference";
import { NOT_YOURS, nonOwnerView, BRAND_NOTE, WEB_NOTE, webChanges, webProblems, webReading, buildReport, collectionReport, controlsNow, dataReport, decisionReport, eventReport, previewReport, previewStatus, rankingReport, readReport, WEB_TEXT_NOTE } from "./report";
import { MAX_SPEC_BYTES, mergeSpec, parseSpec, specShape, toSpec, type Spec } from "./spec";
import { load, update, type Playground } from "./store";
import type { LeftOut } from "./spec";
import { canRead, canWrite, currentActor } from "./accounts";

/**
 * How long a tool call waits for web reads before it answers. An agent's client cuts a tool call at about 60 seconds
 * (Claude Code and Codex both), and a cut call looks like a failure although the server finished. So every tool answers
 * well inside that, and says "running" when the reads go on.
 */
const WAIT_MS = Number(process.env.CLAY_TOOL_WAIT_MS ?? 20_000);


/** The largest request the MCP endpoint reads: one spec at its size limit plus the JSON-RPC envelope. */
export const MAX_MCP_BYTES = MAX_SPEC_BYTES + 20_000;
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 1) }] });
const fail = (message: string) => ({ ...text(message), isError: true });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * `background`: keeps the function instance alive for web reads that go on after the tool has answered (the route passes
 * Next.js after()). Without it the reads still run on a long-lived server such as `next dev`.
 */
export function buildServer(origin: string, background: (work: Promise<unknown>) => void = () => {}): McpServer {
  const server = new McpServer({ name: "clay", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  const url = (id: string) => `${origin}/p/${id}`;
  /** Store what the agent left out and why (when the call says so), and return the stored list for the result. */
  // One line per name is stored: the last reason given for it.
  const leftOut = async (id: string, given?: LeftOut[]) => {
    if (given) await update((s) => { const p = s.playgrounds[id]; if (p) p.leftOut = given.filter((x, i) => !given.slice(i + 1).some((y) => y.name.toLowerCase() === x.name.toLowerCase())).map((x) => ({ ...x, at: new Date().toISOString() })); });
    const stored = (await load()).playgrounds[id]?.leftOut ?? [];
    return stored.length ? { left_out: stored.map((x) => ({ name: x.name, reason: x.reason })) } : {};
  };
  /** Wait for web reads at most WAIT_MS. `done: false` means they go on in the background. */
  const within = async <T>(work: Promise<T> | null): Promise<{ done: true; value: T | null } | { done: false }> => {
    if (!work) return { done: true, value: null };
    background(work.catch(() => {}));
    return Promise.race([work.then((value) => ({ done: true as const, value })), new Promise<{ done: false }>((r) => setTimeout(() => r({ done: false }), WAIT_MS))]);
  };
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
    const p = (await load()).playgrounds[id];
    const report = collectionReport(p);
    const build = buildReport(p);
    return text({
      playground_id: id,
      url: url(id),
      build,
      ...extra,
      ...(stop ? { stopped: `Reading stopped early: ${stop}. Do not retry now; tell the person.` } : {}),
      ...report,
      vendors: report.vendors.map((v) => (!detail || detail.includes(v.vendor) ? v : { vendor: v.vendor, pricing_page: v.pricing_page, plans_read: v.plans.length, unchanged: true })),
      kind: "price",
      next:
        build.status === "running"
          ? "The pricing pages are still being read. 1. Tell the person now, in a sentence, that the comparison is being built from the live pricing pages, and give them the url: it works already and each vendor appears as its page is read. 2. Call read_playground: it waits up to 20 seconds. Repeat until build.status is \"done\". 3. Then fix what problems lists with revise_playground, and tell the person the page is ready and what you changed."
          : "If problems lists a build error or starts with BROKEN BUILD, fix it with revise_playground first. Else give the person the url, ask them to explore and to save a decision on the page, and call read_playground afterwards.",
      note: WEB_TEXT_NOTE,
    });
  };

  /** The result of building or revising a preview playground. */
  const preview = async (id: string, extra: object, warnings: string[]) => {
    const p = (await load()).playgrounds[id];
    const k = p.kit!;
    const reading = webReading(p);
    return text({
      playground_id: id,
      url: url(id),
      kind: "preview",
      ...(k.kit.web?.length ? { build: reading.length ? { status: "running", still_reading: reading } : { status: "done" } } : {}),
      ...extra,
      preview: previewStatus(k),
      outputs_at_initial_values: renderOutputs(k.kit, initialValues(k.kit.controls)),
      data: dataReport(k, reading),
      problems: [...webProblems(k, reading), ...(k.brandError && !brandPending(k) ? [`data.brand: the brand of ${k.kit.brand?.domain} could not be read (${k.brandError === BRAND_PENDING ? "the read was cut off before it ended" : k.brandError.slice(0, 200)}). The playground works without it: a palette "brand" shows only the control's initial colour. Fix: revise_playground with data.brand giving the brand's own site domain; or with data.brand null and the colours as a palette list, and tell the person they are not checked.`] : [])],
      warnings,
      next:
        reading.length
          ? "The web sources are still being read. 1. Tell the person now, in a sentence, that the page is being built from live web pages, and give them the url: it works already and the numbers fill in as each page is read. 2. Call read_playground: it waits up to 20 seconds. Repeat until build.status is \"done\". 3. Look at data: check that the rows and values are what your view.js expects (names it joins on, units), repair what problems lists with revise_playground, and tell the person the page is ready and which values are unknown."
          : k.kit.web?.length
            ? "Look at data now: check that the rows and values are what your view.js expects (the names it joins on, the units, the unknown values), and repair with revise_playground if they are not. Then give the person the url and say: move the controls until it is right, then press Settle. When they say they are done, call read_playground: it returns the settled outputs to write into their files."
            : brandPending(k)
          ? "The brand's colours are still being read (the web reader was busy), so the brand palette is still empty. Call read_playground now: it waits up to 20 seconds for the brand; repeat it until data shows the colours or a problem. Then give the person the url and say: move the controls until it is right, then press Settle. When they say they are done, call read_playground again for the settled outputs."
          : "Give the person the url and say: move the controls until it is right, then press Settle. When they say they are done, or that the preview is broken, call read_playground: it returns the settled outputs to write into their code, or the preview error to repair with revise_playground.",
      ...(k.kit.web?.length || k.kit.brand ? { note: [k.kit.web?.length ? WEB_NOTE : "", k.kit.brand ? BRAND_NOTE : ""].filter(Boolean).join(" ") } : {}),
    });
  };

  server.registerTool("create_playground", { title: "Create a playground", description: TOOLS.create_playground, inputSchema: specShape }, async (args) => {
    const parsed = parseSpec(args);
    if (!parsed.ok) return fail(`The spec is not valid. Nothing was created. Fix these and call create_playground again:\n- ${parsed.errors.join("\n- ")}`);
    // The id asked for may be taken (by anyone): the playground then gets that id with a suffix, and the result says so.
    const again = { existing: "You already have a playground with exactly this spec: this is it, nothing was created. Pages that were not read before are being read now (see build). To change it, call revise_playground." };
    const renamed = (id: string) => (id === parsed.domain.id ? {} : { id_note: `The id "${parsed.domain.id}" was taken, so this playground got the id "${id}". Use "${id}" in every later call.` });
    try {
      if (parsed.kind === "preview") {
        const r = await createPreview(parsed.domain, parsed.kit);
        if ("refused" in r) return fail(r.refused);
        await within(Promise.all([r.brand, r.web]));
        return preview(r.id, { ...renamed(r.id), ...(r.existed ? again : {}), ...(await leftOut(r.id, parsed.leftOut)) }, parsed.warnings);
      }
      const r = await createPlayground(parsed.domain, origin);
      if ("refused" in r) return fail(r.refused);
      const w = await within(r.work);
      return built(r.id, { ...renamed(r.id), ...(r.existed ? again : {}), ...(await leftOut(r.id, parsed.leftOut)) }, w.done ? w.value : null);
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
      const found = await find(playground_id);
      if (typeof found === "string") return fail(found);
      // While pricing pages are being read, wait for them (at most WAIT_MS), so one more call usually sees the finished build.
      const p = (await settled(playground_id, WAIT_MS)) ?? found;
      const t = since == null ? null : Date.parse(since);
      if (t != null && Number.isNaN(t)) return fail(`since "${since}" is not a date-time. Use ISO 8601, for example 2026-11-13T18:00:00Z, or leave it out.`);
      // Someone else's example: the non-owner projection (lib/report.ts), and a note that it is not this person's.
      const own = canWrite(currentActor(), p);
      const view = own ? p : nonOwnerView(p);
      return text({ ...(own ? {} : { not_yours: NOT_YOURS }), ...(view.kit ? previewReport(view, url(playground_id)) : readReport(view, url(playground_id), t)), ...(await leftOut(playground_id)), ...(include_spec ? { spec: toSpec(p) } : {}) });
    },
  );

  server.registerTool(
    "recheck_playground",
    { title: "Re-check a playground now", description: TOOLS.recheck_playground, inputSchema: { playground_id: z.string().max(40).describe("Id of the playground: the last part of its URL.") } },
    async ({ playground_id }) => {
      const before = await find(playground_id, true);
      if (typeof before === "string") return fail(before);
      if (before.kit) {
        // A preview playground: re-read its web sources. Clay reports what changed; the agent judges what it means.
        if (!before.kit.kit.web?.length) return fail(`"${playground_id}" is a preview playground without web sources (data.web): it has nothing to re-check. Call read_playground for its settled result.`);
        const w = await within(recheckWeb(playground_id));
        const now = (await load()).playgrounds[playground_id];
        if (!w.done) return text({ playground_id, url: url(playground_id), status: "running", still_reading: webReading(now), next: "The pages are still being re-read. Tell the person that today's facts are being read. Then call read_playground: it waits up to 20 seconds; repeat until build.status is \"done\". Its web_changes are what changed." });
        return text({
          playground_id,
          url: url(playground_id),
          checked_at: new Date().toISOString(),
          ...(w.value?.stop ? { stopped: `The re-check stopped early: ${w.value.stop}. Do not retry now; tell the person.` } : {}),
          changed_now: w.value?.changes.length ?? 0,
          web_changes: webChanges(now.kit!),
          data: dataReport(now.kit!, webReading(now)),
          problems: webProblems(now.kit!, webReading(now)),
          // One statement, taken from web_changes, so the two cannot disagree. After a stop (rate limit, cap) it is the stop.
          tell_person: w.value?.stop ? "Not every page could be read again: say so, and do not say that nothing changed. Do not retry now." : (w.value?.changes.length ?? 0) > 0 ? `The page shows the new values after a reload, with what changed since they settled. ${webChanges(now.kit!).judge}` : `Nothing new to show on the page. ${webChanges(now.kit!).judge}`,
          note: WEB_NOTE,
        });
      }
      const ids = before.domain.vendors.map((v) => v.id);
      const started = new Date().toISOString();
      const w = await within(recheckAll(playground_id, ids, "manual", origin));
      const p = (await load()).playgrounds[playground_id];
      if (!w.done)
        return text({
          playground_id,
          url: url(playground_id),
          status: "running",
          build: buildReport(p),
          saved_decision_before_this_recheck: decisionReport(p) ?? "none: the person has not saved a decision yet",
          next: `The pricing pages are still being re-read. Tell the person that today's prices are being read. Then call read_playground with since "${started}": it waits up to 20 seconds. Repeat until build.status is "done". Its change_events are what changed today, and saved_decision says whether the decision holds on today's prices.`,
        });
      const results = w.value!;
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
        left_out: specShape.left_out,
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
          const r = await revisePreview(parsed.domain, parsed.kit);
          await within(Promise.all([r.brand, r.web]));
          const preview_kept = !r.previewKept ? null : r.outputsKept ? "Only words changed: the preview code, the controls and the outputs are the same, so the verified state and the settled result stand." : "The preview code and the controls are the same, so its verified state stands. The outputs changed: the person must reload the page before they settle.";
          return preview(playground_id, { settled_result_cleared: r.settledCleared, ...(preview_kept ? { preview_kept } : {}), tell_person, ...(await leftOut(playground_id, parsed.leftOut)) }, parsed.warnings);
        }
        const r = await revisePlayground(parsed.domain, origin);
        const w = await within(r.work);
        return built(playground_id, { pages_read_again: r.recollected, saved_decision_cleared: r.decisionCleared, tell_person, ...(await leftOut(playground_id, parsed.leftOut)) }, w.done ? w.value : null, r.recollected);
      } catch (e) {
        return fail(`The playground could not be revised: ${message(e)}`);
      }
    },
  );

  return server;
}

export { INSTRUCTIONS, TOOLS };

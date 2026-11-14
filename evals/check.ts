// The checker's pure parts: no browser, no network, no model. Each check returns pass, fail or na with a one-line reason.
import { BUILD_TOOLS, TOOL, addedNames, callTarget, createdId, isBuildError, isIdCollision, parseBuild, problemSubject, type Dimension } from "./adapter.ts";
import type { Case, Given } from "./requests.ts";

export type Check = { id: string; status: "pass" | "fail" | "na"; reason: string };
/** One tool call of the agent, in the form both subjects are normalised to. `mcp`: a tool of the Clay server. */
export type Call = { tool: string; mcp: boolean; input: Record<string, unknown>; result: string; isError: boolean };

const pass = (id: string, reason: string): Check => ({ id, status: "pass", reason });
const fail = (id: string, reason: string): Check => ({ id, status: "fail", reason });
const na = (id: string, reason: string): Check => ({ id, status: "na", reason });
const cut = (s: string, n = 140) => (s.length > n ? s.slice(0, n - 1) + "…" : s).replace(/\s+/g, " ");
const fmt = (n: number) => n.toLocaleString("en-US");

/** Failure causes of the report, by check id. */
export const CAUSE: Record<string, string> = {
  agent_run: "harness or infrastructure (timeout, CLI error, rate limit)",
  tool_use: "agent did not use the tool",
  no_playground: "wrong when no playground was right",
  direct_answer: "wrong when no playground was right",
  creation: "bad spec not repaired",
  build_timeout: "build call timed out at the agent's client",
  page_loads: "page error",
  preview: "page error",
  settle: "page error",
  controls: "dead control",
  ranges: "bad ranges",
  handback_read: "hand-back mismatch",
  handback_match: "hand-back mismatch",
};

// ---- Did the agent call the create tool when it should, and not when it should not?
export function toolUse(c: Case, calls: Call[], preparedId: string | null): Check {
  const clay = calls.filter((x) => x.mcp);
  const created = clay.filter((x) => x.tool === TOOL.create);
  if (c.expect === "build") return created.length ? pass("tool_use", `called ${TOOL.create}`) : fail("tool_use", `the agent never called ${TOOL.create}${clay.length ? ` (it called ${[...new Set(clay.map((x) => x.tool))].join(", ")})` : " or any Clay tool"}`);
  if (c.expect === "none") {
    const built = clay.filter((x) => BUILD_TOOLS.includes(x.tool));
    return built.length ? fail("no_playground", `the agent called ${built[0].tool} where the simple thing was right`) : pass("no_playground", "no playground was built");
  }
  // Return visit: work on the prepared playground, do not build another.
  if (created.length) return fail("tool_use", `the agent built a new playground instead of using ${preparedId}`);
  for (const need of c.mustCall ?? []) {
    const hit = clay.filter((x) => x.tool === TOOL[need] && callTarget(x.input) === preparedId);
    if (!hit.length) return fail("tool_use", `the agent never called ${TOOL[need]} on ${preparedId}`);
    if (need === "revise" && c.mustAdd && !hit.some((x) => addedNames(x.input).some((n) => c.mustAdd!.test(n)))) return fail("tool_use", `${TOOL.revise} did not add what the person asked for (${c.mustAdd})`);
  }
  return pass("tool_use", `called ${(c.mustCall ?? []).map((n) => TOOL[n]).join(" and ")} on the prepared playground`);
}

/** The playground the agent built: the last successful build call. */
export function lastBuild(calls: Call[]) {
  const builds = calls.filter((x) => x.mcp && BUILD_TOOLS.includes(x.tool));
  const ok = builds.filter((x) => !x.isError).map((x) => parseBuild(x.result)).filter((b) => b.id);
  // When no result reached the agent, the id the create call asked for: the server may have built it all the same.
  const attempted = builds.filter((x) => x.tool === TOOL.create).map((x) => createdId(x.input)).filter(Boolean).pop() ?? null;
  return { builds, last: ok.length ? ok[ok.length - 1] : null, attempted };
}

// ---- Did creation succeed, and were reported problems repaired or told to the person plainly?
export function creation(calls: Call[], saidToPerson: string): Check {
  const { builds, last } = lastBuild(calls);
  if (!builds.length) return na("creation", "no build call");
  // Not a first try: the agent met a playground that an earlier run left on this server, under the id it chose.
  const collided = builds.find((x) => x.isError && isIdCollision(x.result));
  if (collided) return fail("agent_run", `the server already had a playground with the id the agent chose (${createdId(collided.input)}), left by an earlier run; this sample is void, use a fresh store`);
  if (!last && builds.every((x) => /timed out|timeout/i.test(x.result))) return fail("build_timeout", `all ${builds.length} build call(s) timed out at the agent's client ("${cut(builds[0].result, 60)}"), so the agent never saw a build result`);
  if (!last) return fail("creation", `no build call succeeded: ${cut(builds[builds.length - 1].result)}`);
  if (last.stopped) return { id: "agent_run", status: "fail", reason: `the server stopped reading: ${cut(last.stopped)}` };
  const open = last.problems.filter(isBuildError);
  if (!open.length) return pass("creation", `built ${last.id}${builds.length > 1 ? ` in ${builds.length} build calls` : ""}, no open build problem`);
  const said = saidToPerson.toLowerCase().replace(/[_-]/g, " ");
  const untold = open.filter((p) => !said.includes(problemSubject(p).toLowerCase().replace(/[_-]/g, " ")));
  if (!untold.length) return pass("creation", `${open.length} build problem(s) left, each named to the person`);
  return fail("creation", `build problem left and not told: ${cut(untold[0])}`);
}

// ---- Are the dimensions sane against the request?
/** The agent may count in another unit (millions of tokens for tokens), so a power of 1000 between the two is accepted. */
const SCALES = [1, 1e3, 1e6, 1e9];
const near = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 0.01;
/** How much wider than the largest number the person mentioned a range may be. */
export const MAX_WIDTH = 20;

export function rangeProblem(g: Given, d: Dimension): string | null {
  const k = SCALES.find((s) => near(d.initial * s, g.value));
  if (!k) return `${d.id} starts at ${fmt(d.initial)}, the person said ${fmt(g.value)}`;
  const mentioned = g.mentioned ?? [g.value];
  const [lo, hi] = [d.min * k, d.max * k];
  const outside = mentioned.find((m) => m < lo || m > hi);
  if (outside != null) return `${d.id} runs ${fmt(lo)} to ${fmt(hi)}, which leaves out ${fmt(outside)}`;
  const top = Math.max(...mentioned);
  if (hi - lo > MAX_WIDTH * top) return `${d.id} runs ${fmt(lo)} to ${fmt(hi)}, more than ${MAX_WIDTH} times the ${fmt(top)} the person mentioned`;
  return null;
}

export function ranges(given: Given[] | undefined, dims: Dimension[] | null): Check {
  if (!given?.length) return na("ranges", "the person gave no numbers");
  if (!dims) return fail("ranges", "the playground's dimensions could not be read");
  for (const g of given) {
    const matching = dims.filter((d) => g.about.test(`${d.id} ${d.label} ${d.unit}`));
    if (!matching.length) return fail("ranges", `no control for ${g.about} (the person said ${fmt(g.value)}); controls: ${dims.map((d) => d.id).join(", ")}`);
    const problems = matching.map((d) => rangeProblem(g, d));
    if (!problems.includes(null)) return fail("ranges", problems[0]!);
  }
  return pass("ranges", `${given.length} given number(s) are the starting values, inside ranges of sane width`);
}

// ---- Hand-back.
export function readBack(calls: Call[], id: string): Check {
  const hit = calls.some((x) => x.mcp && x.tool === TOOL.read && callTarget(x.input) === id);
  return hit ? pass("handback_read", `called ${TOOL.read} on ${id}`) : fail("handback_read", `the agent did not call ${TOOL.read} on ${id} after the person settled`);
}

/** Price cases: the agent's answer must name what the person saved. */
export function namesChoice(text: string, chosen: string): Check {
  return text.toLowerCase().includes(chosen.toLowerCase()) ? pass("handback_match", `the answer names the saved choice (${chosen})`) : fail("handback_match", `the answer does not name the saved choice (${chosen})`);
}

/** Every leaf value of the settled outputs: strings as they are, numbers as numbers. An output whose text is JSON is opened up. */
export function leaves(v: unknown, path = ""): { path: string; value: string | number }[] {
  if (typeof v === "string" && /^\s*[[{]/.test(v)) {
    try {
      return leaves(JSON.parse(v), path);
    } catch {}
  }
  if (typeof v === "string" || typeof v === "number") return [{ path, value: v }];
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => leaves(x, path ? `${path}.${k}` : k));
  return [];
}
const numbersIn = (text: string) => (text.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);

/** Code cases: the file on disk must have changed and must hold every settled output exactly. */
export function fileMatches(before: string, after: string | null, outputs: unknown): Check {
  if (after == null) return fail("handback_match", "the file is gone");
  if (after === before) return fail("handback_match", "the file did not change");
  const want = leaves(outputs);
  if (!want.length) return fail("handback_match", "the playground returned no outputs to compare");
  const nums = numbersIn(after);
  const flat = (t: string) => t.replace(/\s+/g, " ").trim(); // line breaks and indentation may differ, nothing else
  const missing = want.find((w) => (typeof w.value === "string" ? !flat(after).includes(flat(w.value)) : !nums.includes(w.value)));
  return missing ? fail("handback_match", `the file lacks the settled ${missing.path}: ${cut(String(missing.value), 80)}`) : pass("handback_match", `the file holds all ${want.length} settled value(s)`);
}

/** Cases where no playground is right: the direct answer, or the direct edit. */
export function directAnswer(c: Case, finalText: string, before: string | null, after: string | null): Check {
  if (c.fileMust) {
    if (after == null || after === before) return fail("direct_answer", `${c.fileMust.path} did not change`);
    return c.fileMust.match.test(after) ? pass("direct_answer", `${c.fileMust.path} has the requested change`) : fail("direct_answer", `${c.fileMust.path} changed, but not to what was asked (${c.fileMust.match})`);
  }
  if (c.answer) return c.answer.test(finalText) ? pass("direct_answer", `the answer matches ${c.answer}`) : fail("direct_answer", `the answer does not match ${c.answer}`);
  return finalText.trim().length > 40 ? pass("direct_answer", "the agent answered in words") : fail("direct_answer", "the agent gave no answer");
}

/** A case passes only if every applicable check passes. */
export const verdict = (checks: Check[]) => {
  const firstFail = checks.find((c) => c.status === "fail") ?? null;
  return { result: firstFail ? ("fail" as const) : ("pass" as const), firstFail };
};

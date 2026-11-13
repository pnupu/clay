// Thin Context.dev client. Shapes verified against https://docs.context.dev/openapi.json on 2026-11-13.
// Self-contained (node builtins only) so scripts can import it without a bundler.
import { appendFileSync, mkdirSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";

const BASE = "https://api.context.dev/v1";

export class ContextDevError extends Error {
  constructor(public status: number, public code: string | null, message: string) {
    super(message);
  }
  /** Rate limit or quota: callers must stop calling and report. */
  get stop() {
    return this.status === 429 || this.status === 402 || this.code === "USAGE_EXCEEDED" || this.code === "RATE_LIMITED";
  }
}

type Json = Record<string, unknown>;

/** One API call. Records method, path, status, latency and credits (never the key or the body) in run/requests.jsonl. */
export async function cd<T = Json>(method: string, path: string, body?: unknown): Promise<T & { _ms: number }> {
  const key = process.env.CONTEXT_DEV_API_KEY;
  if (!key) throw new ContextDevError(0, "NO_KEY", "CONTEXT_DEV_API_KEY is not set");
  const t0 = Date.now();
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const ms = Date.now() - t0;
  const data = (await res.json().catch(() => ({}))) as Json;
  const credits = (data.key_metadata as Json | undefined)?.credits_consumed ?? null;
  try {
    // lean: request log is a local file; on Vercel the filesystem is read-only, so this is skipped there. Use the Context.dev request logs API instead.
    mkdirSync("run", { recursive: true });
    appendFileSync("run/requests.jsonl", JSON.stringify({ at: new Date().toISOString(), via: "app", method, path, status: res.status, ms, credits }) + "\n");
  } catch {}
  if (!res.ok) throw new ContextDevError(res.status, (data.error_code as string) ?? null, `Context.dev ${method} ${path} -> ${res.status} ${data.error_code ?? ""} ${data.message ?? ""}`.trim());
  return { ...(data as T), _ms: ms };
}

/** Find a page with Search (POST /web/search). Returns the top result on the vendor's own domain, or null. */
export async function searchTopUrl(query: string, domain: string) {
  const r = await cd<{ results: { url: string; title: string }[] }>("POST", "/web/search", { query, numResults: 3, includeDomains: [domain] });
  return { url: r.results?.[0]?.url ?? null, ms: r._ms };
}

type Output<T> = { requested: boolean; success: boolean | null; data: T | null; error_code?: string; message?: string; isTruncated?: true };
export type ScrapeResult = {
  url: string;
  markdown: Output<string>;
  json: Output<Json>;
  isPartial?: true;
  cache_metadata: { status: "hit" | "miss" | "zdr"; age_ms: number };
  request_id: string;
  _ms: number;
};

/** Read one page (POST /web/scrape). maxAgeMs 0 forces a fresh capture, so Markdown and JSON come from the same visit. */
export function scrape(url: string, json?: { schema: unknown; instructions: string }) {
  return cd<ScrapeResult>("POST", "/web/scrape", {
    url,
    formats: { markdown: true, ...(json ? { json: true } : {}) },
    ...(json ? { jsonParams: json } : {}),
    maxAgeMs: 0,
  });
}

export type Monitor = { id: string; status: string; webhook: { url: string; secret?: string; events: string[] } | null; initial_run_id: string | null };

/** Page monitor with semantic detection and a signed webhook (POST /monitors). The secret is only returned to keys with monitors:write. */
export function createMonitor(name: string, url: string, webhookUrl: string, instructions: string) {
  return cd<Monitor>("POST", "/monitors", {
    name,
    tags: ["decision-playground"],
    target: { type: "page", url, instructions },
    webhook: { url: webhookUrl, events: ["change.detected"], retry: {} },
  });
}

export const deleteMonitor = (id: string) => cd<{ id: string; deleted: boolean }>("DELETE", `/monitors/${id}`);
export const usage = () => cd<{ credits_remaining: number; period: { credits_used: number } | null }>("GET", "/org/usage");

/** Signature check from https://docs.context.dev/webhooks : X-Context-Signature is "t=<unix>,v1=<hex>", v1 = HMAC-SHA256(secret, `${t}.${rawBody}`). */
export function verifyWebhook(rawBody: Buffer, header: string, secret: string, nowMs = Date.now()): boolean {
  if (!secret) return false;
  const parts: Record<string, string> = Object.create(null);
  for (const part of header.split(",")) {
    const pair = part.trim().split("=");
    if (pair.length !== 2 || pair[0] in parts) return false;
    parts[pair[0]] = pair[1];
  }
  if (!/^[0-9]{1,12}$/.test(parts.t ?? "") || !/^[a-f0-9]{64}$/i.test(parts.v1 ?? "")) return false;
  if (Math.abs(nowMs / 1000 - Number(parts.t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.`).update(rawBody).digest();
  const actual = Buffer.from(parts.v1, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

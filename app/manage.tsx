"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** One request at a time, its error shown, and the page refreshed after it worked. */
function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(url: string, init: RequestInit, ask?: string) {
    if (ask && !confirm(ask)) return;
    setBusy(true);
    setError(null);
    const r = await fetch(url, init).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setError((await r?.json().catch(() => null))?.error ?? "That did not work. Try again.");
    router.refresh();
  }
  return { busy, error, run };
}
const mark = (body: object): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/**
 * A row of the home page list: delete; for the admin, unmark an example, or open the lab to mark it. Marking and
 * featuring happen only on the lab page (MarkExample), where the admin sees what the mark publishes.
 */
export default function Manage({ id, title, example, admin, deletable }: { id: string; title: string; example: boolean; admin: boolean; deletable: boolean }) {
  const { busy, error, run } = useAction();
  return (
    <div className="manage">
      {admin && (example ? <button className="small-btn" disabled={busy} onClick={() => run(`/api/p/${id}/example`, mark({ example: false }))}>Unmark example</button> : <Link className="small" href={`/p/${id}`}>Open to mark as example</Link>)}
      {deletable && <button className="small-btn" disabled={busy} onClick={() => run(`/api/p/${id}`, { method: "DELETE" }, `Delete the lab "${title}"? This cannot be undone.`)} aria-label={`Delete ${title}`}>Delete</button>}
      {error && <p className="small bad">{error}</p>}
    </div>
  );
}

/**
 * The admin's mark on the lab page. `version` is the version of what this page rendered (lib/report.ts,
 * viewVersion), and the preview frame of a person's lab is pinned to it: a mark publishes what the admin is
 * looking at, or is refused (409) when the lab changed since this page loaded.
 */
export function MarkExample({ id, version, example, featured }: { id: string; version: string; example: boolean; featured: boolean }) {
  const { busy, error, run } = useAction();
  const to = `/api/p/${id}/example`;
  return (
    <section className="operator-bar small" aria-label="Operator: example mark">
      <span className="muted">Operator · {example ? (featured ? "example, featured on the landing page" : "example") : "not an example"} · version {version}</span>
      {!example && <button className="small-btn" disabled={busy} onClick={() => run(to, mark({ example: true, version }))}>Mark as example</button>}
      {example && !featured && <button className="small-btn" disabled={busy} onClick={() => run(to, mark({ featured: true, version }))}>Feature on the landing page</button>}
      {example && <button className="small-btn" disabled={busy} onClick={() => run(to, mark({ example: false }))}>Unmark example</button>}
      {!example && <span className="muted">The mark publishes what this page shows. If the lab changes before you click, it is refused: reload and look again.</span>}
      {error && <span className="bad" role="alert">{error}</span>}
    </section>
  );
}

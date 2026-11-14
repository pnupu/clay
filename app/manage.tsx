"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Delete a playground; the admin also marks it as an example or unmarks it, and chooses the example that the landing page embeds. */
export default function Manage({ id, title, example, featured, admin, deletable }: { id: string; title: string; example: boolean; featured: boolean; admin: boolean; deletable: boolean }) {
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
  return (
    <div className="manage">
      {admin && <button className="small-btn" disabled={busy} onClick={() => run(`/api/p/${id}/example`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ example: !example }) })}>{example ? "Unmark example" : "Mark as example"}</button>}
      {admin && example && !featured && <button className="small-btn" disabled={busy} onClick={() => run(`/api/p/${id}/example`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ featured: true }) })}>Feature on the landing page</button>}
      {deletable && <button className="small-btn" disabled={busy} onClick={() => run(`/api/p/${id}`, { method: "DELETE" }, `Delete the playground "${title}"? This cannot be undone.`)} aria-label={`Delete ${title}`}>Delete</button>}
      {error && <p className="small bad">{error}</p>}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Delete a playground; the admin also marks it as an example or unmarks it. */
export default function Manage({ id, example, admin }: { id: string; example: boolean; admin: boolean }) {
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
      <button className="small-btn" disabled={busy} onClick={() => run(`/api/p/${id}`, { method: "DELETE" }, "Delete this playground? This cannot be undone.")}>Delete</button>
      {error && <p className="small bad">{error}</p>}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

/**
 * The owner link: /enter#key=<owner key>. The key is in the URL fragment, which a browser never sends to a server, so it
 * does not reach request logs. This page posts it once, the server sets an httpOnly cookie, and the browser moves on to a clean URL.
 */
export default function Enter() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // The raw text after "key=": URLSearchParams would turn a "+" of a base64 key into a space.
    const key = /[#&]key=([^&]*)/.exec(location.hash)?.[1] ?? null;
    history.replaceState(null, "", location.pathname);
    fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) })
      .then((r) => (r.ok ? location.replace("/") : setError("This link does not hold the owner key of this deployment.")))
      .catch(() => setError("The key could not be checked. Try the link again."));
  }, []);
  return <main className="shell"><p className={error ? "alert" : "muted"}>{error ?? "Checking the owner key…"}</p></main>;
}

"use client";

import { useEffect, useState } from "react";

/**
 * The owner link: /enter#key=<owner key>. The key is in the URL fragment, which a browser never sends to a server, so it
 * does not reach request logs. This page posts it once, the server sets an httpOnly cookie, and the browser moves on to a clean URL.
 */
export default function Enter() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // The text after "key=". URLSearchParams is not used: it would turn a "+" of a base64 key into a space.
    // The text is tried as it is, and then with %XX decoded, for a link in which the key was percent-encoded.
    const raw = /[#&]key=([^&]*)/.exec(location.hash)?.[1] ?? null;
    let decoded = raw;
    try {
      decoded = raw && decodeURIComponent(raw);
    } catch {}
    history.replaceState(null, "", location.pathname);
    const post = (key: string | null) => fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
    post(raw)
      .then((r) => (r.ok || decoded === raw ? r : post(decoded)))
      .then((r) => (r.ok ? location.replace("/") : setError("This link does not hold the owner key of this deployment.")))
      .catch(() => setError("The key could not be checked. Try the link again."));
  }, []);
  return <main className="shell"><p className={error ? "alert" : "muted"}>{error ?? "Checking the owner key…"}</p></main>;
}

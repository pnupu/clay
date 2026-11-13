import Link from "next/link";
import { load } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Every playground of this app. The first one is the built-in example; an agent creates the others through the MCP server. */
export default function Home() {
  const playgrounds = Object.values(load().playgrounds).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <main className="shell home">
      <p className="eyebrow">Clay · data read from the web by Context.dev</p>
      <h1>Playgrounds</h1>
      <p className="muted">Your own agent builds a playground for a decision through the MCP server at <code>/api/mcp</code>. You explore it here, and the agent reads the settled result back.</p>
      <ul className="playgrounds">
        {playgrounds.map((p) => (
          <li key={p.domain.id} className="card">
            <Link href={`/p/${p.domain.id}`}>{p.domain.question}</Link>
            <p className="small muted">
              {p.domain.vendors.map((v) => v.name).join(", ")} · {Object.values(p.sources).filter((s) => s.snapshot).length} of {p.domain.vendors.length} sources read
              {p.decision ? ` · decision saved: ${p.domain.vendors.find((v) => v.id === p.decision!.chosen)?.name ?? p.decision.chosen}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}

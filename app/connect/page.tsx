import Link from "next/link";
import { headers } from "next/headers";
import { viewer } from "@/app/api/respond";
import { userDailyCap, userPlaygroundCap } from "@/lib/accounts";
import { load, publicBase } from "@/lib/store";
import AgentKey from "./agent-key";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect your agent · Clay" };

export default async function Connect() {
  const me = await viewer();
  const h = await headers();
  const endpoint = `${publicBase() ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`}/api/mcp`;
  return (
    <main className="shell narrow">
      <p className="eyebrow">Connect your agent</p>
      <h1>Let your own agent build playgrounds for you</h1>
      <p className="lede">Your agent builds a playground for you, and you try it here: only you can open it. Add Clay to Claude Code or Codex once (it connects as an MCP server), then ask your agent for help. A choice that rests on live prices is kept as a small file in your repository, so any later session of your agent can re-check it.</p>
      {me.kind === "visitor" ? (
        <section className="card">
          <h2>Sign up to get your agent key</h2>
          <p>The key ties the playgrounds your agent builds to your account. An account is free. Sign up with GitHub, Google, or an email address and a password.</p>
          <p className="row wrap">
            <Link className="button primary" href="/sign-up?redirect_url=/connect">Sign up</Link>
            <Link className="button" href="/sign-in?redirect_url=/connect">Sign in</Link>
          </p>
          <p className="small muted">Want to look first? <Link href="/#examples">Try an example</Link>, no account needed.</p>
        </section>
      ) : me.kind === "admin" ? (
        <section className="card">
          <h2>You are signed in with the owner key</h2>
          <p>The owner key works as the agent key for every playground. Connect with the commands in the README.</p>
        </section>
      ) : (
        <AgentKey endpoint={endpoint} createdAt={(await load()).users[me.userId]?.keyCreatedAt ?? null} />
      )}
      <section className="card">
        <h2>Limits per person</h2>
        <ul className="plain">
          <li>{userPlaygroundCap() || "No limit on"} playgrounds. Delete old ones on the home page.</li>
          <li>{userDailyCap() || "No limit on"} web requests per day, for reading prices, brands and web pages (a brand counts as 2). The count resets at 00:00 UTC. Moving the controls needs none, and a preview playground without web data needs none.</li>
        </ul>
      </section>
    </main>
  );
}

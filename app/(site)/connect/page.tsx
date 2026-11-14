import { headers } from "next/headers";
import { viewer } from "@/app/api/respond";
import { userDailyCap, userPlaygroundCap } from "@/lib/accounts";
import { load, publicBase } from "@/lib/store";
import AgentKey from "./agent-key";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect your agent · Clay", description: "Add Clay to Claude Code or Codex with one command, then type “build me a playground for …”." };

// A task page of the website: the system of the landing page (nav, type, tokens, buttons), but one section that is as
// tall as its steps. The skill's one-screen sections are for a page that sells; this one is read while a person types
// commands, so nothing is cut to a screen. The steps are Clay's own blocks (app/clay.css).
export default async function Connect() {
  const me = await viewer();
  const h = await headers();
  const endpoint = `${publicBase() ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`}/api/mcp`;
  return (
    <>
      <main id="top">
        <section className="section doc" aria-labelledby="connect-h">
          <div className="wrap">
            <div className="grid grid--top">
              <div className="span-5 doc__head">
                <h1 id="connect-h" className="t-h2">Connect your agent to Clay</h1>
                <p className="t-lead">Your agent builds a playground for you, and you try it here: only you can open it. Add Clay to Claude Code or Codex once (it connects as an MCP server), then type “build me a playground for …”.</p>
                <p>A choice that rests on live prices is kept as a small file in your repository, so any later session of your agent can re-check it.</p>
                <ul className="rows doc__limits" aria-label="Limits per person">
                  <li><span className="rows__name">Playgrounds</span><p>Delete old ones on the home page.</p><span className="rows__value">{userPlaygroundCap() || "No limit"}</span></li>
                  <li><span className="rows__name">Web requests a day</span><p>For reading prices, brands and web pages (a brand counts as 2). The count resets at 00:00 UTC. Moving the controls needs none, and a preview playground without web data needs none.</p><span className="rows__value">{userDailyCap() || "No limit"}</span></li>
                </ul>
              </div>
              <div className="span-7 start-6 doc__steps clay">
                {me.kind === "visitor" ? (
                  <section className="pane">
                    <h2>Sign up to get your agent key</h2>
                    <p>The key ties the playgrounds your agent builds to your account. An account is free. Sign up with GitHub, Google, or an email address and a password.</p>
                    <p className="row wrap">
                      <a className="button primary" href="/sign-up?redirect_url=/connect">Sign up</a>
                      <a className="button" href="/sign-in?redirect_url=/connect">Sign in</a>
                    </p>
                    <p className="small muted">Want to look first? <a href="/#examples">Try an example</a>, no account needed.</p>
                  </section>
                ) : me.kind === "admin" ? (
                  <section className="pane">
                    <h2>You are signed in with the owner key</h2>
                    <p>The owner key works as the agent key for every playground. Connect with the commands in the README.</p>
                  </section>
                ) : (
                  <AgentKey endpoint={endpoint} createdAt={(await load()).users[me.userId]?.keyCreatedAt ?? null} />
                )}
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="doc-foot">
        <div className="wrap footer__legal">
          <span>&copy; 2026 Clay &nbsp; Built at Junction 2026 for the Context.dev challenge. Web data is read through Context.dev.</span>
          <a className="credits" href="/credits.txt">Typefaces: Gabarito, Figtree and DM Mono, SIL Open Font Licence</a>
        </div>
      </footer>
    </>
  );
}

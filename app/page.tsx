import Link from "next/link";
import { viewer } from "@/app/api/respond";
import { canWrite, isExample } from "@/lib/accounts";
import { DOMAIN } from "@/lib/domain";
import { load, type Playground } from "@/lib/store";
import Manage from "./manage";

export const dynamic = "force-dynamic";

// The gallery reads the title from domain.question, which every kind has (a preview keeps its title there), so a new
// kind shows without a change here; only its label falls back to "Playground".
type AnyPlayground = Playground;
const titleOf = (p: AnyPlayground, id: string) => p.domain?.question ?? id;
const kindOf = (p: AnyPlayground) => (p.kit ? "Preview, tuned by hand" : p.domain?.vendors?.length ? "Price decision" : "Playground");
const detailOf = (p: AnyPlayground) => (!p.kit && p.domain?.vendors?.length ? p.domain.vendors.map((v) => v.name).join(", ") : null);

export default async function Home() {
  const me = await viewer();
  const all = Object.entries((await load()).playgrounds as Record<string, AnyPlayground>).sort(([, a], [, b]) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const examples = all.filter(([id, p]) => isExample(p, id));
  const yours = me.kind === "visitor" ? [] : all.filter(([, p]) => canWrite(me, p));
  const first = examples[0]?.[0];
  return (
    <main className="landing">
      <section className="hero shell">
        <p className="eyebrow">Clay</p>
        <h1>Find out what you want by trying it.</h1>
        <p className="lede">Your own AI agent builds a playground for a decision: a page of controls on real data. You move the controls yourself and see every result change at once. When you have settled, your agent reads where you landed and carries it out.</p>
        <p className="row wrap">
          {first && <Link className="button primary" href={`/p/${first}`}>Try an example, no sign-up</Link>}
          <Link className="button" href="/connect">Connect your agent</Link>
        </p>
      </section>

      {first && (
        <section className="shell try" aria-label="Example playground">
          <div className="try-head">
            <h2>Try it here</h2>
            <p className="small muted">{titleOf(examples[0][1], first)} · <Link href={`/p/${first}`}>open full page</Link></p>
          </div>
          <iframe src={`/p/${first}`} title={`Example playground: ${titleOf(examples[0][1], first)}`} loading="lazy" />
        </section>
      )}

      <section className="shell steps" aria-label="How it works">
        <h2>How it works</h2>
        <ol>
          <li><strong>Your agent builds it.</strong> Ask your own agent, such as Claude Code or Codex, for help with a decision. Through Clay it builds a playground from data it reads on the web, and gives you the link.</li>
          <li><strong>You try it on your own.</strong> Move the controls and every number follows at once. No agent and no network call sits between a move and its result, so you can try as many values as you like.</li>
          <li><strong>Your agent carries it out.</strong> Save where you landed. Your agent reads your choice, the values you settled on and the range you tried, and acts on them.</li>
        </ol>
      </section>

      <section className="shell" id="examples" aria-label="Examples">
        <h2>Examples</h2>
        <p className="muted">Open one and use it fully. Nothing you do there is saved, and you need no account.</p>
        {examples.length ? (
          <ul className="gallery">
            {examples.map(([id, p]) => (
              <li key={id} className="card">
                <p className="eyebrow">{kindOf(p)}</p>
                <Link href={`/p/${id}`} className="title">{titleOf(p, id)}</Link>
                {detailOf(p) && <p className="small muted">{detailOf(p)}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="card">No examples yet.</p>
        )}
      </section>

      {me.kind !== "visitor" && (
        <section className="shell" id="yours" aria-label="Your playgrounds">
          <h2>{me.kind === "admin" ? "All playgrounds" : "Your playgrounds"}</h2>
          {yours.length ? (
            <ul className="mine">
              {yours.map(([id, p]) => (
                <li key={id} className="card">
                  <div>
                    <Link href={`/p/${id}`} className="title">{titleOf(p, id)}</Link>
                    <p className="small muted">{kindOf(p)} · created {(p.createdAt ?? "").slice(0, 10)}{isExample(p, id) ? " · example" : ""}{me.kind === "admin" && p.owner ? " · a person's" : ""}</p>
                  </div>
                  <Manage id={id} example={isExample(p, id)} admin={me.kind === "admin"} deletable={id !== DOMAIN.id} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="card">None yet. <Link href="/connect">Connect your agent</Link>, then ask it for help with a decision.</p>
          )}
        </section>
      )}

      <section className="shell connect-cta">
        <div className="card">
          <h2>Connect your agent</h2>
          <p>Clay is an MCP server. You bring your own agent and your own model subscription; Clay needs no AI key of its own. {me.kind === "visitor" ? "Sign up, get your agent key, and add Clay with one command." : "Get your agent key and add Clay with one command."}</p>
          <Link className="button primary" href="/connect">Connect your agent</Link>
        </div>
      </section>

      <footer className="shell small muted">Built at Junction 2026 for the Context.dev challenge. Web data is read through <a href="https://context.dev">Context.dev</a>.</footer>
    </main>
  );
}

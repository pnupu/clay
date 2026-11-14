import Link from "next/link";
import { viewer } from "@/app/api/respond";
import { canWrite, isExample, orderExamples } from "@/lib/accounts";
import { cardText, hostsOf, kindLabel } from "@/lib/card";
import { DOMAIN } from "@/lib/domain";
import { nonOwnerView } from "@/lib/report";
import { load, type Playground } from "@/lib/store";
import Kit from "./kit";
import Manage from "./manage";
import PricePlayground from "./playground";

export const dynamic = "force-dynamic";

// The gallery reads the title from domain.question, which every kind has (a preview keeps its title there), so a new
// kind shows without a change here; only its label falls back to "Playground".
type AnyPlayground = Playground;
const titleOf = (p: AnyPlayground, id: string) => p.domain?.question ?? id;
/** The web sources of a preview that were read: a page that failed is not "live web data". */
const readSources = (p: AnyPlayground) => (p.kit?.kit.web ?? []).filter((s) => p.kit!.web?.[s.id]?.read);
/** The label of a card, from what the playground is built on (lib/card.ts): live web data, a brand, the real thing tuned by hand, or prices. */
const kindOf = (p: AnyPlayground, whose: "yours" | "theirs" = "theirs") => kindLabel({ price: !p.kit && !!p.domain?.vendors?.length, preview: !!p.kit, web: readSources(p).length, brand: !!p.kit?.kit.brand && !!p.kit.brandData, inline: !!p.kit?.kit.inline }, whose);
/** Where the facts of a playground come from, in one short line: the vendors of a price playground, the hosts of a preview's web pages, its brand. */
function detailOf(p: AnyPlayground): string | null {
  if (!p.kit) return p.domain?.vendors?.length ? p.domain.vendors.map((v) => v.name).join(", ") : null;
  const hosts = hostsOf(readSources(p).map((s) => p.kit!.web?.[s.id]?.url ?? s.url ?? s.domain));
  const read = hosts.length ? `Read from ${hosts.slice(0, 4).join(", ")}${hosts.length > 4 ? ` and ${hosts.length - 4} more` : ""}` : null;
  const brand = p.kit.kit.brand && p.kit.brandData ? `${read ? "brand colours of" : "Brand colours of"} ${hostsOf([p.kit.kit.brand.domain])[0] ?? p.kit.kit.brand.domain}` : null;
  return [read, brand].filter(Boolean).join("; ") || null;
}

// What a gallery card says about an example. All of it is optional, so an example of any kind, with any note, gets a card.
const noteOf = (p: AnyPlayground) => (p.kit?.kit.notes ?? p.domain?.note ?? "").trim();
/** The controls a visitor gets. A price playground shows only the metrics and features that a page it has read mentions (app/playground.tsx). */
function controlsOf(p: AnyPlayground): string[] {
  if (p.kit) return p.kit.kit.controls.map((c) => c.label);
  const plans = Object.values(p.sources ?? {}).flatMap((s) => s.snapshot?.model.plans ?? []);
  const metrics = (p.domain?.metrics ?? []).filter((m) => plans.some((x) => x.meters?.some((y) => y.metric === m.id)));
  const features = (p.domain?.features ?? []).filter((f) => plans.some((x) => x.features?.some((y) => y.feature === f.id && y.status != null)));
  return [...metrics, ...features].map((x) => x.label);
}
/** What a visitor's browser gets of a preview playground: not what its owner tried or settled. */
/** A visitor's view of an example's kit: the one non-owner projection (lib/report.ts). */
const forVisitor = (p: Playground) => nonOwnerView(p).kit!;

export default async function Home() {
  const me = await viewer();
  const playgrounds = (await load()).playgrounds as Record<string, AnyPlayground>;
  const all = Object.entries(playgrounds).sort(([, a], [, b]) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  // The featured example first (the admin chooses it), then the newest first. The first one is embedded under "Try it here".
  const examples = orderExamples(playgrounds);
  const yours = me.kind === "visitor" ? [] : all.filter(([, p]) => canWrite(me, p));
  const first = examples[0]?.[0];
  // A returning person with playgrounds sees them first; everyone else meets them after the examples.
  const yoursFirst = me.kind === "user" && yours.length > 0;
  const yoursSection = me.kind === "visitor" ? null : (
    <section className="shell" id="yours" aria-label="Your playgrounds">
          <h2>{me.kind === "admin" ? "All playgrounds" : "Your playgrounds"}</h2>
          {yours.length ? (
            <ul className="mine">
              {yours.map(([id, p]) => (
                <li key={id} className="card">
                  <div>
                    <Link href={`/p/${id}`} className="title">{titleOf(p, id)}</Link>
                    <p className="small muted">{kindOf(p, me.kind === "admin" && p.owner ? "theirs" : "yours")} · created {(p.createdAt ?? "").slice(0, 10)}{isExample(p, id) ? (p.featured ? " · example, featured on this page" : " · example") : ""}{me.kind === "admin" && p.owner ? " · a person's" : ""}</p>
                  </div>
                  <Manage id={id} title={titleOf(p, id)} example={isExample(p, id)} featured={p.featured === true} admin={me.kind === "admin"} deletable={id !== DOMAIN.id} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="card">None yet. <Link href="/connect">Connect your agent</Link>, then ask it for help with a decision.</p>
          )}
        </section>
  );
  return (
    <main className="landing">
      {yoursFirst && yoursSection}
      <section className="hero shell">
        <p className="eyebrow">Clay</p>
        <h1>Find out what you want by trying it.</h1>
        <p className="lede">Some things you cannot put into words: why a button looks off, how an animation should feel, which price plan fits. Your own AI agent builds you a page with the real thing and a few controls. You move them yourself and it changes at once. When it is right, your agent reads where you landed and carries it out.</p>
        <p className="row wrap">
          {first && <a className="button primary" href="#try">Try an example, no sign-up</a>}
          <Link className="button" href="/connect">Connect your agent</Link>
        </p>
      </section>

      {/* The featured example (else the newest), rendered in the page itself (no frame around it): it takes the height it needs, and on a
          narrow screen its preview stays in view while the page scrolls. It is read-only here for everyone. */}
      {first && (
        <section className="shell try" id="try" aria-label="Example playground">
          <div className="try-head">
            <h2>Try it here</h2>
            <p className="small muted"><Link href={`/p/${first}`}>Open this example on its own page</Link></p>
          </div>
          <div className="try-box">
            {examples[0][1].kit ? (
              <Kit key={JSON.stringify(examples[0][1].kit.kit)} id={first} title={titleOf(examples[0][1], first)} state={forVisitor(examples[0][1])} canWrite={false} leftOut={examples[0][1].leftOut} embedded />
            ) : (
              <PricePlayground key={JSON.stringify(examples[0][1].domain)} domain={examples[0][1].domain} explored={null} canWrite={false} admin={false} embedded />
            )}
          </div>
        </section>
      )}

      <section className="shell steps" aria-label="How it works">
        <h2>How it works</h2>
        <ol>
          <li><strong>Your agent builds it.</strong> Tell your own agent, such as Claude Code or Codex, what feels off or what you have to choose. Through Clay it builds a page from your real code, or from prices it reads on the vendors&apos; own pages, and gives you the link.</li>
          <li><strong>You try it on your own.</strong> Move the controls and the real thing follows at once: the button, the motion, the monthly cost. No agent and no network call sits between a move and its result, so you can try as many values as you like.</li>
          <li><strong>Your agent carries it out.</strong> Settle where you landed. Your agent reads the values, the range you tried and the finished text for your code, then writes it into your files or tells you where your decision stands.</li>
        </ol>
      </section>

      <section className="shell" id="examples" aria-label="Examples">
        <h2>Examples</h2>
        <p className="muted">Open one and use it fully. Nothing you do there is saved, and you need no account.</p>
        {examples.length ? (
          <ul className="gallery">
            {examples.map(([id, p]) => {
              // The person's request in quotes, else the start of the note; never cut inside a word (lib/card.ts).
              const said = cardText(noteOf(p));
              const controls = controlsOf(p);
              const detail = detailOf(p);
              return (
                <li key={id} className="card">
                  <p className="eyebrow">{kindOf(p)}</p>
                  {said && ("quote" in said ? <blockquote>“{said.quote}”</blockquote> : <p className="blurb">{said.blurb}</p>)}
                  <Link href={`/p/${id}`} className="title">{titleOf(p, id)}</Link>
                  {detail && <p className="small muted" data-sources>{detail}</p>}
                  {controls.length > 0 && <p className="small muted">You move: {controls.slice(0, 6).join(", ")}{controls.length > 6 ? ` and ${controls.length - 6} more` : ""}</p>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="card">No examples yet.</p>
        )}
      </section>

      {!yoursFirst && yoursSection}

      <section className="shell connect-cta">
        <div className="card">
          <h2>Connect your agent</h2>
          <p>Your own agent builds playgrounds for you, on your own model subscription; Clay needs no AI key of its own. It connects to your agent as an MCP server. {me.kind === "visitor" ? "Sign up, get your agent key, and add Clay with one command." : "Get your agent key and add Clay with one command."}</p>
          <Link className="button primary" href="/connect">Connect your agent</Link>
        </div>
      </section>

      <footer className="shell small muted">Built at Junction 2026 for the Context.dev challenge. Web data is read through <a href="https://context.dev">Context.dev</a>.</footer>
    </main>
  );
}

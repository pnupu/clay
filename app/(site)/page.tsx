import { viewer } from "@/app/api/respond";
import { canWrite, isExample, orderExamples, userDailyCap, userPlaygroundCap } from "@/lib/accounts";
import { kindLabel, recordPath } from "@/lib/card";
import { DOMAIN } from "@/lib/domain";
import { initialValues, renderOutputs } from "@/lib/kit";
import { nonOwnerView } from "@/lib/report";
import { load, type Playground } from "@/lib/store";
import Kit from "@/app/kit";
import Manage from "@/app/manage";

export const dynamic = "force-dynamic";

// The gallery reads the title from domain.question, which every kind has (a preview keeps its title there), so a new
// kind shows without a change here; only its label falls back to "Playground".
type AnyPlayground = Playground;
const titleOf = (p: AnyPlayground, id: string) => p.domain?.question ?? id;
/** The web sources of a preview that were read: a page that failed is not "live web data". */
const readSources = (p: AnyPlayground) => (p.kit?.kit.web ?? []).filter((s) => p.kit!.web?.[s.id]?.read);
/** The label of a card, from what the playground is built on (lib/card.ts): live web data, a brand, the real thing tuned by hand, or prices. */
const kindOf = (p: AnyPlayground, whose: "yours" | "theirs" = "theirs") => kindLabel({ price: !p.kit && !!p.domain?.vendors?.length, preview: !!p.kit, web: readSources(p).length, brand: !!p.kit?.kit.brand && !!p.kit.brandData, inline: !!p.kit?.kit.inline }, whose);

/** A visitor's view of an example's kit: the one non-owner projection (lib/report.ts). */
const forVisitor = (p: Playground) => nonOwnerView(p).kit!;
const NUMBER = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const Arrow = () => <svg className="m-arrow" viewBox="0 0 12 12" aria-hidden="true"><path className="m-arrow__stem" d="M1 6h8" /><path className="m-arrow__head" d="M4.5 2.5 8 6l-3.5 3.5" /></svg>;

export default async function Home() {
  const me = await viewer();
  const playgrounds = (await load()).playgrounds as Record<string, AnyPlayground>;
  const all = Object.entries(playgrounds).sort(([, a], [, b]) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  // The featured example first (the admin chooses it), then the newest first. The first one runs in the hero.
  const examples = orderExamples(playgrounds);
  const yours = me.kind === "visitor" ? [] : all.filter(([, p]) => canWrite(me, p));
  // The hero runs a preview playground: the featured example when it is one, else the first preview example. A price
  // playground is a full page of its own and has no place in the hero's collage.
  const hero = examples.find(([, p]) => p.kit) ?? null;
  const first = hero?.[0];
  const firstKit = hero?.[1].kit;
  // The text the agent would write for the hero's example at its start values: step 3 shows it.
  const written = firstKit ? Object.values(renderOutputs(firstKit.kit, initialValues(firstKit.kit.controls)))[0] : null;
  // Step 2 shows the hero example's own controls at their start values: its sliders, else whatever controls it has.
  const shown = (firstKit?.kit.controls ?? []).slice().sort((x, y) => Number(y.type === "slider") - Number(x.type === "slider")).slice(0, 3);
  // The marquee's words: the first two controls of each preview example, short ones only, each once.
  const moved = [...new Set(examples.flatMap(([, p]) => (p.kit?.kit.controls ?? []).map((c) => c.label).filter((l) => l.length <= 22).slice(0, 2)))].slice(0, 14);
  const priced = examples.find(([, p]) => !p.kit)?.[0] ?? DOMAIN.id;
  // A returning person with playgrounds sees them first; everyone else meets them after the examples.
  const yoursFirst = me.kind === "user" && yours.length > 0;
  const yoursSection = me.kind === "visitor" ? null : (
    <section className="section" id="yours" aria-labelledby="yours-h">
      <div className="wrap">
        <div className="section-head"><h2 id="yours-h">{me.kind === "admin" ? "All playgrounds" : "Your playgrounds"}</h2></div>
        {yours.length ? (
          <ul className="rows mine clay">
            {yours.map(([id, p]) => (
              <li key={id}>
                <a href={`/p/${id}`} className="rows__name">{titleOf(p, id)}</a>
                <p className="t-small muted">{kindOf(p, me.kind === "admin" && p.owner ? "theirs" : "yours")} · created {(p.createdAt ?? "").slice(0, 10)}{isExample(p, id) ? (p.featured ? " · example, featured on this page" : " · example") : ""}{me.kind === "admin" && p.owner ? " · a person's" : ""}</p>
                <div className="rows__value"><Manage id={id} title={titleOf(p, id)} example={isExample(p, id)} admin={me.kind === "admin"} deletable={id !== DOMAIN.id} /></div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-lead">None yet. <a className="link" href="/connect">Connect your agent</a>, then ask it for help with a decision.</p>
        )}
      </div>
    </section>
  );
  return (
    <>
      <main id="top">
        {/* The first screen is one grid: the words and the action together on the left columns, the product itself on
            the right ones, both starting on one line. (The skill dealt the triptych hero; its lone button on the right
            line read as adrift, so the page takes the split form.) */}
        <section className="hero hero--clay" data-enter aria-labelledby="hero-h">
          <div className="wrap"><div className="hero-text grid hero__grid">
            <div className="span-5 hero__words">
              <h1 id="hero-h">Playgrounds your own agent builds</h1>
              <p className="hero__lead">Say it to Claude Code or Codex:</p>
              <p className="say">build me a playground for …</p>
              <p className="hero__lead">It builds a page where your real component runs under a few controls. One command connects it.</p>
              <div className="btn-row">
                <a className="btn btn--primary" href="/connect">Connect your agent<Arrow /></a>
                <a className="btn btn--secondary" href="#examples">See the examples</a>
              </div>
            </div>
            <div className="span-7 start-6 live ui">
              {hero && <Kit key={JSON.stringify(hero[1].kit!.kit)} id={hero[0]} title={titleOf(hero[1], hero[0])} state={forVisitor(hero[1])} canWrite={false} leftOut={hero[1].leftOut} byTeam={!hero[1].owner} embedded />}
            </div>
          </div></div>
        </section>

        {yoursFirst && yoursSection}

        <section className="section" id="steps" aria-labelledby="steps-h">
          <div className="wrap">
            <div className="section-head">
              <h2 id="steps-h">A playground takes three steps. <span className="muted">Your agent does two of them.</span></h2>
            </div>
            <div className="grid">
              <article className="card card--row card--open span-4">
                <h3>1. Ask for a playground</h3>
                <p>Type “build me a playground for …” to your agent, with what feels off or what you have to choose. It builds the page from your real code.</p>
                <div className="panel"><div className="shot shot--term" role="img" aria-label="A terminal: the sentence a person types, the Clay tool the agent calls, and the link it returns">
                  <p><b>&gt;</b> build me a playground for …</p>
                  <p className="muted">clay · create_playground</p>
                  <p>/p/{first ?? "card-snap-back"}</p>
                </div></div>
              </article>
              <article className="card card--row card--open span-4">
                <h3>2. Shape it by hand</h3>
                <p>Move the controls and the real thing follows at once. No agent and no network call sits between a move and its result.</p>
                <div className="panel"><div className="shot shot--sliders" role="img" aria-label="The controls of the example in the hero, at their start values">
                  {shown.map((c) => (
                    <div key={c.id}><span>{c.label}</span><b>{String(c.initial)}</b>{c.type === "slider" && c.max > c.min && <i style={{ ["--at" as string]: `${Math.round(((c.initial - c.min) / (c.max - c.min)) * 100)}%` }} />}</div>
                  ))}
                  {shown.length === 0 && <div><span>Stiffness</span><b>60</b><i style={{ ["--at" as string]: "7%" }} /></div>}
                </div></div>
              </article>
              <article className="card card--row card--open span-4">
                <h3>3. Settle the values</h3>
                <p>Your agent reads the values, the range you tried and the finished text, then writes it into your files.</p>
                <div className="panel"><div className="shot shot--code" role="img" aria-label="The text the agent would write into the code for the example in the hero">
                  <pre>{written ?? "const SPRING = { … };"}</pre>
                </div></div>
              </article>
            </div>
            {moved.length > 5 && (
              <div className="asked">
                <p className="t-label">What people move in these examples</p>
                <div data-moment="marquee-row" data-moment-opts='{"speed": 36}'>
                  <ul className="mo-mq__track">{moved.map((label) => <li key={label}>{label}</li>)}</ul>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="section ground-surface" id="examples" aria-labelledby="examples-h">
          <div className="wrap">
            <div className="section-head">
              <h2 id="examples-h">{NUMBER[examples.length] ?? examples.length} {examples.length === 1 ? "example" : "examples"}, open without an account.</h2>
              <p>The Clay team made them, each with our own agent from one request. Open one and use it fully: nothing you do there is saved.</p>
            </div>
            {examples.length ? (
              <ul className="rows gallery">
                {examples.map(([id, p]) => (
                  <li key={id}>
                    <a href={`/p/${id}`} className="rows__name">{titleOf(p, id)}</a>
                    <span className="rows__value t-small" data-sources>{kindOf(p)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="t-lead">No examples yet.</p>
            )}
          </div>
        </section>

        {!yoursFirst && yoursSection}

        <section className="section" id="decisions" aria-labelledby="decisions-h">
          <div className="wrap">
            <div className="grid grid--top">
              <div className="span-6 decisions__text">
                <div className="section-head">
                  <h2 id="decisions-h">Price decisions get checked again</h2>
                  <p>When a choice rests on live prices, your agent reads them from the vendors’ own pages through Context.dev. The decision is kept as a small file in your repository, and a later agent session re-checks it.</p>
                </div>
                {/* Limits are printed only when this deployment has them switched on. */}
                <dl className="stats" data-moment="counter-rolls">
                  <div><dt className="t-small muted">command connects your agent</dt><dd className="t-stat">1</dd></div>
                  <div><dt className="t-small muted">examples open without an account</dt><dd className="t-stat">{examples.length}</dd></div>
                  {userDailyCap() > 0 && <div><dt className="t-small muted">web requests a day for each person</dt><dd className="t-stat">{userDailyCap()}</dd></div>}
                  {userPlaygroundCap() > 0 && <div><dt className="t-small muted">playgrounds for each person</dt><dd className="t-stat">{userPlaygroundCap()}</dd></div>}
                </dl>
              </div>
              <div className="span-6 start-7 shot shot--file" role="img" aria-label="A decision file in a repository, and the question a later agent session asks about it">
                <p className="shot__path">{recordPath(priced)}</p>
                <p># Decision: {titleOf(playgrounds[priced] ?? ({ domain: DOMAIN } as AnyPlayground), priced)}</p>
                <p className="muted">- Playground: /p/{priced}<br />- Playground id: `{priced}`</p>
                <p className="muted">## For an agent that reads this file</p>
                <p className="shot__ask"><b>&gt;</b> is my saved decision still right?</p>
                <p className="muted">clay · recheck_playground</p>
                <p className="shot__answer">STILL HOLDS: every page was read again and no fact changed since the person settled.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer closing" id="connect" aria-labelledby="close-h">
        <div className="wrap">
          <div className="closing__cta close--word">
            <div className="section-head--split">
              <div><h2 id="close-h">Connect your agent with one command</h2><p className="t-lead">Your agent runs on your own model subscription. Clay needs no AI key. {me.kind === "visitor" ? "Sign up, get your agent key, and add Clay." : "Get your agent key and add Clay."}</p></div>
              <a className="btn btn--primary" href="/connect">Connect your agent<Arrow /></a>
            </div>
            <p className="close__word" aria-hidden="true">Clay</p>
          </div>
          <div className="closing__links">
            <div className="grid">
              <div className="span-4 stack-4">
                <a className="nav__logo" href="#top"><span className="mark" data-mark="stack" aria-hidden="true" />Clay</a>
                <p className="footer__lede">Playgrounds that your own coding agent builds, and that you shape by hand.</p>
              </div>
              <div className="span-2 start-7 footer__col"><h3>Clay</h3><ul><li><a href="#examples">Examples</a></li><li><a href="#steps">Steps</a></li><li><a href="#decisions">Decisions</a></li></ul></div>
              <div className="span-2 footer__col"><h3>Agents</h3><ul><li><a href="/connect">Connect</a></li><li><a href="/clay-recheck.yml">Re-check workflow</a></li></ul></div>
              <div className="span-2 footer__col"><h3>Web data</h3><ul><li><a href="https://context.dev">Context.dev</a></li></ul></div>
            </div>
            <div className="footer__legal">
              <span>&copy; 2026 Clay &nbsp; Built at Junction 2026 for the Context.dev challenge. Web data is read through Context.dev.</span>
              <div className="socials" />
              <a className="credits" href="/credits.txt">Typefaces: Gabarito, Figtree and DM Mono, SIL Open Font Licence</a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}

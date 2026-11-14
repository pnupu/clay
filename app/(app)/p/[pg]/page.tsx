import { createHash } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import Kit from "@/app/kit";
import Playground from "@/app/playground";
import { viewer } from "@/app/api/respond";
import { agentConnected, canRead, canWrite, EXAMPLE_CLEARED, isExample } from "@/lib/accounts";
import { brandPending } from "@/lib/kit";
import { MarkExample } from "@/app/manage";
import { nonOwnerView, viewVersion } from "@/lib/report";
import { load, workStatus } from "@/lib/store";
import { Hold, SelfUpdate, Started } from "@/app/live";
import { dataStamp, pageRev } from "@/lib/started";
import { webStamp } from "@/lib/web";

export const dynamic = "force-dynamic";

/** The lab if this viewer may open it: an example, their own, or any for the admin. */
async function find(pg: string) {
  const s = await load();
  const p = s.playgrounds[pg];
  const me = await viewer();
  // `now`: the server's clock when the store was read (a started lab shows the age of its last line).
  return { p: p && canRead(me, p, pg) ? p : null, exists: !!p, me, connected: agentConnected(me, s.users), now: Date.now() };
}

export async function generateMetadata({ params }: { params: Promise<{ pg: string }> }) {
  return { title: (await find((await params).pg)).p?.domain.question ?? "Private lab" };
}

export default async function Page({ params }: { params: Promise<{ pg: string }> }) {
  const { pg } = await params;
  const { p, exists, me, connected, now } = await find(pg);
  if (!exists) notFound();
  // A private lab: the same answer whoever owns it, and nothing of its content.
  if (!p)
    return (
      <main className="shell narrow">
        <h1>This lab is private</h1>
        <p>Only the person whose agent built it can open it. {me.kind === "visitor" ? "If that is you, sign in." : "You are signed in with another account."}</p>
        <p className="row wrap">
          {me.kind === "visitor" && <Link className="button primary" href={`/sign-in?redirect_url=/p/${encodeURIComponent(pg)}`}>Sign in</Link>}
          <Link className="button" href="/#examples">Try an example instead</Link>
        </p>
      </main>
    );
  // An account admin's own labs: the operator's (no owner), and those their personal agent key built.
  const builtByViewer = me.kind === "user" ? p.owner === me.userId : me.kind === "admin" && (!p.owner || p.owner === me.userId);
  // Started and not built: the page says what the agent is doing, and becomes the lab when the create lands.
  if (p.started) return <Started id={pg} title={p.domain.question} workingOn={p.started.workingOn} at={p.started.at} now={now} own={builtByViewer} />;
  // The admin marks here, with the version of what this page renders; a person's preview frame is pinned to it.
  const version = me.kind === "admin" ? viewVersion(p) : null;
  const pinned = version && p.owner && !builtByViewer ? version : undefined;
  // The screen is keyed by what it shows, so a revision mounts a new one. Hold keeps the old one while a pointer is down.
  const screen = p.kit ? `${JSON.stringify(p.kit.kit)}|${p.kit.brandData?.fetchedAt ?? ""}|${webStamp(p.kit.web)}|${pinned ?? ""}` : JSON.stringify(p.domain);
  return (
    <>
      {version && <MarkExample id={pg} version={version} example={isExample(p, pg)} featured={p.featured === true} />}
      {canWrite(me, p) && p.exampleCleared && !isExample(p, pg) && <p className="alert" role="status" style={{ maxWidth: 1440, margin: "12px auto 0" }}>{EXAMPLE_CLEARED}</p>}
      {/* The open page shows a revision by the agent with no reload: this asks for the revision, the keys below remount the screen. Only for its owner and the operator: the visitors of an example do not poll (an example changes when the operator marks it again). */}
      {canWrite(me, p) && <SelfUpdate id={pg} rev={pageRev(p)} data={dataStamp(p)} own={builtByViewer} />}
      {/* A preview lab has its own screen. Someone who does not own it starts on the start values (an example) and is not sent what the owner tried or settled. The key remounts the screen when the agent revises the lab. */}
      <Hold stamp={createHash("sha256").update(screen).digest("hex").slice(0, 16)}>{p.kit ? <Kit connected={connected} byTeam={!p.owner} key={screen} id={p.domain.id} version={pinned} title={p.domain.question} state={(canWrite(me, p) && !pinned ? p : nonOwnerView(p)).kit!} canWrite={canWrite(me, p)} builtByViewer={builtByViewer} leftOut={p.leftOut} reading={workStatus(p)?.status === "running" || brandPending(p.kit)} /> : <Playground connected={connected} byTeam={!p.owner} builtByViewer={builtByViewer} key={screen} domain={p.domain} explored={(canWrite(me, p) ? p : nonOwnerView(p)).exploration} canWrite={canWrite(me, p)} admin={me.kind === "admin"} />}</Hold>
    </>
  );
}

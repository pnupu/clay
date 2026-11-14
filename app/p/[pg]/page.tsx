import Link from "next/link";
import { notFound } from "next/navigation";
import Kit from "@/app/kit";
import Playground from "@/app/playground";
import { viewer } from "@/app/api/respond";
import { canRead, canWrite } from "@/lib/accounts";
import { load } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The playground if this viewer may open it: an example, their own, or any for the admin. */
async function find(pg: string) {
  const p = (await load()).playgrounds[pg];
  const me = await viewer();
  return { p: p && canRead(me, p, pg) ? p : null, exists: !!p, me };
}

export async function generateMetadata({ params }: { params: Promise<{ pg: string }> }) {
  return { title: (await find((await params).pg)).p?.domain.question ?? "Private playground" };
}

export default async function Page({ params }: { params: Promise<{ pg: string }> }) {
  const { pg } = await params;
  const { p, exists, me } = await find(pg);
  if (!exists) notFound();
  // A private playground: the same answer whoever owns it, and nothing of its content.
  if (!p)
    return (
      <main className="shell narrow">
        <h1>This playground is private</h1>
        <p>Only the person whose agent built it can open it. {me.kind === "visitor" ? "If that is you, sign in." : "You are signed in with another account."}</p>
        <p className="row wrap">
          {me.kind === "visitor" && <Link className="button primary" href={`/sign-in?redirect_url=/p/${encodeURIComponent(pg)}`}>Sign in</Link>}
          <Link className="button" href="/#examples">Try an example instead</Link>
        </p>
      </main>
    );
  return (
    <>
      {/* A preview playground has its own screen. Someone who does not own it starts on the start values (an example). The key remounts the screen when the agent revises the playground. */}
      {p.kit ? <Kit key={JSON.stringify(p.kit.kit)} id={p.domain.id} title={p.domain.question} state={p.kit} canWrite={canWrite(me, p)} /> : <Playground key={JSON.stringify(p.domain)} domain={p.domain} explored={canWrite(me, p) ? p.exploration : null} canWrite={canWrite(me, p)} admin={me.kind === "admin"} />}
    </>
  );
}

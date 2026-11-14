"use client";

// The open page follows the agent with no reload. Two parts:
// - Started: the page of a lab that is started and not built (lib/started.ts). It shows what the agent is doing
//   and becomes the lab when the create lands.
// - SelfUpdate: beside a built lab. It notices a revision by the agent and shows the new version.
// Both ask the server for the revision only (/api/p/<id>/rev), only while the tab is visible, and let Next.js render the
// page again (router.refresh()), so the screens themselves need no code for it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/** The started page says that the build seems to have stopped when the agent's line has not changed for this long. */
const STARTED_STALE_MS = 15 * 60_000;

type Rev = { rev: string; data: string; now: number; started: { title: string; workingOn: string; at: string } | null };

/**
 * Ask for the revision every `every()` milliseconds while the tab is visible, and at once when it becomes visible again.
 * `on` gets the answer, or null when the lab is gone (deleted, or a start that nobody built). A failed request
 * (offline, a server restart) is skipped: the next one tells.
 */
function usePoll(id: string, every: () => number, on: (r: Rev | null) => void) {
  /** Ask now, outside the rhythm (input after a long pause). */
  const now = useRef(() => {});
  const latest = useRef({ every, on });
  useEffect(() => {
    latest.current = { every, on };
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let asking = false;
    const ask = async () => {
      // One request at a time, and one timer: a request that is under way sets the next one.
      if (stopped || asking) return;
      clearTimeout(timer);
      asking = true;
      if (!document.hidden) {
        try {
          const r = await fetch(`/api/p/${encodeURIComponent(id)}/rev`, { cache: "no-store" });
          if (stopped) return;
          if (r.status === 404) latest.current.on(null);
          else if (r.ok) latest.current.on((await r.json()) as Rev);
        } catch {}
      }
      asking = false;
      if (!stopped) timer = setTimeout(ask, latest.current.every());
    };
    const seen = () => {
      if (!document.hidden) void ask();
    };
    timer = setTimeout(ask, latest.current.every());
    now.current = seen;
    document.addEventListener("visibilitychange", seen);
    return () => {
      stopped = true;
      now.current = () => {};
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", seen);
    };
  }, [id]);
  return now;
}

/** "12 seconds ago", in the words of a person. Whole units, so the line does not flicker. */
function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? "1 minute ago" : `${m} minutes ago`;
  const h = Math.floor(m / 60);
  return h === 1 ? "1 hour ago" : `${h} hours ago`;
}

/**
 * The page of a started lab. `title` and `workingOn` are text from an agent: React renders them as text.
 * `now` is the server's clock at render; every answer brings it again, so "ago" and the 15-minute rule do not depend on
 * the clock of this device.
 */
export function Started({ id, title, workingOn, at, now, own }: { id: string; title: string; workingOn: string; at: string; now: number; /** The viewer's own agent started it (not the operator looking at a person's). */ own: boolean }) {
  const router = useRouter();
  const [line, setLine] = useState({ title, workingOn, at });
  // The server's clock: its time at the last answer, and this device's time then.
  const [clock, setClock] = useState({ server: now, local: null as number | null });
  const [tick, setTick] = useState(0);
  const [gone, setGone] = useState(false);
  const asked = useRef(0);
  // One "not found" can be a sign-in session that is being renewed: the lab is gone after two in a row.
  const misses = useRef(0);
  usePoll(id, () => 2500, (r) => {
    if (!r) return void (++misses.current >= 2 && setGone(true));
    misses.current = 0;
    setGone(false);
    setClock({ server: r.now, local: Date.now() });
    if (r.started) return setLine(r.started);
    // Built: the server now renders the lab in place of this screen. Asked again only when an answer got lost.
    if (Date.now() - asked.current < 8000) return;
    asked.current = Date.now();
    router.refresh();
  });
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const age = clock.server + (clock.local == null ? 0 : Math.max(0, tick - clock.local)) - Date.parse(line.at);
  const stopped = gone || !(age < STARTED_STALE_MS);
  const whose = own ? "your agent" : "its person's agent";
  return (
    <main className="shell narrow started" data-started={stopped ? "stopped" : "building"}>
      <div>
        <p className="eyebrow"><Link href="/">Sorvi</Link> · started, not built yet</p>
        <h1>{line.title}</h1>
      </div>
      {stopped ? (
        <section className="pane started__pane" role="status">
          <h2>The build seems to have stopped</h2>
          <p>{gone ? "This page can no longer read the lab. It was removed (a start that nobody builds is removed after a day), or you are signed out." : <>Nothing has changed for {ago(age).replace(" ago", "")}. The last thing {whose} said: <span className="started__line">{line.workingOn}</span></>}</p>
          <p className="muted">{gone ? `Sign in again, or ask ${whose} to build it again.` : `Ask ${whose} to build it again. This page still becomes the lab by itself if the build arrives.`}</p>
        </section>
      ) : (
        <section className="pane started__pane" role="status" aria-live="polite">
          <h2 className="live"><i aria-hidden="true" />{own ? "Your agent is building this lab" : "Its person's agent is building this lab"}</h2>
          <p className="started__line">{line.workingOn}</p>
          <p className="small muted started__time">Updated {ago(age)}</p>
        </section>
      )}
      {!stopped && <p className="muted">This page becomes the lab by itself. You do not need to reload.</p>}
    </main>
  );
}

/**
 * Around the screen of a built lab. A new version of the screen (another `stamp`: the page keys the screen by
 * it) is not shown while a pointer is down in this document; it is shown when the pointer is released. So a drag is
 * never cut by a remount, whichever request brought the new version and whenever its answer arrives (also one that was
 * sent just before the press). The same version with new props passes straight through.
 */
export function Hold({ stamp, children }: { stamp: string; children: ReactNode }) {
  const [down, setDown] = useState(false);
  const [shown, setShown] = useState({ stamp, children });
  const keep = down && shown.stamp !== stamp;
  if (!keep && (shown.stamp !== stamp || shown.children !== children)) setShown({ stamp, children });
  useEffect(() => {
    let late: ReturnType<typeof setTimeout> | undefined;
    const press = () => {
      clearTimeout(late);
      setDown(true);
    };
    // After the control has taken its last value.
    const release = () => {
      clearTimeout(late);
      late = setTimeout(() => setDown(false), 50);
    };
    // A move says whether a button or a finger is still down. It ends a press that was released outside this document
    // (outside the window, or over the preview frame: no pointerup here), and keeps the hold when a second finger lifts.
    const move = (e: PointerEvent) => {
      if (e.buttons) press();
      else setDown(false);
    };
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("pointermove", move, true);
    return () => {
      clearTimeout(late);
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("pointermove", move, true);
    };
  }, []);
  return <>{keep ? shown.children : children}</>;
}

/** After this long with no pointer or key on the page, the revision is asked for less often. */
const IDLE_MS = 10 * 60_000;

/**
 * Beside a built lab: asks for the revision every 4 seconds (every 30 after 10 minutes with no input) and, when
 * the agent has revised the lab (or web data of a preview has arrived), lets the server render the page again. The screens are keyed by their spec
 * (app/p/[pg]/page.tsx), so the new version mounts, and the person's control values come with it (lib/carry.ts). A drag
 * is not interrupted: Hold (above) keeps the shown screen while a pointer is down. This component also does not ask for
 * the new version during a press, so nothing is fetched that cannot be shown. `rev` is the revision that the page was
 * rendered with.
 * lean: only input in this document is seen. A drag inside the sandboxed preview frame (a map that is panned) does not
 * hold the new version back, and does not count as input for the slower poll. If that matters, let the frame report
 * input over its message bridge.
 */
export function SelfUpdate({ id, rev, data, own }: { id: string; rev: string; /** The stamp of the web data the page was rendered with: a read that arrives (a re-check) renders it again, without the notice. */ data: string; own: boolean }) {
  const router = useRouter();
  // The notice: shown when the page has been rendered again with another revision.
  const [seen, setSeen] = useState(rev);
  const [notice, setNotice] = useState<string | null>(null);
  if (seen !== rev) {
    setSeen(rev);
    setNotice(rev);
  }
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const shown = useRef({ rev, data });
  useEffect(() => {
    shown.current = { rev, data };
  }, [rev, data]);
  const down = useRef(false);
  const waiting = useRef(false);
  /** The version the page was last asked to render, and when: the same one is asked for again only when an answer got lost. */
  const asked = useRef({ what: "", at: 0 });
  const wanted = useRef("");
  const input = useRef<number | null>(null);
  const apply = useRef(() => {});
  useEffect(() => {
    apply.current = () => {
      waiting.current = false;
      if (asked.current.what === wanted.current && Date.now() - asked.current.at < 8000) return;
      asked.current = { what: wanted.current, at: Date.now() };
      router.refresh();
    };
  }, [router]);
  /** No input for IDLE_MS. The clock starts when the page is mounted (the effect below); before that nothing is idle. */
  const idle = () => input.current != null && Date.now() - input.current > IDLE_MS;
  const poke = usePoll(id, () => (idle() ? 30_000 : 4000), (r) => {
    if (!r || (r.rev === shown.current.rev && r.data === shown.current.data)) return;
    wanted.current = `${r.rev}|${r.data}`;
    if (down.current) waiting.current = true;
    else apply.current();
  });
  useEffect(() => {
    input.current = Date.now();
    // Input after a long pause: the next slow poll may be half a minute away, so ask at once.
    const woke = () => {
      const was = input.current != null && Date.now() - input.current > IDLE_MS;
      input.current = Date.now();
      if (was) poke.current();
    };
    const press = () => {
      down.current = true;
      woke();
    };
    const release = () => {
      down.current = false;
      // After the control has taken its last value.
      if (waiting.current) setTimeout(() => !down.current && waiting.current && apply.current(), 50);
    };
    const key = woke;
    // A press that ended outside this document (outside the window, or over the preview frame) sends no pointerup here.
    const move = (e: PointerEvent) => void (down.current && !e.buttons && release());
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [poke]);
  return notice ? <p className="updated" role="status" key={notice}>{own ? "Updated by your agent. Your values are kept." : "This lab was updated. Your values are kept."}</p> : null;
}

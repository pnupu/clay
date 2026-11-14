import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import Account from "@/app/account";
import { clerkOn, viewer } from "@/app/api/respond";
import { headerState } from "@/app/example-groups";
import { CLERK_TEXT } from "@/app/clerk-text";
import { ROOT_CSS } from "@/app/tokens";
import KitScripts from "./kit-scripts";
import "@/app/clay.css";
import "./site.css";

// The website pages (the landing page and /connect) are built with Taste Skill 2.5.1 (MIT), whose kit is served as plain
// files from public/assets. They have a root layout of their own, so a move between them and the app pages (app/(app)) is a
// full page load and the kit's stylesheets never reach a playground. Every link here is therefore a plain <a>.
//
// type: software (site-kind software)
// deal: hero triptych, nav nav-mega, close close-word, footer footer-columns, rhythm surface-pairs, buttons tonal,
//       mark stack, ground sand, radius sharp, palette stone-blueprint, type gabarito (Gabarito / Figtree + DM Mono)
// moments: counter-rolls (#decisions). The dealt marquee-row and the close's large word were removed on Ilkka's review.

export const metadata: Metadata = {
  title: "Clay: playgrounds your coding agent builds for you",
  description: "Your own coding agent builds a page where your real component, animation or price choice runs under a few controls. You shape it by hand; the agent carries out what you settle.",
  openGraph: { type: "website", title: "Clay: playgrounds your coding agent builds for you", description: "Your agent builds the real thing with a few controls. You shape it by hand. It carries out what you settle.", images: ["/share.jpg"] },
  twitter: { card: "summary_large_image" },
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }] },
  other: { "site-kind": "software", "page-type": "software" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#dfdedb" };

const KIT_CSS = ["system.css", "ui/cards.css", "motion/motion.css", "backgrounds/backgrounds.css", "layout/layout.css", "icons/icon.css", "moments/counter-rolls/moment.css"];

async function Header() {
  const me = await viewer();
  const { groups, connected } = await headerState(me);
  return (
    <header className="nav">
      <div className="wrap nav__bar">
        <a className="skip-link" href="#top">Skip to content</a>
        <a className="nav__logo" href="/"><span className="mark" data-mark="stack" aria-hidden="true" />Clay</a>
        <nav className="nav__links" aria-label="Main">
          <div className="nav__item">
            <a className="nav__link" href="/#examples">Examples <svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></a>
            {groups.length > 0 && (
              <div className="nav__menu">
                <div className="wrap grid">
                  {groups.map((g) => (
                    <div className="menu-col span-4" key={g.label}>
                      <p className="t-label">{g.label}</p>
                      {g.items.slice(0, 5).map((x) => <a href={`/p/${x.id}`} key={x.id}>{x.title}<span>{x.line}</span></a>)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="nav__item"><a className="nav__link" href="/#steps">Steps</a></div>
          <div className="nav__item"><a className="nav__link" href="/#decisions">Decisions</a></div>
          {me.kind !== "visitor" && <div className="nav__item"><a className="nav__link" href="/#yours">Playgrounds</a></div>}
        </nav>
        <div className="nav__actions">
          {me.kind === "user" ? <Account /> : me.kind === "admin" ? <span className="who" aria-label="Operator session">Operator</span> : me.kind === "visitor" && clerkOn() ? <a className="nav__link" href="/sign-in">Sign in</a> : null}
          {connected ? <a className="nav__link" href="/connect">Agent setup</a> : <a className="btn btn--primary" href="/connect">Connect your agent</a>}
        </div>
        <button className="nav__toggle" type="button" aria-expanded="false" aria-label="Menu">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 5h14M2 13h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </div>
    </header>
  );
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const body = (
    <html lang="en" data-type="software" data-radius="sharp" data-ground="sand" data-buttons="tonal" data-motion="" suppressHydrationWarning>
      <head>
        {KIT_CSS.map((f) => <link rel="stylesheet" href={`/assets/${f}`} key={f} />)}
        {/* After the kit's links: layout.css resets --ly-scale. */}
        <style dangerouslySetInnerHTML={{ __html: ROOT_CSS }} />
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('m-enter');setTimeout(()=>document.documentElement.classList.add('m-enter-done'),700);document.documentElement.classList.add('mo-js');setTimeout(()=>document.documentElement.classList.add('mo-safe'),2500)" }} />
        <script src="/assets/backgrounds/backgrounds.js" />
        <link rel="modulepreload" href="/assets/moments/moments.js" />
        <link rel="modulepreload" href="/assets/moments/lib.js" />
      </head>
      <body>
        <Header />
        {children}
        <KitScripts />
      </body>
    </html>
  );
  return clerkOn() ? <ClerkProvider localization={CLERK_TEXT} signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/connect" afterSignOutUrl="/">{body}</ClerkProvider> : body;
}

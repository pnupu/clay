import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ClerkProvider } from "@clerk/nextjs";
import Account from "@/app/account";
import { clerkOn, viewer } from "@/app/api/respond";
import { exampleGroups } from "@/app/example-groups";
import { ROOT_CSS } from "@/app/tokens";
import "@/app/clay.css";
import "@/app/app.css";

// The app pages: a playground, sign-in and the short pages. The website pages (the landing page, /connect) have a root
// layout of their own (app/(site)/layout.tsx); a move between the two is a full page load. Both read the same tokens.
export const metadata: Metadata = {
  title: "Clay",
  description: "Your agent builds a page of controls for a decision; you try values by hand until you know what you want; the agent reads back what you settled on.",
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }] },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#dfdedb" };

async function Header() {
  const me = await viewer();
  const groups = await exampleGroups();
  return (
    <header className="bar">
      <div className="bar__in">
        <Link href="/" className="bar__logo"><span className="bar__mark" aria-hidden="true" />Clay</Link>
        <nav className="bar__links" aria-label="Main">
          {/* The same list as the website's Examples panel: the fastest way from one example to the next. */}
          {groups.length > 0 ? (
            <details className="bar__menu">
              <summary>Examples <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></summary>
              <div className="bar__panel">
                {groups.map((g) => (
                  <div key={g.label}>
                    <p>{g.label}</p>
                    {g.items.slice(0, 5).map((x) => <a href={`/p/${x.id}`} key={x.id}>{x.title}<span>{x.line}</span></a>)}
                  </div>
                ))}
              </div>
            </details>
          ) : (
            <Link href="/#examples">Examples</Link>
          )}
          {me.kind !== "visitor" && <Link href="/#yours"><span className="wide-only">Your playgrounds</span><span className="narrow-only">Yours</span></Link>}
        </nav>
        <div className="bar__actions">
          {me.kind === "user" ? <Account /> : me.kind === "visitor" && clerkOn() ? <Link href="/sign-in" className="bar__word">Sign in</Link> : null}
          <Link href="/connect" className="button primary"><span className="wide-only">Connect your agent</span><span className="narrow-only">Connect</span></Link>
        </div>
      </div>
    </header>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const body = (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: ROOT_CSS }} />
        {/* Inside another page's frame the header would show twice. */}
        <script dangerouslySetInnerHTML={{ __html: "if(window.self!==window.top)document.documentElement.classList.add('embedded')" }} />
      </head>
      <body className="clay">
        <Header />
        {children}
      </body>
    </html>
  );
  // Without Clerk keys the app runs as before accounts existed: the owner key only.
  return clerkOn() ? <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/connect" afterSignOutUrl="/">{body}</ClerkProvider> : body;
}

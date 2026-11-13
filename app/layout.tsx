import type { Metadata } from "next";
import Link from "next/link";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { clerkOn, viewer } from "@/app/api/respond";
import "./globals.css";
import "./site.css";

export const metadata: Metadata = {
  title: "Clay",
  description: "Your agent builds a page of controls for a decision; you try values by hand until you know what you want; the agent reads back what you settled on.",
};

async function Header() {
  const me = await viewer();
  return (
    <header className="site">
      <Link href="/" className="brand">Clay</Link>
      <nav>
        <Link href="/#examples">Examples</Link>
        {me.kind !== "visitor" && <Link href="/#yours">Your playgrounds</Link>}
        <Link href="/connect">Connect your agent</Link>
        {me.kind === "user" ? <UserButton /> : me.kind === "visitor" && clerkOn() ? <Link href="/sign-in" className="button">Sign in</Link> : null}
      </nav>
    </header>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const body = (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inside the landing page's "Try it here" frame the site header would show twice. */}
        <script dangerouslySetInnerHTML={{ __html: "if(window.self!==window.top)document.documentElement.classList.add('embedded')" }} />
      </head>
      <body>
        <Header />
        {children}
      </body>
    </html>
  );
  // Without Clerk keys the app runs as before accounts existed: the owner key only.
  return clerkOn() ? <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/connect" afterSignOutUrl="/">{body}</ClerkProvider> : body;
}

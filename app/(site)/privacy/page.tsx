import { clerkOn } from "@/app/api/respond";

export const metadata = { title: "Privacy and security · Clay", description: "What Clay stores, who else receives data, and what a preview built by an agent can and cannot do." };

// Every sentence here states what the code does (lib/store.ts, lib/accounts.ts, lib/contextdev.ts, lib/frame.ts,
// app/kit.tsx) or what the README says of the deployment. Change the code and this page together. What depends on the
// deployment is read from it: whether sign-in is on, and whether its key is a development one (pk_test_).
export default function Privacy() {
  const signIn = clerkOn();
  const development = signIn && (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "").startsWith("pk_test_");
  return (
    <>
      <main id="top">
        <section className="section doc" aria-labelledby="privacy-h">
          <div className="wrap">
            <div className="grid grid--top">
              <div className="span-4 doc__head">
                <h1 id="privacy-h" className="t-h2">Privacy and security</h1>
                <p className="t-lead">Clay is a hackathon project, built at Junction 2026.{development ? " Sign-in runs on the sign-in provider’s development instance." : signIn ? "" : " This deployment has no sign-in."} This page says what Clay stores and what a preview can do, as the code stands today.</p>
              </div>
              <div className="span-8 start-5 legal">
                <section>
                  <h2>If you only try the examples</h2>
                  <p>You need no account. What you move on an example runs in your browser, and Clay saves none of it.</p>
                </section>
                <section>
                  <h2>What Clay stores for an account</h2>
                  <ul>
                    <li><b>Your sign-in id</b> from Clerk, the sign-in provider. Clay itself stores no email address and no name.</li>
                    <li><b>A hash of your agent key</b> (SHA-256) and the time it was created. The key is shown to you once and is not stored.</li>
                    <li><b>Your request count of the day:</b> the web reads that your agent or your page caused.</li>
                    <li><b>Your playgrounds:</b> what your agent sent to build them (controls, preview code, outputs, the vendors and pages to read), the facts read from those pages with their quotes and read times, the values you settled and the range you tried, a saved decision with its history, and whether the preview ran in your browser, with its error text if it failed.</li>
                  </ul>
                  <p>All of it is one private document in Vercel’s Blob storage. Your playgrounds are private: only you and the operator can open them. A playground that the operator marks as an example is open to everyone.</p>
                  <p>Clay’s own code sets no analytics or advertising cookie. An address that sends 20 wrong keys in 10 minutes is refused for the rest of those 10 minutes; that count is kept in memory only.</p>
                </section>
                <section>
                  <h2>Who else receives data</h2>
                  <ul>
                    {signIn && <li><b>Clerk</b> runs sign-in and holds your sign-in data. On the sign-in pages Cloudflare’s bot check runs for Clerk.</li>}
                    <li><b>Context.dev</b> reads the web for Clay. It receives the addresses and domains to read, the search words for a pricing page, and the description of what to extract. It does not receive your account id or the values you set.</li>
                    <li><b>Vercel</b> hosts the site and the stored document.</li>
                    <li><b>jsDelivr:</b> when a preview uses Tailwind, your browser loads that file from jsDelivr.</li>
                    <li><b>A brand’s logo hosts:</b> when a preview shows a brand’s logo, your browser loads it from that brand’s hosts.</li>
                  </ul>
                </section>
                <section id="previews">
                  <h2>What a preview can and cannot do</h2>
                  <p>A preview is code that a playground’s author wrote with their agent. It runs in a sandbox: it cannot read the page around it, your Clay account or session, or other sites’ data, and it cannot open windows or submit forms.</p>
                  <p>It is not sealed from the network. In some browsers its code can make outgoing requests, so the values you set and the data shown in the preview could be sent to a server its author chose, with your IP address. A brand’s logo hosts can also receive them in image addresses.</p>
                  <p>A preview with a map shows map tiles of OpenStreetMap. Clay fetches them from tile.openstreetmap.org for you: Clay’s server sees the area you look at, and the tile server sees Clay’s server, not your internet address.</p>
                  <p>Another person’s preview reaches you only when the operator has marked it as an example. A preview can show any text inside its box: never type a secret into one.</p>
                </section>
                <section>
                  <h2>Removing your data</h2>
                  <ul>
                    <li><b>A playground:</b> sign in and press Delete beside it on the home page. A playground with running webhook monitors can be deleted after the operator stops them.</li>
                    <li><b>Your agent key:</b> press Revoke key on the Connect page.</li>
                  </ul>
                  <p>Clay has no contact address yet. For anything else, ask the Clay team in person at Junction 2026.</p>
                </section>
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

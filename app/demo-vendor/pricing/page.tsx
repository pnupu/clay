import { DEMO_DEFAULT } from "@/lib/demo";
import { load } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Northwind Auth pricing (demo page)" };

/** A mock vendor pricing page. It is fictional and exists so a price change can be made live during a demo. */
export default function DemoPricing() {
  const model = load().demoPage ?? DEMO_DEFAULT;
  return (
    <main className="demo-page">
      <p className="demo-banner">Demo page. Northwind Auth is not a real vendor. This page is served by the Clay app.</p>
      <h1>Northwind Auth pricing</h1>
      {model.plans?.map((p) => (
        <section key={p.name}>
          <h2>{p.name}</h2>
          <p className="demo-price">{p.price_quote}</p>
          <ul>
            {p.meters?.map((m) => <li key={m.metric}>{m.quote}</li>)}
            {p.features?.map((f) => <li key={f.feature}>{f.quote}</li>)}
          </ul>
        </section>
      ))}
      <script type="application/json" id="pricing-model" dangerouslySetInnerHTML={{ __html: JSON.stringify(model).replace(/</g, "\\u003c") }} />
    </main>
  );
}

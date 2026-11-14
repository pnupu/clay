import Link from "next/link";

export const metadata = { title: "Not found · Sorvi" };

/** Any unknown address, and a lab that does not exist or was deleted (app/p/[pg]/page.tsx calls notFound()). */
export default function NotFound() {
  return (
    <main className="shell narrow">
      <p className="eyebrow">Not found</p>
      <h1>There is nothing at this address</h1>
      <p>The link may be mistyped, or the lab was deleted by its owner.</p>
      <p className="row wrap">
        <Link className="button primary" href="/#examples">Try an example</Link>
        <Link className="button" href="/">Home</Link>
      </p>
    </main>
  );
}

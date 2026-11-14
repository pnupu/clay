import { notFound } from "next/navigation";

/**
 * Any address that no page has. The website pages and the app pages have root layouts of their own, so the framework has
 * no single layout for an unknown address and would show its default page; this sends it to the app's own "Not found"
 * page (app/(app)/not-found.tsx), with status 404, as before the two layouts existed.
 */
export default function Unknown() {
  notFound();
}

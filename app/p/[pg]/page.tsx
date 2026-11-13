import { notFound } from "next/navigation";
import Playground from "@/app/playground";
import { load } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ pg: string }> }) {
  return { title: load().playgrounds[(await params).pg]?.domain.question ?? "Playground not found" };
}

export default async function Page({ params }: { params: Promise<{ pg: string }> }) {
  const p = load().playgrounds[(await params).pg];
  if (!p) notFound();
  // The key remounts the screen when the agent revises the playground, so the controls match the new domain.
  return <Playground key={JSON.stringify(p.domain)} domain={p.domain} explored={p.exploration} />;
}

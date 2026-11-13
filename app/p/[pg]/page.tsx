import { notFound } from "next/navigation";
import Kit from "@/app/kit";
import Playground from "@/app/playground";
import { load } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ pg: string }> }) {
  return { title: (await load()).playgrounds[(await params).pg]?.domain.question ?? "Playground not found" };
}

export default async function Page({ params }: { params: Promise<{ pg: string }> }) {
  const p = (await load()).playgrounds[(await params).pg];
  if (!p) notFound();
  // A preview playground has its own screen. The key remounts it when the agent revises the kit.
  if (p.kit) return <Kit key={JSON.stringify(p.kit.kit)} id={p.domain.id} title={p.domain.question} state={p.kit} />;
  // The key remounts the screen when the agent revises the playground, so the controls match the new domain.
  return <Playground key={JSON.stringify(p.domain)} domain={p.domain} explored={p.exploration} />;
}

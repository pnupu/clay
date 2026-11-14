"use client";

import { useMemo, useState } from "react";
import type { MetricDef, PricingModel } from "@/lib/domain";
import { crossovers, rank } from "@/lib/pricing";
import { useFlip } from "@/app/flip";
import { toPos, toValue } from "@/app/scale";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const num = (n: number) => n.toLocaleString("en-US");
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The landing page's hero when the featured example is a price decision: its real ranking, small. One slider (the first
 * metric that the vendors' pages price) moves the monthly cost of every vendor; the bars grow and shrink, and the rows
 * change places where the order flips. The prices are the example's stored ones, as read from the vendors' own pages,
 * and the costs come from the same functions as the playground's own page (lib/pricing.ts). The server renders it at
 * the start value, so it shows before any script.
 */
export default function HeroRanking({ id, question, metric, usage, models, names, readAt, byTeam }: { id: string; question: string; metric: MetricDef; usage: Record<string, number>; models: Record<string, PricingModel | null>; names: Record<string, string>; readAt: string | null; byTeam: boolean }) {
  // The slider's own position (0 to 1000) is the state: the value is read from it. A value rounded to two digits does
  // not always map back to the position it came from, and a slider tied to the value could then not be moved by a key.
  const [pos, setPos] = useState(() => Math.round(toPos(metric, usage[metric.id] ?? metric.initial)));
  const [touched, setTouched] = useState(false);
  const value = touched ? toValue(metric, pos) : (usage[metric.id] ?? metric.initial);
  const ranking = useMemo(() => rank(models, { usage: { ...usage, [metric.id]: value }, required: [] }), [models, usage, metric.id, value]);
  // Where the order of the ranking changes along the slider (the same slider steps a person can reach), and where the
  // cheapest vendor changes (the price page's own function).
  const cheapestFlips = useMemo(() => crossovers(models, { usage, required: [] }, metric.id, metric.min, metric.max), [models, usage, metric]);
  const flips = useMemo(() => {
    const orderAt = (x: number) => rank(models, { usage: { ...usage, [metric.id]: x }, required: [] }).ranked.map((v) => v.id);
    const out: { at: number; up: string; down: string }[] = [];
    let before = orderAt(toValue(metric, 0));
    for (let pos = 4; pos <= 1000; pos += 4) {
      const at = toValue(metric, pos);
      const now = orderAt(at);
      const i = now.findIndex((id, k) => id !== before[k]);
      // The first place that differs: the vendor now there passed the one that was there. Only when the same vendors
      // are ranked on both sides: a vendor that left or entered the ranking (no plan fits, a price unknown) passed nobody.
      if (i >= 0 && before[i] && now.length === before.length && now.every((id) => before.includes(id))) out.push({ at, up: now[i], down: before[i] });
      before = now;
    }
    return out;
  }, [models, usage, metric]);
  const list = useFlip<HTMLOListElement>(ranking.ranked.map((v) => v.id).join(" "));
  const first = ranking.ranked[0];
  const next = flips.find((c) => c.at > value);
  const widest = Math.max(1, ...ranking.ranked.map((v) => v.best!.cost));
  const becomesCheapest = (at: number) => cheapestFlips.some((c) => Math.abs(c.at - at) <= at * 0.03);
  const unit = lower(metric.label);
  return (
    <div className="rank2" data-price-hero={id}>
      <p className="rank2__label">{byTeam ? "An example by the Clay team" : "An example"} · prices read from the web by Context.dev</p>
      <p className="rank2__question">{question}</p>
      <p className="rank2__answer" aria-live="polite">
        {first ? <>At {num(value)} {unit} the cheapest is <b>{names[first.id] ?? first.id}</b>, {money(first.best!.cost)} a month.</> : <>At {num(value)} {unit} no vendor can be ranked.</>}
      </p>
      <div className="rank2__control">
        <label htmlFor={`hero-${metric.id}`}>{metric.label}</label>
        <output htmlFor={`hero-${metric.id}`}>{num(value)}</output>
        <div className="rank2__track">
          <input id={`hero-${metric.id}`} type="range" min={0} max={1000} value={pos} aria-valuetext={`${num(value)} ${metric.unit}`} onChange={(e) => { setPos(Number(e.target.value)); setTouched(true); }} />
          {/* A mark on the track at each value where the order changes. */}
          {flips.map((c) => <i key={c.at} style={{ left: `${toPos(metric, c.at) / 10}%` }} title={`The order changes at about ${num(c.at)} ${metric.unit}`} />)}
        </div>
        <p className="rank2__flip">
          {flips.length === 0
            ? `The order stays the same from ${num(metric.min)} to ${num(metric.max)} ${metric.unit}.`
            : next
              ? `The order changes at about ${num(next.at)} ${metric.unit}: ${names[next.up] ?? next.up} ${becomesCheapest(next.at) ? "becomes the cheapest" : `becomes cheaper than ${names[next.down] ?? next.down}`}.`
              : `Below about ${num(flips[flips.length - 1].at)} ${metric.unit} the order is another: ${names[flips[flips.length - 1].down] ?? flips[flips.length - 1].down} is cheaper than ${names[flips[flips.length - 1].up] ?? flips[flips.length - 1].up} there.`}
        </p>
      </div>
      <ol className="rank2__rows" ref={list}>
        {ranking.ranked.map((v, i) => (
          <li key={v.id} data-flip={v.id} data-cheapest={i === 0 || undefined}>
            <span className="rank2__name">{names[v.id] ?? v.id}</span>
            <span className="rank2__bar"><i style={{ width: `${Math.max(1.5, Math.min(100, (v.best!.cost / widest) * 100))}%` }} /></span>
            <span className="rank2__cost">{money(v.best!.cost)}<small> / month</small></span>
          </li>
        ))}
      </ol>
      {ranking.unranked.length > 0 && <p className="rank2__note">Not ranked at these numbers: {ranking.unranked.map((v) => names[v.id] ?? v.id).join(", ")}. A price on the page is not stated, or no plan fits.</p>}
      <p className="rank2__note">
        Read from the vendors’ own pricing pages through Context.dev{readAt ? `, ${new Date(readAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })} ${readAt.slice(11, 16)} UTC` : ""}. <a href={`/p/${id}`}>Open this playground</a>
      </p>
    </div>
  );
}

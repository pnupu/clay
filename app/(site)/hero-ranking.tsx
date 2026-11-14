"use client";

import { useMemo, useState } from "react";
import type { MetricDef, PricingModel } from "@/lib/domain";
import { crossovers, rank } from "@/lib/pricing";
import { changesAt, sayMetric, sayRange } from "@/lib/quantity";
import { useFlip } from "@/app/flip";
import { toPos, toValue } from "@/app/scale";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const num = (n: number) => n.toLocaleString("en-US");

/**
 * The landing page's hero when the featured example is a price decision: its real ranking, small. One slider (the metric
 * the page chose: the first along which the cheapest vendor changes, app/(site)/page.tsx) moves the monthly cost of every vendor; the bars grow and shrink, and the rows
 * change places where the order flips. The prices are the example's stored ones, as read from the vendors' own pages,
 * and the costs come from the same functions as the lab's own page (lib/pricing.ts). The server renders it at
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
  const cheapestFlips = useMemo(() => crossovers(models, { usage, required: [] }, metric.id, metric.min, metric.max).filter((c) => c.from && c.to), [models, usage, metric]);
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
      // A change of the first place is not counted here: crossovers finds those, at their exact value.
      if (i > 0 && before[i] && now.length === before.length && now.every((id) => before.includes(id))) out.push({ at, up: now[i], down: before[i] });
      before = now;
    }
    return out;
  }, [models, usage, metric]);
  const list = useFlip<HTMLOListElement>(ranking.ranked.map((v) => v.id).join(" "));
  const first = ranking.ranked[0];
  const next = flips.find((c) => c.at > value);
  const widest = Math.max(1, ...ranking.ranked.map((v) => v.best!.cost));
  // One line under the slider: first where the cheapest vendor changes (ahead of the value, else behind it), and only
  // when it never changes, where two other vendors change places.
  const name = (id: string | null) => (id ? (names[id] ?? id) : "no vendor");
  const leadAhead = cheapestFlips.find((c) => c.at > value);
  const behind = cheapestFlips.filter((c) => c.at <= value);
  const leadBehind = behind[behind.length - 1];
  const before = behind[behind.length - 2];
  // Every value of the metric is said by lib/quantity.ts, as on the price page: "30 GB of database storage", "about 360
  // million input tokens". A value that was found (a change of place) is said to three figures, with "about" when cut.
  const vendors = Object.values(names);
  const at = (n: number) => sayMetric(metric, n, { approx: true, names: vendors });
  const flipLine = leadAhead
    ? `${changesAt(metric, leadAhead.at, vendors)}: ${name(leadAhead.to)} takes over from ${name(leadAhead.from)}.`
    : leadBehind
      ? (before ? `From ${sayRange(metric, before.at, leadBehind.at, { approx: true, names: vendors })} the cheapest is ${name(leadBehind.from)}.` : `Below ${at(leadBehind.at)} the cheapest is ${name(leadBehind.from)}.`)
      : flips.length === 0
        ? `The order stays the same from ${sayRange(metric, metric.min, metric.max, { names: vendors })}.`
        : next
          ? `The order changes at ${at(next.at)}: ${name(next.up)} becomes cheaper than ${name(next.down)}.`
          : `Below ${at(flips[flips.length - 1].at)} the order is another: ${name(flips[flips.length - 1].down)} is cheaper than ${name(flips[flips.length - 1].up)} there.`;
  const here = sayMetric(metric, value, { names: vendors });
  return (
    <div className="rank2" data-price-hero={id}>
      <p className="rank2__label">{byTeam ? "An example by the Sorvi team" : "An example"} · prices read from the web by Context.dev</p>
      <p className="rank2__question">{question}</p>
      <p className="rank2__answer" aria-live="polite">
        {first ? <>At {here} the cheapest is <b>{names[first.id] ?? first.id}</b>, {money(first.best!.cost)} a month.</> : <>At {here} no vendor can be ranked.</>}
      </p>
      <div className="rank2__control">
        <label htmlFor={`hero-${metric.id}`}>{metric.label}</label>
        <output htmlFor={`hero-${metric.id}`}>{num(value)}</output>
        <div className="rank2__track">
          <input id={`hero-${metric.id}`} type="range" min={0} max={1000} value={pos} aria-valuetext={here} onChange={(e) => { setPos(Number(e.target.value)); setTouched(true); }} />
          {/* Marks on the track: a strong one where the cheapest vendor changes, a light one where two others change places. */}
          {cheapestFlips.map((c) => <i key={`lead-${c.at}`} data-lead style={{ left: `${toPos(metric, c.at) / 10}%` }} title={changesAt(metric, c.at, vendors)} />)}
          {flips.map((c) => <i key={c.at} style={{ left: `${toPos(metric, c.at) / 10}%` }} title={`The order changes at ${at(c.at)}`} />)}
        </div>
        <p className="rank2__flip">{flipLine}</p>
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
        Read from the vendors’ own pricing pages through Context.dev{readAt ? `, ${new Date(readAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })} ${readAt.slice(11, 16)} UTC` : ""}. <a href={`/p/${id}`}>Open this lab</a>
      </p>
    </div>
  );
}

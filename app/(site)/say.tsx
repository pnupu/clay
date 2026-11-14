"use client";

import { useEffect, useState } from "react";

const REQUESTS = ["the card's snap-back", "which Postgres to pick", "the toast animation", "our signup button", "which GPU to rent"];

/**
 * The hero's sentence, with real requests typed after it. The request has a line of its own, so the hero keeps its
 * size while the text changes. The server renders the first request in full: nothing moves at hydration, and the
 * sentence is whole without script. A person who asked for reduced motion keeps that first request.
 */
export default function Say() {
  const [text, setText] = useState(REQUESTS[0]);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0, n = REQUESTS[0].length, dir = -1, timer = setTimeout(tick, 1800);
    function tick() {
      n += dir;
      setText(REQUESTS[i].slice(0, n));
      if (n === 0) { i = (i + 1) % REQUESTS.length; dir = 1; timer = setTimeout(tick, 350); }
      else if (n === REQUESTS[i].length) { dir = -1; timer = setTimeout(tick, 1800); }
      else timer = setTimeout(tick, dir < 0 ? 28 : 55);
    }
    return () => clearTimeout(timer);
  }, []);
  // The caret blinks while a whole request is held, and is solid while one is typed or deleted.
  return (
    <p className="say">
      build me a playground for <span className="sr-only">…</span>
      <span className={REQUESTS.includes(text) ? "say__what say__what--held" : "say__what"} aria-hidden="true">{text}</span>
    </p>
  );
}

"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Rows that change places glide to their new place instead of jumping (the ranking of a price playground, on the landing
 * page and on its own page). Each child of the list names itself with `data-flip`; after a render in which the order
 * changed, a child that moved starts from where it was and travels to where it is. Nothing else about the layout is
 * touched, rows may have any height, and the server-rendered order is simply the order. With reduced motion the rows
 * change places at once.
 */
export function useFlip<T extends HTMLElement>(order: string) {
  const ref = useRef<T>(null);
  const seen = useRef<{ order: string; tops: Map<string, number> }>({ order, tops: new Map() });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tops = new Map<string, number>();
    const moved = seen.current.order !== order && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const key = child.dataset.flip;
      if (!key) continue;
      // offsetTop is the place in the layout; a transform that is still running does not change it.
      const top = child.offsetTop;
      tops.set(key, top);
      const before = seen.current.tops.get(key);
      if (moved && before != null && before !== top && typeof child.animate === "function") {
        child.animate([{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }], { duration: 420, easing: "cubic-bezier(.2, .8, .2, 1)" });
      }
    }
    seen.current = { order, tops };
  });
  return ref;
}

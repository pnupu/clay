"use client";

import { useEffect } from "react";

const SCRIPTS = ["/assets/system.js", "/assets/motion/motion.js", "/assets/layout/layout.js"];

/**
 * The kit's scripts (nav, hovers, the hero's entrance, the moments), loaded after React has taken over the page: they
 * change the markup (a pause button, the copy of a moving row), and React must not meet those changes while it hydrates.
 */
export default function KitScripts() {
  useEffect(() => {
    for (const src of SCRIPTS) {
      if (document.querySelector(`script[src="${src}"]`)) continue;
      const s = document.createElement("script");
      s.type = "module";
      s.src = src;
      document.body.appendChild(s);
    }
  }, []);
  return null;
}

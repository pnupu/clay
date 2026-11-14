"use client";

import { UserButton } from "@clerk/nextjs";
import { useEffect, useRef } from "react";

/**
 * Clerk's account button with an accessible name. Its avatar image has the alt text "<name>'s logo", which is "'s logo"
 * for a person without a name: the image is marked decorative and the button says what it is.
 */
export default function Account() {
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fix = () => {
      el.querySelectorAll("img").forEach((img) => img.getAttribute("alt") !== "" && img.setAttribute("alt", ""));
      // Only the trigger: the menu items (Manage account, Sign out) keep their own names.
      const trigger = el.querySelector("button");
      if (trigger && trigger.getAttribute("aria-label") !== "Your account") trigger.setAttribute("aria-label", "Your account");
    };
    fix();
    const mo = new MutationObserver(fix);
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["alt", "aria-label"] });
    return () => mo.disconnect();
  }, []);
  return (
    <span ref={box} className="account">
      <UserButton />
    </span>
  );
}

// Held-out requests: written AFTER the product fixes of the "just works" pass were done, and run once. They guard against
// tool texts that were tuned to the wording of evals/requests.ts. Do not use them while fixing; write new ones for a new pass.
import type { Case } from "./requests.ts";

export const HELD_OUT: Case[] = [
  {
    id: "held-price-storage", kind: "price", needsKit: false, expect: "build",
    request: "we keep user uploads in S3, about 2 TB now, and people download maybe 500 GB of it a month. the bill keeps creeping up. is R2 or Backblaze actually cheaper for us?",
    expected: "A playground that compares object storage on stored data and egress, starting at 2 TB and 500 GB, with S3, R2 and Backblaze in it.",
    given: [
      { about: /stor|data|tb|gb/i, value: 2000 },
      { about: /egress|download|transfer|bandwidth/i, value: 500 },
    ],
  },
  {
    id: "held-price-sms", kind: "price", needsKit: false, expect: "build",
    request: "our app texts a login code to people, roughly 20,000 messages a month, almost all in the US. Twilio works but feels pricey. who else should I look at?",
    expected: "A playground that compares SMS APIs on messages per month, starting at 20,000, with Twilio in it.",
    given: [{ about: /sms|message|text|segment/i, value: 20_000 }],
  },
  {
    id: "held-look-alert", kind: "look", needsKit: true, expect: "build", files: "held-look-alert", targetFile: "Alert.tsx",
    request: "the error banner in Alert.tsx screams at people. tone it down, but it should still read as an error",
    expected: "A playground with a live preview of the real alert and controls for its weight, colour strength, border and padding. After settling, Alert.tsx holds the settled classes.",
  },
  {
    id: "held-look-hero", kind: "look", needsKit: true, expect: "build", files: "held-look-hero", targetFile: "Hero.tsx",
    request: "the hero in Hero.tsx looks nothing like the rest of our site, which is basically notion.so. can you bring it in line?",
    expected: "A playground with a live preview of the real hero in the colours read from notion.so, with controls to tune them. After settling, Hero.tsx holds the settled classes.",
  },
  {
    id: "held-feel-tooltip", kind: "feel", needsKit: true, expect: "build", files: "held-feel-tooltip", targetFile: "tooltip.css",
    request: "the tooltips in tooltip.css pop up the instant my mouse crosses the toolbar and it's really distracting. sort out the timing",
    expected: "A playground where the person moves the mouse over real toolbar buttons and tunes the delay and fade of the tooltip. After settling, tooltip.css holds the settled values.",
  },
  {
    id: "held-feel-modal", kind: "feel", needsKit: true, expect: "build", files: "held-feel-modal", targetFile: "modal.js",
    request: "the dialog in modal.js opens with a goofy bounce. I want it calmer, but not dead",
    expected: "A playground where the person opens the real modal and tunes the spring and the start scale. After settling, OPEN in modal.js holds the settled parameters.",
  },
];

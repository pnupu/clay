// The fixed request set that defines "Clay just works". Each request is what a person would type: vague, in their own
// words, with no mention of Clay, playgrounds, controls or tool names. Change a request only with a note in the report,
// because pass rates are compared across runs.

/** A number the person gave. `about` finds the dimension among the playground's controls (id, label and unit). */
export type Given = { about: RegExp; value: number; mentioned?: number[] };

export type Case = {
  id: string;
  kind: "price" | "look" | "feel" | "none" | "return" | "data";
  request: string;
  /** Folder under evals/files/ whose files are copied into the agent's scratch directory. */
  files?: string;
  /** The right outcome, in plain words. For the reader of the report; the checker uses the fields below. */
  expected: string;
  /** Needs the kit (preview, named outputs). Skipped, not failed, on a server without it. */
  needsKit: boolean;
  /** "build": the agent must create a playground. "none": it must not. "return": it works on the prepared playground. */
  expect: "build" | "none" | "return";
  given?: Given[];
  /** Known hard case for the product, shown in the report. */
  note?: string;
  /** For "none" cases: the final answer must match. */
  answer?: RegExp;
  /** For code cases without a playground: the file must change and match. */
  fileMust?: { path: string; match: RegExp };
  /** For code cases with a playground: the file that must take the settled outputs. */
  targetFile?: string;
  /** Kind "data": the playground must stand on facts read live from web pages (data.web), combined with the person's numbers. */
  web?: boolean;
  /** For return visits: tools the agent must call, and what a revise must add. */
  mustCall?: ("read" | "recheck" | "revise")[];
  mustAdd?: RegExp;
};

const M = 1_000_000;

export const CASES: Case[] = [
  // ---- Price decisions: usage-priced products with public pricing pages.
  {
    id: "price-llm", kind: "price", needsKit: false, expect: "build",
    request: "we're adding an AI summary feature to our app. roughly 40 million input tokens and 8 million output tokens a month to start, could be 5x that by spring. which LLM API should we go with? thinking Claude, GPT or Gemini",
    expected: "A playground that compares LLM APIs on input and output tokens, starting at 40M and 8M, with ranges that reach 5 times that.",
    given: [
      { about: /input|prompt/i, value: 40 * M, mentioned: [40 * M, 200 * M] },
      { about: /output|completion/i, value: 8 * M, mentioned: [8 * M, 40 * M] },
    ],
  },
  {
    id: "price-gpu", kind: "price", needsKit: false, expect: "build",
    request: "I need to rent a GPU to fine-tune some models, something like an A100 or H100. probably 200 hours a month, not sure yet. where's it cheapest? runpod, lambda, anyone else worth a look?",
    expected: "A playground that compares GPU rental by the hour, starting at 200 hours a month.",
    given: [{ about: /hour/i, value: 200 }],
  },
  {
    id: "price-email", kind: "price", needsKit: false, expect: "build",
    request: "need to pick an email service for our app. about 30k emails a month now, maybe 200k by the end of next year. which one makes sense?",
    expected: "A playground that compares transactional email services, starting at 30,000 emails a month, with a range that reaches 200,000.",
    given: [{ about: /email|message/i, value: 30_000, mentioned: [30_000, 200_000] }],
  },
  {
    id: "price-hosting", kind: "price", needsKit: false, expect: "build",
    request: "where should I host our Next.js app? about 300 GB of bandwidth a month and 4 people on the team. Vercel feels pricey, what else is there",
    expected: "A playground that compares hosting platforms on bandwidth and team seats, starting at 300 GB and 4 seats, with Vercel in it.",
    given: [
      { about: /bandwidth|transfer|egress/i, value: 300 },
      { about: /seat|member|team|user|people|developer/i, value: 4 },
    ],
  },
  {
    id: "price-db", kind: "price", needsKit: false, expect: "build",
    request: "which managed Postgres should we use for a side project that's getting real? ~20 GB of data today, growing maybe 5 GB a month. Neon, Supabase, something else?",
    expected: "A playground that compares managed Postgres services on storage, starting at 20 GB, with room for a year of growth.",
    given: [{ about: /storage|data|database size|gb/i, value: 20, mentioned: [20, 80] }],
  },
  {
    id: "price-auth", kind: "price", needsKit: false, expect: "build",
    request: "we need login for a B2B SaaS. around 12,000 monthly active users, and 5 customers already ask for SSO. Auth0, Clerk or WorkOS?",
    expected: "A playground that compares the three auth providers on monthly active users and SSO connections, starting at 12,000 and 5. Rows that a page does not price are shown as unknown, not dropped silently.",
    note: "Awkward pages on purpose: Auth0 prices with a volume slider, and enterprise plans say 'contact us'.",
    given: [
      { about: /mau|active user|monthly active/i, value: 12_000 },
      { about: /sso|connection|enterprise/i, value: 5 },
    ],
  },

  // ---- Look cases on real code. They need the kit.
  {
    id: "look-button", kind: "look", needsKit: true, expect: "build", files: "look-button", targetFile: "Button.tsx",
    request: "the primary button in Button.tsx looks kind of flat and cramped. can you make it feel nicer? not sure what exactly is off",
    expected: "A playground with a live preview of the real button and controls for padding, radius, shadow and weight. After settling, Button.tsx holds the settled class string.",
  },
  {
    id: "look-card", kind: "look", needsKit: true, expect: "build", files: "look-card", targetFile: "ProductCard.tsx",
    request: "our brand is stripe.com. the card in ProductCard.tsx doesn't look like us at all, can you fix the look?",
    expected: "A playground with a live preview of the real card in the colours and fonts read from stripe.com, with controls to tune them. After settling, ProductCard.tsx holds the settled classes.",
  },
  {
    id: "look-pricing-table", kind: "look", needsKit: true, expect: "build", files: "look-pricing-table", targetFile: "PricingTable.tsx",
    request: "the pricing table in PricingTable.tsx is hard to scan, the popular plan doesn't stand out. make it better, our brand is linear.app",
    expected: "A playground with a live preview of the real pricing table in linear.app's brand, with controls for emphasis of the popular plan, spacing and type sizes. After settling, PricingTable.tsx matches.",
  },
  {
    id: "look-form", kind: "look", needsKit: true, expect: "build", files: "look-form", targetFile: "SignupForm.tsx",
    request: "the signup form feels off, spacing or something. SignupForm.tsx. can you tidy it up?",
    expected: "A playground with a live preview of the real form and controls for field padding, gaps and label size. After settling, SignupForm.tsx matches.",
  },
  {
    id: "look-type", kind: "look", needsKit: true, expect: "build", files: "look-type", targetFile: "article.css",
    request: "the blog text in article.css is tiring to read. line length, sizes, I don't know. help?",
    expected: "A playground with a live preview of an article and controls for measure, font size and line height. After settling, article.css holds the settled values.",
  },

  // ---- Feel cases on real code. They need the kit.
  {
    id: "feel-snapback", kind: "feel", needsKit: true, expect: "build", files: "feel-snapback", targetFile: "snapBack.js",
    request: "when you let go of the card in snapBack.js it wobbles forever before it settles. make the snap back feel right",
    expected: "A playground where the person drags the real card and tunes stiffness, damping and mass. After settling, SPRING in snapBack.js holds the settled parameters.",
  },
  {
    id: "feel-momentum", kind: "feel", needsKit: true, expect: "build", files: "feel-momentum", targetFile: "carousel.js",
    request: "the carousel in carousel.js stops dead when I flick it. I want it to glide a bit after a swipe, but not too far",
    expected: "A playground where the person flicks the real carousel and tunes friction and the glide limit. After settling, MOMENTUM in carousel.js holds the settled parameters.",
  },
  {
    id: "feel-press", kind: "feel", needsKit: true, expect: "build", files: "feel-press", targetFile: "button.css",
    request: "hover and press on the button in button.css feel sluggish and cheap. can you make it feel snappier?",
    expected: "A playground where the person hovers and presses the real button and tunes duration, easing, lift and press scale. After settling, button.css holds the settled values.",
  },
  {
    id: "feel-list", kind: "feel", needsKit: true, expect: "build", files: "feel-list", targetFile: "todo-list.css",
    request: "new items just pop into the list in todo-list.css, it's jarring. make adding and removing items feel smooth",
    expected: "A playground where the person adds and removes items in the real list and tunes enter and leave durations and the shift. After settling, todo-list.css holds the settled values.",
  },

  // ---- A playground is not the right move.
  {
    id: "none-fact", kind: "none", needsKit: false, expect: "none", answer: /\b429\b/,
    request: "what status code should my API return when someone hits the rate limit?",
    expected: "A direct answer (429). No playground.",
  },
  {
    id: "none-decision", kind: "none", needsKit: false, expect: "none",
    request: "should we write the new service in Go or stick with TypeScript? everyone on the team knows TS, nobody has shipped Go",
    expected: "A direct recommendation with reasons. No playground: nothing here varies with a number.",
  },
  {
    id: "none-exact", kind: "none", needsKit: false, expect: "none", files: "none-exact",
    fileMust: { path: "Button.tsx", match: /rounded-\[8px\]|rounded-lg|border-?[rR]adius:\s*["']?8(px)?/ },
    request: "make the button radius 8px in Button.tsx",
    expected: "The agent edits Button.tsx to an 8px radius and says so. No playground.",
  },

  // ---- Live web facts times the person's own numbers: comparisons the price engine cannot express. They need data.web.
  {
    id: "data-model", kind: "data", needsKit: true, expect: "build", web: true, files: "data-model", targetFile: "agent.config.json",
    request: "we run a coding agent for our team and I have no idea if we're on the right model. bench.json has what we measured. what should we be using?",
    expected: "A playground that multiplies the team's measured tokens, time and pass rate per task (bench.json) by per-token prices read live from the providers' pricing pages, with the person's volume and limits as controls and the model as a choice. After settling, agent.config.json names the chosen model.",
  },
  {
    id: "data-gpu", kind: "data", needsKit: true, expect: "build", web: true,
    request: "we fine-tune a model every month, roughly 200 GPU hours. I don't know which GPU we even need or where to rent it. runpod? lambda? somebody else?",
    expected: "A playground with the GPU as a choice and hourly prices per GPU read live from two or three vendors' pages, at 200 hours a month. The same GPU is compared across vendors; a vendor that does not list it shows as unknown.",
    given: [{ about: /hour/i, value: 200 }],
  },
  {
    id: "data-seats", kind: "data", needsKit: true, expect: "build", web: true,
    request: "we're 14 people, probably 25 by next year. I need to pick an issue tracker, Linear or Jira or Asana, and I can't tell what each plan would actually cost us",
    expected: "A playground with per-seat plan prices read live from the three vendors' pricing pages, the number of seats as a control starting at 14 and reaching 25, and the plan as a choice.",
    given: [{ about: /seat|people|user|member|team/i, value: 14, mentioned: [14, 25] }],
  },
  {
    id: "data-fact", kind: "data", needsKit: true, expect: "build", web: true,
    request: "our API runs on Cloudflare Workers, about 3 million requests a month on the free plan and growing. when does the paid plan start to make sense for us?",
    expected: "A playground that reads the free plan's request limit and the paid plan's price and included requests live from Cloudflare's Workers pricing page, with requests per month as a control starting at 3 million.",
    given: [{ about: /request/i, value: 3_000_000 }],
  },

  // ---- Return visits to a playground that the harness prepared (email services, a saved decision).
  {
    id: "return-holds", kind: "return", needsKit: false, expect: "return", mustCall: ["read", "recheck"],
    request: "a while back I picked an email service for our app. what did I decide, and does it still hold?",
    expected: "The agent reads the prepared playground, re-checks today's prices, names the saved vendor and says whether the decision holds. No new playground.",
  },
  {
    id: "return-compare", kind: "return", needsKit: false, expect: "return", mustCall: ["revise"], mustAdd: /ses|amazon/i,
    request: "about that email service comparison for our app: I want to also compare Amazon SES",
    expected: "The agent adds Amazon SES to the prepared playground in place and sends the person back to the same URL. No new playground.",
  },
];

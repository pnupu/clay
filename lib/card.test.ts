import assert from "node:assert/strict";
import { test } from "node:test";
import { atWord, blurbOf, cardText, hostsOf, joinNames, kindLabel, reasonOf, requestOf, rowNamed } from "./card.ts";
import { DOMAIN } from "./domain.ts";

// The notes of the seven examples that are live, as their agents wrote them.
const NOTES = {
  card: 'Someone told their agent: "the card snap-back feels dead when I let go of it." Their own agent built this page from their file src/Card.tsx, using its spring and its current values. Drag the card sideways and let go, move the stiffness, damping and mass sliders, and switch on "Keep throw momentum on release" to try a flick.',
  rows: 'Someone told their agent: "the rows in our team member list feel dead when you hover and click them." Their own agent built this page from their file src/member-list.css. Hover over and click the rows while you change the colours, transition speed, easing, press squish and accent bar.',
  toast: 'Someone told their agent: "our toast comes in kind of sluggish and robotic." Their own agent built this page from their file src/toast.css. Press "Show toast" (or leave auto-replay on) and move the sliders and easing choices for how the toast comes in and goes out.',
  pricing: "Someone told their agent: \"the pricing card feels cramped and flat, and the price doesn't pop.\" Their own agent built this page from their file src/PricingCard.tsx. Choose options for card padding, spacing, depth, and the price's size and weight, and watch the card change.",
  button: "Someone told their agent: \"this signup button looks off and I can't say why. Our brand is stripe.com.\" Their own agent built this page from their file src/SignupButton.tsx, with stripe.com's brand colours in the Background picker. Pick a background colour, and move the sliders and options for corner radius, padding, text weight and shadow to see the button change.",
  email: 'Someone told their agent: "we\'re about to launch and need to pick an email service for receipts and password resets. maybe 40k a month now, could be 300k by spring. which one?" Their agent built this page from the pricing pages of Postmark, Resend, Mailgun and Amazon SES, and left SendGrid out because its pricing page, read twice, gave neither a monthly email allowance nor a price, so it could not be ranked. Move the volume from 40,000 toward 300,000 and watch the ranking change.',
  auth: DOMAIN.note!,
};

/** A card text ends cleanly: at the end of a sentence, or at a whole word followed by an ellipsis. */
const clean = (text: string, source: string) => /[.!?]["”]?$/.test(text) || (text.endsWith("…") && new RegExp(`${text.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s,;:(\\-–—"“]`).test(source));

test("the cards of the seven live examples show the request or whole sentences, never a cut word", () => {
  assert.deepEqual(cardText(NOTES.card), { quote: "the card snap-back feels dead when I let go of it." });
  assert.deepEqual(cardText(NOTES.button), { quote: "this signup button looks off and I can't say why. Our brand is stripe.com." });
  assert.deepEqual(cardText(NOTES.email), { quote: "we're about to launch and need to pick an email service for receipts and password resets. maybe 40k a month now, could be 300k by spring. which one?" });
  // The built-in example has no quoted request: its first whole sentence. Before, it ended "…can be changed on p…".
  assert.deepEqual(cardText(NOTES.auth), { blurb: `${DOMAIN.note!.split(". ")[0]}.` });
  for (const [name, note] of Object.entries(NOTES)) {
    const said = cardText(note)!;
    const text = "quote" in said ? said.quote : said.blurb;
    assert.ok(text.length <= 200 && clean(text, note), `${name}: ${text}`);
  }
});

test("a note without the pattern gives whole sentences that fit; a single long sentence is cut at a word, with an ellipsis", () => {
  assert.equal(blurbOf("Short one. Second sentence here. Third.", 30), "Short one.");
  assert.equal(blurbOf("Short one. Second sentence here. Third.", 35), "Short one. Second sentence here.");
  assert.equal(blurbOf("Short one. Second sentence here. Third.", 40), "Short one. Second sentence here. Third.");
  const long = "Four real vendors, read from their own pricing pages, and one fictional vendor, Northwind Auth (marked Demo): its price can be changed on purpose, to show how a saved decision is judged again when a price changes.";
  const cut = blurbOf(long, 140);
  assert.equal(cut, "Four real vendors, read from their own pricing pages, and one fictional vendor, Northwind Auth (marked Demo): its price can be changed on…");
  assert.ok(cut.length <= 140);
  // Punctuation does not hang before the ellipsis, and one very long word is still cut to fit.
  assert.equal(atWord("alpha beta, gamma delta", 12), "alpha beta…");
  assert.equal(atWord("x".repeat(50), 10), `${"x".repeat(9)}…`);
  // A long address after a short word is not cut inside: the card ends before it. A sentence end does not hang before the ellipsis.
  assert.equal(atWord("See https://example.com/a/very/long/path/that/does/not/fit/on/a/card", 40), "See…");
  assert.equal(atWord("Receipts and password resets. Then more words follow here", 31), "Receipts and password resets…");
  // The full stop of an abbreviation does not end a sentence.
  assert.equal(blurbOf("Compares hosts, e.g. Vercel and Netlify, at your traffic. Move the sliders.", 60), "Compares hosts, e.g. Vercel and Netlify, at your traffic.");
  assert.equal(blurbOf("Clerk vs. WorkOS at approx. 40k users. Try it.", 40), "Clerk vs. WorkOS at approx. 40k users.");
  assert.equal(atWord("fits", 10), "fits");
  assert.equal(cardText(""), null);
  assert.equal(cardText("   "), null);
});

test("the request is the quoted text after the opening words, up to the quote that a new sentence follows", () => {
  assert.equal(requestOf('Someone told their agent: "make the "Buy" button pop" Their agent built it.'), 'make the "Buy" button pop');
  assert.equal(requestOf('Someone told their agent: "make the "Buy" Button pop" Their agent built it.'), 'make the "Buy" Button pop');
  assert.equal(requestOf('Someone told their agent: "which one?"'), "which one?");
  // A note that goes on in lowercase after the quote gives no request: agent prose is never shown as the person's words.
  assert.equal(requestOf('Someone told their agent: "fix the card" and then it built a page. See the "Preview" Box.'), null);
  assert.equal(requestOf('Someone told their agent: "The button feels off". It has a "ghost" look.'), "The button feels off");
  assert.equal(requestOf("Your card from src/PricingCard.tsx, as it is now."), null);
  // A very long request is shown cut at a word.
  const said = cardText(`Someone told their agent: "${"please help me choose ".repeat(12).trim()}" Their agent built it.`)!;
  assert.ok("quote" in said && said.quote.endsWith("…") && said.quote.length <= 200 && !/\s…$/.test(said.quote));
});

test("a left-out reason stays as the agent wrote it; only a missing full stop is added", () => {
  assert.equal(reasonOf("its pricing page, read twice, gave neither an allowance nor a price"), "its pricing page, read twice, gave neither an allowance nor a price.");
  assert.equal(reasonOf(" because of rate limits on its pricing page. "), "because of rate limits on its pricing page.");
  assert.equal(reasonOf("npm package has no public price"), "npm package has no public price.");
  assert.equal(reasonOf("AWS lists it per region, not as one price!"), "AWS lists it per region, not as one price!");
  assert.equal(reasonOf('Its page says "contact sales."'), 'Its page says "contact sales."');
});

test("a card is labelled by what the playground is built on, for any mix", () => {
  const preview = { price: false, preview: true, web: 0, brand: false, inline: false };
  assert.equal(kindLabel(preview), "Preview, tuned by hand");
  assert.equal(kindLabel({ ...preview, inline: true }), "Preview, tuned by hand");
  assert.equal(kindLabel({ ...preview, brand: true }), "Real brand colours");
  assert.equal(kindLabel({ ...preview, web: 2 }), "Live web data");
  assert.equal(kindLabel({ ...preview, web: 2, inline: true }), "Live web data × their numbers");
  assert.equal(kindLabel({ ...preview, web: 2, inline: true }, "yours"), "Live web data × your numbers");
  assert.equal(kindLabel({ ...preview, web: 1, brand: true, inline: true }), "Live web data and brand colours × their numbers");
  assert.equal(kindLabel({ price: true, preview: false, web: 0, brand: false, inline: false }), "Price decision");
  assert.equal(kindLabel({ price: false, preview: false, web: 0, brand: false, inline: false }), "Playground");
});

test("a card names the hosts of its sources once each, without www", () => {
  assert.deepEqual(hostsOf(["https://www.runpod.io/pricing", "https://lambda.ai/pricing", "https://lambda.ai/pricing#terms", null, "modal.com", "", "Stripe.com"]), ["runpod.io", "lambda.ai", "modal.com", "stripe.com"]);
});

test("the rows a preview names: its own data and its options, never a common word or a longer look-alike", () => {
  const models = joinNames({ measured: "bench.json, measured by the team on 2026-11-14.", models: [{ model: "claude-opus-5-5", agent: "claude", effort: "low" }, { model: "gpt-6.1-sol", agent: "codex" }] }, ["claude-opus-5-5", "claude-opus-5-5 (in use now)"]);
  assert.equal(rowNamed("Claude Opus 5.5", models), true);
  assert.equal(rowNamed("gpt-6.1-sol", models), true);
  // "claude" (the agent) names no row, and "Claude Opus 5" is another model than "claude-opus-5-5".
  assert.equal(rowNamed("Claude Opus 5", models), false);
  assert.equal(rowNamed("Claude Fable 5.2", models), false);
  assert.equal(rowNamed(null, models), false);
  const gpus = joinNames(null, ["H100 SXM", "A10", "L4", "RTX A6000"]);
  assert.equal(rowNamed("NVIDIA H100 SXM", gpus), true);
  assert.equal(rowNamed("Nvidia L4", gpus), true);
  assert.equal(rowNamed("NVIDIA A10", gpus), true);
  assert.equal(rowNamed("NVIDIA A100 PCIe", gpus), false);
  assert.equal(rowNamed("NVIDIA A6000", gpus), true);
  assert.equal(rowNamed("RTX 6000 Ada", gpus), false);
  // A date or a count in the person's data names no row.
  const prose = joinNames({ hours: "200 GPU hours", date: "2026-11-14", size: "24 GB" });
  assert.equal(rowNamed("B200", prose), false);
  assert.equal(rowNamed("Pricing 2026", prose), false);
  // A shorter id does not take a longer look-alike.
  assert.equal(rowNamed("GPT-4o", joinNames(null, ["gpt-4"])), false);
  assert.equal(rowNamed("Claude Opus 5.5", joinNames(null, ["claude-opus-5"])), false);
  assert.equal(rowNamed("RTX 3080 Ti", joinNames(null, ["RTX 3080"])), false);
  assert.equal(rowNamed("NVIDIA RTX 3080", joinNames(null, ["RTX 3080"])), true);
  assert.equal(rowNamed("Nvidia H100 SXM5", gpus), true);
});

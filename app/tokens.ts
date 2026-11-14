/**
 * The design system's tokens, as Taste Skill 2.5.1 dealt them for Sorvi (`start.mjs css --page software --palette
 * stone-blueprint --type gabarito --radius sharp`): the palette and the type pairing, kept as printed. Both root layouts
 * put this block in the page: the site pages (the landing page, /connect) after the kit's stylesheets, the app pages
 * before their own stylesheet (app/app.css), which reads the same tokens.
 */
export const ROOT_CSS = `
@font-face { font-family: "Gabarito"; font-style: normal; font-weight: 400 700; font-display: swap; src: url(/fonts/gabarito-var.woff2) format("woff2"); }
@font-face { font-family: "Figtree"; font-style: normal; font-weight: 400 600; font-display: swap; src: url(/fonts/figtree-var.woff2) format("woff2"); }
@font-face { font-family: "DM Mono"; font-style: normal; font-weight: 400; font-display: swap; src: url(/fonts/dm-mono-400.woff2) format("woff2"); }
@font-face { font-family: "DM Mono"; font-style: normal; font-weight: 500; font-display: swap; src: url(/fonts/dm-mono-500.woff2) format("woff2"); }
:root {
  --p-bg: #dfdedb; --p-surface: #d3d2ce; --p-ink: #26251e; --p-muted: #5a5850;
  --p-accent: #2456d6; --p-accent-ink: #ffffff; --p-action: #2456d6; --p-action-ink: #ffffff;
  --p-inv-bg: #26251e; --p-inv-surface: #313029; --p-inv-ink: #dfdedb; --p-inv-muted: #9e9d99;
  --p-inv-accent: #dfdedb; --p-inv-accent-ink: #26251e; --p-inv-action: #dfdedb; --p-inv-action-ink: #26251e;
  --font-display: "Gabarito", system-ui, sans-serif;
  --font-text: "Figtree", system-ui, sans-serif;
  --font-mono: "DM Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --display-weight: 400;
  --display-tracking: -0.03em;
  --display-tracking-xl: -0.04em;
  --ly-scale: 0.98;
}
`;


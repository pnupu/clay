import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Benchmark task fixtures: plain CommonJS start and check code that coding agents are asked to fix, not app code.
    "bench/tasks/**",
    "bench/tasks-hard/**",
    // The Taste Skill kit (MIT), served as plain files and kept as shipped (public/credits.txt).
    "public/assets/**",
  ]),
  // The website pages load the kit's plain scripts, which change the markup once; a move between pages is a full page
  // load on purpose (app/(site)/layout.tsx), so links there are plain <a> elements.
  { files: ["app/(site)/**"], rules: { "@next/next/no-html-link-for-pages": "off", "@next/next/no-sync-scripts": "off" } },
  // Eval fixtures are components of an imaginary app that agents are asked to change. Their links (/signup, /login) are
  // not Sorvi's pages; since the catch-all page for unknown addresses (app/(app)/[...rest]) the rule would match them.
  { files: ["evals/files/**"], rules: { "@next/next/no-html-link-for-pages": "off" } },
]);

export default eslintConfig;

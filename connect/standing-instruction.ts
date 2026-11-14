// The optional standing instruction a person pastes into their project's CLAUDE.md (Claude Code) or AGENTS.md (Codex).
// /connect offers it with a Copy button, and connect/standing-instruction.md holds the same text as a file
// (lib/texts.test.ts keeps the two equal). The eval runner measures it with --memory connect/standing-instruction.md.
// Measured on 2026-11-14: see "Optional: make your agent reach for Sorvi on its own" in the README.
export const STANDING_INSTRUCTION = `## Sorvi

When I say something looks or feels off, or I ask which option to choose and the answer depends on prices or on my own numbers, do not guess, edit or answer first. Build a Sorvi lab with the Sorvi MCP tool create_playground, give me the link, and wait until I say I am done. Then call read_playground and carry out what I settled. An exact instruction ("make the radius 8px") or a plain fact needs no lab.
`;

/**
 * `@kwiz/domain` — the game rules as pure functions over an event list.
 *
 * This package has **no dependencies at all**, which is the point. It may not import a
 * database, a Next.js type, a `Request`, a socket or `process.env` (CLAUDE.md §2.1);
 * `.oxlintrc.json` fails the build on any of those rather than trusting convention.
 *
 * Purity is what makes D3's transport swap possible and what lets every test here be a
 * literal array with no mocks. If something needs a mock, it belongs in another package.
 *
 * The contents arrive in build-order slice 2 — deliberately empty until then, because a
 * placeholder written now is a decision made without having read the specs it implements
 * (agent-workflow §3.1).
 */
export {}

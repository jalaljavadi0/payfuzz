# Contributing to PayFuzz

Thanks for helping make payment logic harder to break. Contributions of rules, scenarios, docs and
bug reports are all welcome — as long as they keep the guarantees in [SECURITY.md](SECURITY.md).

## Setup

```bash
git clone https://github.com/jalaljavadi166-netizen/payfuzz.git
cd payfuzz
nvm use          # Node 20, pinned in .nvmrc
npm ci
```

## Before you open a pull request

Run the same checks CI runs:

```bash
npm run typecheck
npm run lint
npm run format:check   # npm run format to fix
npm run test:coverage  # fails below 80% statements/branches/functions/lines
npm run build          # tsup -> dist/index.js and dist/cli.js
```

Then commit the rebuilt `dist/`. It is tracked on purpose so the `node20` Action runs without an
install step; the CI `dist` job rebuilds it and fails if the committed bundle differs from source.
Nothing else needs to be installed or configured.

You can try a change end-to-end against the intentionally buggy samples:

```bash
npx esbuild src/cli.ts --bundle --platform=node --format=cjs --external:ts-morph --outfile=tests/.tmp/cli.cjs
node tests/.tmp/cli.cjs examples/wallet-sample -c .payfuzz.yml --fail-on never
```

## Rules a change must not break

These come from [docs/security-model.md](docs/security-model.md) and are not negotiable for the MVP:

- Never read, request or accept a live key, seed phrase or wallet. Only `sk_test_…` values may appear
  in examples and fixtures.
- No outbound network calls except the GitHub API call that posts PayFuzz's own PR comment. No
  telemetry, no analytics, no PayFuzz server.
- Scenarios are pure functions over an AST. They must never execute, evaluate or import the scanned
  code, and findings must be derived from literals and syntax — not from running anything.
- Do not widen the action's permissions beyond `contents: read` and `pull-requests: write`.
- Every error message a user can hit must point at [SECURITY.md](SECURITY.md).
- Reports contain file paths, line/column numbers and the flagged expression only. Never environment
  values or secrets.

## Adding a scenario or rule

1. Add the analysis in `src/scenarios/<scenario>.ts`, returning findings with a typed rule id
   (`PF-<AREA>-00N`). Keep the doc comment on each rule explaining what it catches and what it does
   not.
2. Register it in `SCENARIOS` (`src/core/scan.ts`) and, if it can be toggled, `SCENARIO_IDS`
   (`src/config/loadConfig.ts`).
3. Add `tests/scenarios/<scenario>.test.ts`. `tests/helpers/analyze.ts` runs a scenario over a code
   string — that is the preferred style. `tests/fixtures/` holds deliberately incomplete files and is
   excluded from typechecking.
4. Update the scenario table in `README.md` and the shape in `docs/architecture.md`.
5. Make sure `low` and `high` sensitivity shift the severity as documented, and that the Markdown
   report still renders sensibly (the snapshot test will tell you).

## The `examples/` projects

`examples/stripe-sample` and `examples/wallet-sample` contain deliberate bugs so the detectors have
something real to find. Do not "fix" them; their `.payfuzz.yml` pins `payment_paths` so they scan
exactly the intended files.

## Commits and pull requests

- Imperative subject, prefixed when it helps: `feat:`, `fix:`, `docs:`, `test:`.
- Say which scenario or rule changed, and include the report output before/after when the behaviour
  changes.
- Keep changes focused; a rule change and a refactor belong in separate PRs.
- Do not bump `dist/` in a PR that does not change source.

## Reporting a security problem

Never open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md) and use GitHub
Security Advisories or `security@payfuzz.dev`.

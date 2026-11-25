# Security Policy

PayFuzz is a security tool, so its own security posture is part of the product. This document is
written before the implementation on purpose: the guarantees below constrain the code, not the
other way around.

> **Status:** complete for the `v0.1.0` MVP. Scope: the action, the CLI, the report output and the CI
> supply chain.

## Supported versions

| Version             | Supported              |
| ------------------- | ---------------------- |
| `0.x` (pre-release) | Yes, latest `0.x` only |

## What PayFuzz is allowed to touch

- Test keys only (`sk_test_…`) and sandbox addresses.
- Files inside the checked-out repository, read-only.
- One optional outbound call: the GitHub API, to post a comment on the pull request that triggered
  the run.

It never touches live keys, private keys, seed phrases, wallets, or any PayFuzz-operated server.

## Threat model

**Assets:** the source code in the checked-out repository, the repository's secrets, the workflow's
`GITHUB_TOKEN`, and the integrity of the report a reviewer trusts.

**Adversaries and failure modes we design against:**

| Risk                                                 | Mitigation                                                                                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment code crafted to make the analyser execute it | Scenarios read the AST only. The parser is an in-memory project with no tsconfig, no module resolution and no `node_modules` lookup; nothing is `eval`ed and no test code is run. |
| Data exfiltration through the scanner                | No network client of our own, no telemetry, no PayFuzz server. The only outbound call is the GitHub API for the report comment the user asked for.                                |
| Escaping the repository                              | Every configured path and every explicit file is resolved and rejected if it leaves the scanned root. Directory symlinks are not followed.                                        |
| Resource exhaustion from a hostile repository        | Files are capped (512 KiB each, 500 files per run); oversized or unreadable files are skipped with a warning.                                                                     |
| Secrets leaking into the report                      | Findings carry paths, lines, columns and the flagged expression only. Environment values are never read.                                                                          |
| Supply-chain tampering                               | `dist/` is built from the tagged source with the committed lockfile; it can be rebuilt and compared.                                                                              |
| Over-broad CI permissions                            | The action requests `contents: read` and `pull-requests: write`, nothing else.                                                                                                    |

## Permissions and why each one exists

- `contents: read` — enumerate and read the payment files in the checked-out repository.
- `pull-requests: write` — create or update the one PR comment that carries the report.

Nothing else is requested: no `contents: write`, no `checks`, no `packages`, no `id-token`. If you
set `comment-on-pr: false`, `pull-requests: write` can be dropped from the workflow.

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately through GitHub Security
Advisories ("Report a vulnerability" on the repository's Security tab) or by email to
`security@payfuzz.dev`. Include a description, reproduction steps and the version affected.

**Disclosure policy:** we acknowledge within 72 hours, aim to ship a fix within 14 days for
high-severity issues, and credit reporters who want credit. Please give us a reasonable window
before public disclosure.

## Reproducible builds

`dist/` is built from the tagged source with the committed lockfile:

```bash
nvm use            # Node 20, pinned in .nvmrc
npm ci
npm run build      # tsup -> dist/index.js and dist/cli.js, dependencies bundled
```

To verify a checkout: run the three commands above and confirm `git diff --exit-code dist/` is
clean. The bundles are self-contained on purpose — a `node20` Action runs `node dist/index.js`
without an install step — so `npm ci` must not change what `dist/` contains.

## Release verification

`v0.1.0` is the initial tagged release. The tag points at the commit that contains both the source
and the committed `dist/`, so you can review the exact bundle your workflow will execute.

```bash
sha256sum dist/index.js dist/cli.js
```

Keyless signing (cosign/Sigstore) and build provenance attestations are not configured for `v0.1.0`;
until they are, verify a release by rebuilding from the tag and comparing `dist/` as described above,
and pin the action to the tag or commit SHA.

## Security contact

`security@payfuzz.dev`

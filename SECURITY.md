# Security Policy

PayFuzz is a security tool, so its own security posture is part of the product. This document is
written before the implementation on purpose: the guarantees below constrain the code, not the
other way around.

> **Status:** skeleton. Threat model, permission rationale, disclosure process, reproducible build
> steps and release hashes are filled in as the MVP lands (Phases 2–6).

## Supported versions

| Version | Supported |
| --- | --- |
| `0.x` (pre-release) | Yes, latest `0.x` only |

## What PayFuzz is allowed to touch

- Test keys only (`sk_test_…`) and sandbox addresses.
- Files inside the checked-out repository, read-only.
- One optional outbound call: the GitHub API, to post a comment on the pull request that triggered
  the run.

It never touches live keys, private keys, seed phrases, wallets, or any PayFuzz-operated server.

## Threat model

_To be completed in Phase 6._ Scope: the action, the CLI, the report output, and the CI supply chain.

## Permissions and why each one exists

_To be completed in Phase 6._ Intended answer: `contents: read` to enumerate payment files,
`pull-requests: write` to post the report comment, nothing else.

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately through GitHub Security
Advisories ("Report a vulnerability" on the repository's Security tab) or by email to
`security@payfuzz.dev`. Include a description, reproduction steps and the version affected.

**Disclosure policy:** we acknowledge within 72 hours, aim to ship a fix within 14 days for
high-severity issues, and credit reporters who want credit. Please give us a reasonable window
before public disclosure.

## Reproducible builds

_To be completed in Phase 6._ Intended answer: `dist/` is built from the tagged source with the
committed lockfile via `npm ci && npm run build`, using the Node version pinned in `.nvmrc`.

## Release verification

_To be completed in Phase 6._ Intended answer: releases are signed with cosign/Sigstore (keyless,
GitHub OIDC) and published with a `*.sha256` checksum file and a build provenance attestation.
Verification instructions ship with each release.

## Security contact

`security@payfuzz.dev`

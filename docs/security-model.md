# Security Model

> Skeleton. Completed alongside the threat model in [SECURITY.md](../SECURITY.md) during Phase 6.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| No live keys, private keys, seed phrases or wallets | No credential inputs exist in `action.yml`; no network client in `src/` |
| No code leaves the runner | No HTTP client except the GitHub API wrapper used for PR comments |
| No writes to the user's repository | Report files only; workflow permissions are `contents: read`, `pull-requests: write` |
| Dry-run by default | Config default `dry_run: true`; scenarios simulate in memory |
| Fully open source, MIT | [LICENSE](../LICENSE) |
| Signed releases | cosign/Sigstore keyless signing in the release workflow (roadmap) |

## Trust boundaries

1. **User code → PayFuzz parser.** Untrusted input, parsed but never executed.
2. **PayFuzz → GitHub API.** One authenticated call, carrying no user code.
3. **Report → PR comment.** Rendered as Markdown; snippets are escaped.

## Out of scope for the MVP

Runtime instrumentation, Python AST support, hosted report viewing, and dashboards. When they
arrive, they must not weaken the invariants above.

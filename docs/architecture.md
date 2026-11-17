# Architecture

> Skeleton. This document grows with the implementation (Phases 2–6).

## Shape

```
Action (dist/index.js)  ─┐
CLI (dist/cli.js)       ─┴─> loadConfig ─> findPaymentFiles ─> scenarios ─> report (md + json)
```

## Rules the architecture must keep

1. Everything runs locally on the user's runner. No PayFuzz service, no telemetry.
2. Input is source code only. No credentials are read, required or accepted.
3. Scenarios are pure functions over a parsed AST; they never execute the user's code.
4. The only side effects are two files (Markdown + JSON report) and, optionally, one PR comment.
5. Every failure path points the reader at [SECURITY.md](../SECURITY.md).

## Storage and network

None. The action requests `contents: read` and `pull-requests: write`; nothing else.

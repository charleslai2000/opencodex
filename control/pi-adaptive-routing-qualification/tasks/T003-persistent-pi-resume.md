# T003 — Persistent Pi session resume qualification

Status: DONE
Work area: real Pi persistent session storage, process exit/resume, and multi-profile routing identity
Objective: Prove that a real persisted Pi session preserves ingress session identity and profile-specific backend placement across Pi process exit/resume, including combined OpenCodex restart.

## Inputs
- Existing isolated qualification topology and T002 stable placement principal fix.
- Local installed Pi CLI with RPC mode and `--session-dir`/`--session` support.
- Formal service `127.0.0.1:3456`, which remained untouched.

## Completion
Use a real Pi persistent JSONL session created by process #1, cleanly exit it, resume the exact existing session file in a fresh Pi process, then repeat after a fresh isolated OpenCodex process restart. Verify coder/reasoner/general concrete targets, session UUID, independent profile placement, second-session isolation, and cleanup.

## Result
Runner committed at `scripts/adaptive-routing-pi-resume-qualification.ts`.

Actual Pi persistence/resume method:

```text
pi --mode rpc --session-dir <isolated-dir> --session-id persistent-resume-session
```

The first process created one JSONL session file:

```text
2026-09-20T16-16-54-180Z_persistent-resume-session.jsonl
```

Its first JSONL header contained the exact session id `persistent-resume-session`. The first Pi process was closed by ending RPC stdin and waiting for its process exit. A fresh Pi process then used:

```text
pi --mode rpc --session-dir <same-isolated-dir> --session persistent-resume-session
```

`get_state` returned the same session id, and the pre-existing JSONL file was opened; no same-name session was created.

Initial persistent session S:

```text
coder / low       -> local/c2
reasoner / medium -> deep/r1
 general / high   -> general/g0
coder / low       -> local/c2
```

Pi-only exit/resume:

```text
reasoner / medium -> deep/r1
coder / low       -> local/c2
general / high    -> general/g0
coder / low       -> local/c2
```

The original targets were preserved. OpenCodex remained running, so this path exercised process-local affinity hits.

Combined Pi + OpenCodex restart:

```text
coder / low       -> local/c2
reasoner / medium -> deep/r1
general / high    -> general/g0
```

This used the same exact persisted Pi session and a new isolated OpenCodex process with an empty process-local affinity store. Stable placement principal plus HRW reconstructed all three targets.

A second real persistent Pi session `persistent-resume-session-T` selected coder low to `local/c1`, proving a distinct persisted session was not forced onto S's target. Equal target collision was not treated as failure; session identity and routing path were distinct.

All requests were actual Pi RPC requests against a recording mock Responses upstream. The runner reported provider/model/effort from captured routing calls, not answer text. Temporary Pi processes, OpenCodex, mock upstream, session directories, and test ports were cleaned. Formal `3456` remained healthy.

## Remaining
No remaining persistent-session blocker. T001's remaining failure/rebind isolation and unavailable `gpt-5.4` low-effort account case are outside this Task. Do not begin Context V2, Pool, or load-aware scheduling.

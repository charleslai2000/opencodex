ENTRY: ACCEPT

## Question

Does the switch-codex error-reporting change preserve original and rollback failures, produce one actionable CLI diagnostic without Bun's duplicate wrapper, and avoid exposing secrets, configuration/request data, or private paths?

## Targets / criteria

- `scripts/switch-codex.ts` lines 25-60, 160-174, and 198-210.
- `tests/cli/cli-switch-codex.test.ts`.
- Coder evidence: `.memory/OCX-SWITCH-ERROR-DIAGNOSTICS-01/work/coder.md`.
- Requirements: preserve both errors/stacks; one useful nonzero CLI diagnostic; no secrets, config, request data, or private paths; preserve existing worktree changes; do not infer acceptance of restart/liveness work.

## Verdict: BLOCKING_FINDINGS

## Findings

### BLOCKING — raw stack formatting violates the logging safety boundary

`formatSwitchError` prints `error.stack` verbatim for ordinary errors and for both members of `SwitchApplyError` (`scripts/switch-codex.ts:29-31`, `50-59`). This preserves useful call-site context, but it also prints error messages and paths supplied by Bun or lower layers without redaction. A direct executable probe with a missing config produced:

```text
Error: ENOENT: no such file or directory, open '/tmp/switch-review-4JJwFP/missing-config.json'
```

The same path is followed by the full source stack. In a normal invocation this can expose the user's configured `OPENCODEX_HOME`/config path, and arbitrary lower-layer errors can include URLs, request metadata, or credential-bearing text. `scripts/AGENTS.md` explicitly prohibits logging private paths, tokens, request bodies, and account data; the dispatch acceptance criteria also require no secrets/config/request data exposure.

Acceptance impact: the error-reporting implementation cannot be accepted until diagnostics redact sensitive values (at minimum configured paths and credential/request material) while retaining actionable error type, message, and source frames. Add regression tests covering a path-bearing error and a credential/request-bearing error.

### NON_BLOCKING — tests do not exercise both-failure executable output

The tests verify `formatSwitchError(new SwitchApplyError(...))` directly and separately verify a single ordinary child-process failure (`tests/cli/cli-switch-codex.test.ts:8-53`). They do not execute the real apply rollback-failure path and assert that the CLI emits exactly one diagnostic containing both preserved stacks. This is a coverage gap rather than a proven defect; it should be added when the blocking redaction fix is made.

## Decisive evidence

- `bun test tests/cli/cli-switch-codex.test.ts`: 2 passed, 0 failed.
- Direct child-process probe of the missing-config path showed the raw configured filename in stderr.
- `SwitchApplyError` does retain `operationError` and `rollbackError`, and `formatSwitchError` renders both; the duplicate Bun wrapper is absent in the focused executable test.

## Remaining uncertainty

This review covers source and focused tests only. No evidence was provided that the deployed immutable artifact under `/opt/opencodex-gpt6-cab39de77` contains this source change; deployment/runtime acceptance remains outside this review and must be verified independently after correction.

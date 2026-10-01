ENTRY: ACCEPT

status: done

## Artifacts

- `scripts/switch-codex.ts`
  - Added `SwitchApplyError` to retain the original apply error and rollback error.
  - Added `formatSwitchError` to print concise headings and complete preserved stacks.
  - Refactored executable dispatch through `main()` and an `import.meta.main` guarded top-level catch, so Bun does not emit its duplicate uncaught exception wrapper.
  - Preserved the existing restart procedure and 75 second deadline.
- `tests/cli/cli-switch-codex.test.ts`
  - Covers both stack traces in an apply plus rollback failure.
  - Covers executable nonzero exit and stderr formatting for a caught failure.

## Evidence

- `bun test tests/cli/cli-switch-codex.test.ts` — 2 passed, 0 failed.
- `bun run typecheck` — passed.
- `bun run privacy:scan` — passed.

## Summary

The apply catch now throws a typed aggregate carrying both error objects instead of converting either to `String(...)`. The top-level CLI catches all command failures, prints the original stack(s) to stderr, and sets a nonzero exit code without an unhandled Bun exception dump.

## Followups

- Independent reviewer should inspect the error output contract and check that the existing restart/liveness changes in the same worktree remain within their separate task scope.

## Open issues

- None for the assigned error-reporting scope.

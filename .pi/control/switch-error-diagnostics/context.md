# Context

- Keep the formal config/service changes separate from this source-code task.
- Worktree has pre-existing modifications in scripts/switch-codex.ts and routing/test files; preserve all user changes.
- Production uses immutable `/opt/opencodex-gpt6-cab39de77`; this task does not deploy it.
- User-visible failure had a nested rollback error which masked primary cause. Requirement: print complete exception stacks for both without dumping secrets/config/request bodies.
- The long wait is separate: 60-second drain + 75-second total restart/readiness budget. No restart policy changes are in scope.

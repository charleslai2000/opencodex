# Goal: Migrate legacy memory into control

## Authorized goal
Migrate the historical control records from the legacy `.memory/` directory into the repository's structured `control/<goal-id>/` layout.

## Scope
Reorganize historical ledgers and agent reports without changing the substantive claims they contain. Create valid Goal, Plan, and Task records, preserve unresolved decisions and limitations, and remove the obsolete `.memory/` tree only after verification.

## Completion condition
All legacy files are represented in the structured control directories, each goal has `goal.md`, `plan.md`, and `tasks/`, no source historical record is silently dropped, and `control/.memory/` no longer exists.

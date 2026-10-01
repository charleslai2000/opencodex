# T001 — legacy memory and control migration record

Status: DONE
Work area: repository control-state migration

## Result

The legacy control plans were moved under `.pi/control/`; all 32 deleted plan and task files have byte-identical destinations. Legacy `.memory/` notes have been classified and copied into their corresponding `.pi/control/` goals. A path-by-path check confirmed each copied note matches its source. The old `.memory/` tree is removed.

The previous migration report below describes an earlier, different migration from the parent workspace. It is retained as historical evidence and does not describe the current migration operation.

## Historical record: parent workspace memory move

A separate earlier operation moved `/home/charles/Workspaces/3rdparty/.memory` into this repository. It moved the fork-opencode ledger and agent note, preserved a pre-existing fork-opencode agent note, and reported no conflicts. That operation's verification applied only to those two paths.

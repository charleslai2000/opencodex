# Task-manager report — OCX-FORMAL-ROUTING-RELIABILITY-01-I1

ENTRY: ACCEPT

Status: done

## Summary

Created the executable DAG in `../plan.md` for the combined routing, formal
service, and `switch-codex` reliability repair. The plan separates route
implementation, service contract authority, service operations, switcher
implementation, mechanical verification, runtime verification, and independent
review. It records disjoint write sets, dependencies, capability levels,
evidence paths, deployment boundaries, stop conditions, and open decisions.

## Confirmed planning inputs

- The incident confirms the formal listener went down after a successful
  unsupervised runtime exit while the installed unit lacked `OCX_SERVICE=1`
  and used `Restart=on-failure`.
- Recovery evidence confirms the active preset was restored to `openai`, with
  expert medium/high routed to `openai/gpt-5.6-terra`. The dirty workspace
  instead shows `gpt-6-terra`, so the plan explicitly prohibits that
  migration. Existing bot OpenRouter/DeepSeek routes are also preserved absent
  explicit authorization; the requested policy needs exact route-matrix
  reconciliation, not a silent broad remap.
- The current source diff changes `scripts/switch-codex.ts` to process
  identification plus runtime restart and leaves route changes in the working
  tree. This is task input, not assumed correct.
- `scripts/AGENTS.md` requires focused checks and typecheck; privacy scan is
  included for configuration/request/log handling.

## Followups

- Orchestrator should dispatch P1/P2 first with fresh invocation IDs and assign
  concrete stable child task IDs.
- After P2 acceptance, dispatch P3/P4 with the accepted service contract,
  frozen constraints, test oracle, and prohibited alternatives.
- Keep `OCX-SWITCH-ERROR-DIAGNOSTICS-01` active and separate.

## Open issues

- The authoritative repo representation of the formal systemd service is not
  yet identified; P2 owns that decision.
- Live host reconciliation requires explicit operational authority and should be
  a fresh dispatch after source review.
- No product code, service file, host state, or other memory file was modified
  by this invocation.

## Evidence

- `.memory/OCX-INC-20260923-01/work/debugger-deep.md`
- `.memory/OCX-INC-20260923-01/work/restore-openai.md`
- `scripts/switch-codex.ts`
- `src/routing/presets.ts`
- `src/server/management/system-restart.ts`
- `ops/AGENTS.md`
- `scripts/AGENTS.md`

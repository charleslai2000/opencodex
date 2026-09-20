# Plan: Pi × OpenCodex Adaptive Routing V1 runtime qualification

## Established results
- Phase 0 harness freeze completed in commit `8d8fab27d` (`test(routing): add isolated Pi adaptive routing e2e`).
- The committed harness uses separate test OpenCodex/Pi/Codex state and a separate test port; it does not modify the formal `3456` instance.
- The formal instance was health-checked before qualification work and remained listening on `3456`.
- Phase 1 discovery found the actual Pi logical surface (`public`, `worker`, `control`, `expert`, `frontier`) and formal OpenAI/DeepSeek catalog entries without exposing credentials.
- Required routing regression baseline passed: 148 tests, 0 failures, 2184 assertions.
- Deterministic mock qualification passed its current matrix, multi-profile affinity, 32-session replica distribution, explicit unknown-model failure, and actual Pi `off → low` mapping observation. Qualification runner: `scripts/adaptive-routing-qualification.ts`.
- All temporary qualification processes/state were cleaned; formal `3456` remained healthy and listening.
- Bounded real smoke passed 3/4 selected cases: `gpt-5.6-sol`, `deepseek/deepseek-flash`, and `deepseek/deepseek-v4-flash`; `gpt-5.4` low was rejected by the formal ChatGPT account despite catalog visibility.
- T002 closed the restart blocker with a routing-only stable placement principal; existing process-local principal semantics remain unchanged.
- True isolated OpenCodex restart reconstruction now passes for same-session coder/reasoner placements, with four-replica distribution preserved.

## Active tasks
- `T001-runtime-qualification`: execute the complete deterministic mock and bounded real-provider qualification matrix.

## Ready tasks
- None.

## Blocked tasks
- Real OpenAI low-effort smoke is blocked for `gpt-5.4` by the formal ChatGPT account's model policy; do not substitute a guessed model.

## Integrated tasks
- Phase 0 harness and runbook are committed at `scripts/adaptive-routing-e2e.ts` and `ops/runbooks/adaptive-routing-pi-e2e.md`.
- `T001-runtime-qualification`: Phase 1 discovery, regression baseline, deterministic mock qualification, and bounded real smoke are recorded; remaining runtime evidence and the real OpenAI low-effort account limitation are tracked in the Task.
- `T002-stable-placement-principal`: restart blocker fixed and verified; identity and routing regressions recorded in the Task.
- `T003-persistent-pi-resume`: real Pi persistent session exit/resume and combined Pi+OpenCodex restart passed.
- `T004-failure-rebind-isolation`: coder/reasoner fallback-rebind isolation, first-bind failure, and all-failed behavior passed.

## Decisive frontier
None. All V1 qualification evidence is complete and the Goal is closed.

## Closure decision
`gpt-5.4` low is an **External account capability limitation**: `/v1/models` advertises the model, but the current ChatGPT/Codex account rejects actual use with HTTP 400: `The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account.` This is not an Adaptive Routing V1 defect, routing blocker, or qualification failure. OpenCodex routed to the requested concrete model; other real OpenAI/DeepSeek smoke passed, and no production routing or model substitution was performed.

## Final capability
```text
Pi logical model × Pi effort
→ OpenCodex routing profile
→ effort-aware tier selection
→ replicaGroup
→ deterministic HRW placement
→ concrete provider/model
→ session-affine binding
→ hard-failure fallback/rebind
```

Verified: same Pi session with multiple logical models has independent per-profile affinity; persistent Pi resume preserves identity; isolated OpenCodex restart reconstructs deterministic HRW placement; failure/rebind in one profile does not contaminate other profiles.

V1 non-goals, not blockers: Context-aware live routing, load-aware scheduling, Pool abstraction, persistent affinity store, and parent-child affinity inheritance are not implemented.

## Next action
STOP. Do not begin Context V2, Pool, load-aware scheduling, persistent affinity, or other follow-on work.

## Goal state
VERIFIED DONE

# T002 — Stable routing placement principal across restart

Status: DONE
Work area: admission identity boundary and deterministic HRW placement
Objective: Close the only confirmed runtime blocker: preserve exact replica placement across a real OpenCodex process restart without changing process-local principal semantics or adding persistent affinity.

## Inputs
- `src/server/auth-cors.ts` admission identity construction.
- Existing process-local `contextPrincipalId` and affinity key.
- `src/router.ts`, `src/routing/replica-placement.ts`, and policy evaluator.
- Isolated Pi qualification runner and the formal-instance protection requirement.

## Completion
A routing-only stable placement principal is minted from the same admission identity material with explicit domain separation. State affinity and placement keys are separate. A true isolated OpenCodex process restart with the same authenticated credential, Pi session, profile definitions, and candidate sets reproduces the exact coder and reasoner concrete targets. Identity isolation and existing routing regressions pass.

## Result
Implemented:
- `routingPlacementPrincipalId` on authenticated configured/environment admissions.
- Stable SHA-256 domain-separated derivation from admission kind, key id, and credential.
- Existing `contextPrincipalId` remains HMACed with the process-random salt and unchanged for process-local state.
- `PolicyAffinityContext.placementPrincipal` is passed through Responses and Chat routing.
- HRW receives a placement key; mutable affinity lookup/commit keeps the original state key.
- Existing direct `routeModel` callers without a placement principal fall back to the supplied principal, preserving test and compatibility behavior.

Identity tests verify same credential/material gives equal placement principal, different credentials give different placement principals, and the raw credential is absent from the derived value. Existing process-local principal derivation remains salted and unchanged; the true process-boundary distinction is verified by the isolated restart qualification. No placement identity is logged or placed in route traces.

Focused regressions: 54 pass, 0 fail, 1214 assertions across admission identity, policy execution, and session affinity. `bun run typecheck`, `bun run privacy:scan`, and `git diff --check` passed.

True restart qualification: `scripts/adaptive-routing-qualification.ts` passed with restart `deterministic: PASS`; same session/profile targets were reconstructed after stopping and starting a new isolated OpenCodex process. Four coder replicas remained distributed (`3`, `7`, `12`, `10` in the observed run). Temporary ports/state were cleaned, and only formal `3456` remained listening and healthy.

## Remaining
No remaining blocker for deterministic restart placement. T001 still owns the remaining qualification items (persistent Pi resume, failure/rebind isolation, and the unavailable `gpt-5.4` low-effort real account case). Context V2, load-aware scheduling, Pool abstraction, and persistent affinity remain excluded.

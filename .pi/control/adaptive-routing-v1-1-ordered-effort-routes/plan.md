# Plan: Adaptive Routing V1.1 — Ordered Effort Routes

## Established result
The strict fallback lifecycle blocker is CLOSED by the runtime-only foundation in T001.

Implemented:
- `src/routing/ordered-route.ts`: `OrderedRoutePlan`, ordered steps/candidates, request-local candidate identity, and a selector that examines one step at a time.
- Optional internal `stepIndex`/`candidateIndex` on route trace candidates; legacy traces remain unchanged.
- `src/server/responses/policy-fallback.ts`: ordered traces are partitioned by ascending step and ranked only within the first non-exhausted step. Later steps are unreachable until earlier candidates are ineligible or terminally failed.
- Existing flat traces still use the legacy global ranking path.

## Active tasks
None.

## Completed tasks
- `T001-ordered-route-lifecycle-recon`: DONE; strict ordered fallback foundation verified.
- `T002-public-ordered-routes-stage-b`: DONE; public routes schema and exact logical-effort Responses/Chat wiring verified.
- `T003-upstream-effort`: DONE; candidate-local effort validation, eligibility, immutable trace, and request/fallback propagation verified.
- `T004-ordered-pool-hrw`: DONE; ordered RouteStep pools use deterministic full HRW ordering and same-step failover.
- `T005-ordered-session-affinity`: DONE; effort-scoped process-local ordered bindings, exact candidate occurrence validation, and fallback rebind unit semantics verified.
- `T006-runtime-qualification`: DONE; corrected authenticated real-Pi qualification passed the complete ordered affinity acceptance path.
- `T007-debug-ordered-affinity-fallback`: DONE; root cause was loopback admission in the original runner, not runtime candidate propagation.

## Decisive frontier
None. Stage F runtime qualification is complete. The original blocker was resolved by correcting the isolated qualification topology to provide configured admission identity; no routing runtime change was needed.

## Qualification closure
- Normal low/medium/high routes, candidate-local wire effort, same-step HRW fallback, cross-step fallback, sticky fallback, rebind, effort/profile isolation, persistent Pi resume, and isolated OpenCodex restart were verified with real Pi and isolated topology.
- Full requested regression set: `215 pass / 0 fail / 2441 assertions`.
- `bun run typecheck`, `bun run privacy:scan`, and `git diff --check` passed.
- Formal `127.0.0.1:3456` remained healthy and untouched; isolated processes, test ports, and temporary state were cleaned.
- Production deployment is not included. Future production Pi ingress must use an authenticated client API key; loopback/no-admission ingress does not provide `contextPrincipalId` and cannot support ordered affinity.

## Next action
STOP. Do not implement persistent affinity, Context V2, model-matrix rollout, canary, or production deployment under this closed Goal.

## Goal state
VERIFIED DONE

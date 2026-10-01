# T004 — Ordered RouteStep pool HRW

Status: DONE
Work area: deterministic HRW placement within ordered RouteStep pools and same-step fallback ordering
Objective: Make each ordered `RouteStep.candidates[]` a deterministic pool without changing legacy V1 placement, ordered affinity, or upstream-effort semantics.

## Completion
Ordered steps use a stable placement key and full HRW preference order inside the current step. Hard-ineligible candidates are excluded before HRW. Same-step terminal failures consume the HRW order before the next step is considered. Legacy `replicaGroup` HRW remains behavior-compatible.

## Result
Added `rankCandidatesByHrw()` beside the existing `chooseReplicaByHrw()` helper. The existing legacy wrapper now delegates to the same digest primitive and preserves the max-hash winner behavior. Legacy hash input remains:

```text
placement key + NUL + provider + NUL + model
```

Ordered placement uses:

```text
routingPlacementPrincipalId
+ NUL + routingProfileId
+ NUL + logicalEffort
+ NUL + sessionLane
```

No mutable affinity lookup or commit was added. Ordered profiles recompute deterministic placement each turn from the stable placement identity. Initial ordered selection uses HRW only among hard-eligible candidates in the current step; later steps cannot compete. Ordered fallback ranks remaining candidates in that same step using the same HRW key, then crosses the step boundary only after exhaustion. Ordered fallback uses full step/candidate identity for tried tracking.

The route decision reason is `ordered-hrw` when a placement identity is available. No placement principal is written to trace.

Candidate `upstreamEffort` remains attached to each candidate and is not changed by HRW. Existing provider/model effort mapping remains downstream.

## Verification
Focused tests passed:

```text
72 pass / 0 fail / 299 assertions
```

Covered deterministic full order, candidate removal/rebuild, hard eligibility before HRW, ordered selection, ordered trace, fallback, schema, and legacy policy execution. Also passed:

```text
bun run typecheck
bun run privacy:scan
git diff --check
```

Formal `127.0.0.1:3456` was not changed or deployed.

## Remaining
Ordered session affinity / effort-scoped mutable binding remains explicitly not started. No pool registry or weighted/load-aware scheduling was introduced.

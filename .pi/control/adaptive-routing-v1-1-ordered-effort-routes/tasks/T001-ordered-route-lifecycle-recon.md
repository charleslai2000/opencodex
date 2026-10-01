# T001 — Ordered route lifecycle foundation

Status: DONE
Work area: internal ordered route selection, immutable trace identity, and policy fallback lifecycle
Objective: Remove the strict-ordering blocker without exposing public `routes` configuration or changing legacy V1 behavior.

## Inputs
- Existing flat V1 evaluator and policy fallback.
- Requirement that each current step is exhausted before the next step is considered.
- Existing immutable route trace and `attempts[]` lifecycle.

## Completion
An internal ordered plan/selector exists; ordered trace candidates carry request-local step/candidate identity; policy fallback partitions ordered candidates by step and exhausts each step before entering the next; legacy flat behavior remains unchanged. No public schema or upstream-effort wiring is added.

## Result
Implemented `src/routing/ordered-route.ts` with runtime-only:

```text
OrderedRoutePlan
OrderedRouteStep
OrderedRouteCandidate
selectOrderedRouteCandidate()
orderedCandidateKey()
```

The selector evaluates one step at a time. It filters hard-ineligible candidates and request-local terminal failures within that step, ranks only the remaining candidates in that step, and advances only when the step has no remaining candidate. It never merges steps into one score competition.

`RouteCandidateTrace` and `TraceCandidateInput` now accept optional internal `stepIndex` and `candidateIndex` fields. They are absent from legacy traces and do not introduce a public `fallbackGroup` or configuration schema. Trace normalization preserves bounded valid identities. The initial route trace remains immutable.

`src/server/responses/policy-fallback.ts` now detects ordered trace identity and selects fallback candidates by ascending `stepIndex`, then by existing score only inside the current step. Candidate keys include step/candidate identity plus provider/model for ordered traces. Existing flat traces continue through the unchanged global ranking function. Physical attempt history remains in `attempts[]`; no persistence was added.

No HRW helper extraction was needed in this foundation stage. The ordered selector exposes the `rankWithinStep` seam for a later ordered-route producer to supply existing ranking or HRW without touching legacy `replicaGroup` behavior. Affinity keys and commit semantics were not changed.

## Verification
Focused ordered runtime and legacy fallback tests:

```text
19 pass
0 fail
49 assertions
```

Covered first-step priority over a higher-scored later step, same-step fallback, step exhaustion, hard ineligibility, all-step exhaustion, immutable trace identity, and a real `handleResponsesWithPolicyFallback` execution proving step 0 candidate failure selects another step 0 candidate before step 1.

Also passed:

```text
bun run typecheck
bun run privacy:scan
git diff --check
```

Focused ordered and legacy fallback tests passed: `19 pass / 0 fail / 49 assertions`.
The repository layout guard was also invoked, but reported pre-existing unrelated worktree drift: unresolved `tests/routing/adaptive-routing-closure.test.ts` and existing misplaced `routing/session-affinity.test.ts` / `routing/pi-compatibility-gate.test.ts`. The new `ordered-route.test.ts` is correctly registered and passed; those unrelated layout entries were not changed.

No public `routes` schema, candidate `upstreamEffort`, effort-scoped affinity, Pi/OpenCode change, or formal-instance change was made.

## Remaining
Public routes schema, candidate upstream effort, ordered evaluator wiring, affinity integration, and full V1.1 acceptance remain future work outside this foundation task. The strict fallback lifecycle blocker is CLOSED.

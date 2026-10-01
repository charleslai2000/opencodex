# T002 — Public ordered routes Stage B

Status: DONE
Work area: public routing profile schema and ordered Responses route selection
Objective: Wire `routingProfiles.<id>.routes[logicalEffort]` into the internal OrderedRoutePlan without implementing candidate `upstreamEffort`, effort-scoped affinity, or ordered pool HRW.

## Inputs
- T001 runtime-only ordered selector and step-aware fallback trace.
- Frozen legacy `candidates` V1 path.
- Existing evaluator evidence/scoring and Responses fallback lifecycle.

## Completion
Public routes schema validates and normalizes in stable order; request logical effort selects the exact route key; ordered selection evaluates only within the current step; immutable trace preserves all ordered candidates; Responses fallback moves through same-step candidates before the next step; ordered profiles do not use legacy mutable affinity; legacy candidates remain on the old path.

## Result
Implemented:

```ts
OcxRoutingRouteCandidate
OcxRoutingRouteStep
OcxRoutingProfileConfig.routes
```

Validation enforces:

- `candidates XOR routes`;
- non-empty routes and steps;
- canonical reasoning-effort route keys;
- non-empty step candidate arrays;
- non-empty provider/model identifiers;
- duplicate provider/model rejection within a step;
- stable route/step/candidate order.

Normalization preserves route order and includes complete ordered routes in the profile revision digest. Same provider/model across different steps remains allowed.

`routeModel()` now dispatches ordered profiles through an isolated Stage-B path:

```text
request reasoning effort
→ exact profile.routes[logicalEffort]
→ OrderedRoutePlan
→ per-step existing evaluator evidence/scoring
→ ordered selector
→ immutable trace with stepIndex/candidateIndex
→ concrete route
```

Missing logical effort route raises the existing no-eligible policy error; no fallback to another effort is performed. Candidate effective effort is currently the logical effort only; no `upstreamEffort` field exists.

Ordered profiles are marked internally with `orderedRoute: true`, so Responses and Chat preparation skip legacy mutable affinity lookup/commit. Chat uses the shared Responses fallback lifecycle through `handleResponses`, so ordered step boundaries are respected on the translated Chat path as well as native Responses. Legacy profiles retain the existing affinity, HRW, evaluator, and fallback path unchanged.

Ordered step boundary is DONE. Ordered pool HRW is pending: Stage B uses existing evaluator score/rank inside a step and does not claim replica-pool HRW semantics.

## Verification
Passed:

```text
routing-profile.test.ts: 31 pass / 0 fail / 175 assertions
policy-execution.test.ts + ordered-route.test.ts + routing-policy-fallback.test.ts:
69 pass / 0 fail / 291 assertions

bun run typecheck
bun run privacy:scan
git diff --check
```

The formal `127.0.0.1:3456` instance remained untouched and healthy. No Pi/OpenCode changes or deployment occurred.

## Remaining
Candidate `upstreamEffort`, effort-scoped ordered affinity, ordered pool HRW, and broader V1.1 production qualification remain explicitly out of scope.

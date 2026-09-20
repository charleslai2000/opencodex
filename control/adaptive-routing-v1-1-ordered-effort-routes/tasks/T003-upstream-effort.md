# T003 — Candidate-level upstream effort

Status: DONE
Work area: ordered route candidate schema, candidate-local eligibility, immutable trace, and Responses/Chat effort propagation
Objective: Add candidate-level `upstreamEffort` while preserving logical effort route selection and strict ordered fallback. Do not implement ordered affinity or ordered pool HRW.

## Completion
Ordered candidates accept canonical optional `upstreamEffort`; omitted values default to the selected logical effort; capability eligibility uses each candidate's effective effort; immutable trace preserves it; initial and fallback requests feed that value into the existing provider/model effort mapping pipeline; legacy V1 remains unchanged.

## Result
Implemented:

```text
OcxRoutingRouteCandidate.upstreamEffort?: string
OrderedRouteCandidate.upstreamEffort?: string
RouteCandidateTrace.upstreamEffort?: string
```

Validation rejects non-canonical effort values. Normalization retains route order and candidate effort, defaults omitted values to the route logical effort, and includes the complete value in the profile revision digest. Same provider/model across different steps remains allowed.

Runtime separation is explicit:

```text
logicalEffort
  -> exact routes[logicalEffort]
  -> candidate.upstreamEffort ?? logicalEffort
  -> candidate-local capability/effort eligibility
  -> existing provider/model effort mapping
  -> provider wire effort
```

The evaluator receives a candidate-local `effectiveReasoningEffort` copy and never mutates shared request evidence. Ordered route traces retain the candidate-local canonical upstream effort. Ordered fallback request rebuilding recomputes the candidate's own reasoning effort from trace metadata, so a Qwen `high` attempt cannot leak into a Luna `medium` fallback.

Initial Responses and Chat route preparation copy the selected ordered candidate's effective effort into the existing parsed/raw reasoning fields. No second provider mapping implementation was introduced. Ordered mutable affinity remains disabled; ordered pool HRW remains pending.

## Verification
Focused schema, route, ordered foundation, policy execution, and fallback tests passed:

```text
70 pass / 0 fail / 299 assertions
```

Also passed:

```text
bun run typecheck
bun run privacy:scan
git diff --check
```

Formal `127.0.0.1:3456` was not modified or deployed.

## Remaining
Required full real upstream Responses/Chat wire-capture qualification should be run before broader V1.1 production qualification. Ordered session affinity and ordered pool HRW remain explicitly not started.

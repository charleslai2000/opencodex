# Adaptive Routing V1 closure report

status: VERIFIED DONE

## Frozen data flow

```text
Responses / Chat request body
  -> existing parser/evidence extraction
  -> reasoning effort evidence
  -> routingProfiles/policy hard eligibility
     (candidate efforts + capability + health/cooldown + existing requirements)
  -> existing policy scoring chooses tier winner
  -> if winner has replicaGroup and no usable affinity:
       HRW among same-group hard-eligible candidates
  -> exact provider/model
  -> upstream success seam
  -> process-local session affinity commit
```

Affinity key remains:

```text
principal + NUL + routingProfileId + NUL + sessionLane
```

No second identity parser was added.

## Representative config fixture

The integration fixture uses the existing schema:

```json
{
  "routingProfiles": {
    "coder": {
      "candidates": [
        { "provider": "v100-0", "model": "qwen", "efforts": ["low", "medium"], "replicaGroup": "v100-qwen" },
        { "provider": "v100-1", "model": "qwen", "efforts": ["low", "medium"], "replicaGroup": "v100-qwen" },
        { "provider": "v100-2", "model": "qwen", "efforts": ["low", "medium"], "replicaGroup": "v100-qwen" },
        { "provider": "v100-3", "model": "qwen", "efforts": ["low", "medium"], "replicaGroup": "v100-qwen" },
        { "provider": "strong-local", "model": "strong-model", "efforts": ["high"] },
        { "provider": "frontier", "model": "frontier-model", "efforts": ["xhigh"] }
      ]
    }
  }
}
```

Fixture: `tests/routing/adaptive-routing-closure.test.ts`.

## Verified behavior

- low -> V100 replica group
- medium -> V100 replica group
- high -> `strong-local`
- xhigh -> `frontier`
- 64 independent medium sessions reached all four V100 replicas
- same session remained on the exact provider/model for 20 turns with `affinity-hit`
- effort medium -> high invalidated V100 affinity and selected strong backend
- high -> medium invalidated strong affinity and returned to V100 placement
- disabled bound V100 replica invalidated affinity and selected a remaining replica
- removing the bound replica invalidated the binding and selected a remaining replica
- clearing the in-memory store modeled restart; unchanged candidate set deterministically recovered the same HRW replica
- Responses and Chat-shaped evidence agreed for effort, tools, and images
- direct evaluator trace exposed `replica-hrw` and `tieBreak: replica-hrw`

## Ingress and success seams

Responses uses the existing `onResponseComplete` completion seam from response effects. Native Chat uses the thin `onSuccess` callback on successful JSON/terminal completion. Chat -> Responses carries the existing completion callback. Existing policy fallback remains responsible for retries; successful fallback updates/rebinds the process-local affinity target without rewriting the immutable initial decision trace.

Surface/fallback regression was run through existing handler/translator tests rather than real external inference servers:

- `tests/routing/routing-policy-surface-parity.test.ts`
- `tests/routing/routing-policy-fallback.test.ts`
- `tests/providers/opencode-go-session-header.test.ts`

## Observability

Bounded route trace reasons currently distinguish:

- `policy-selected` / normal selection
- `replica-hrw` with `tieBreak: replica-hrw`
- `affinity-hit`
- `affinity-invalidated`

Fallback execution remains in existing `attempts[]`; no durable schema expansion was needed.

## Restart and membership semantics

- Store is process-local only; restart clears it by design.
- Same principal/profile/lane and unchanged candidate set reselects the same HRW replica exactly.
- Existing binding remains sticky while its target remains hard-eligible.
- Removed/disabled/cooldown/effort-ineligible target is invalidated and replaced through normal eligibility plus group placement/fallback.
- No migration engine was introduced.

## Context V2 freeze

```text
Context-aware live routing: NOT IMPLEMENTED IN V1.
```

Candidate advertised context metadata remains capability evidence only. No actual live input-token estimate or heuristic context hard filter was added. Exact provider token usage is unavailable before routing; universal conservative estimation is not validated; multimodal, continuation, and provider transforms can remain unknown.

## Verification commands

- `bun test tests/routing/adaptive-routing-closure.test.ts`: **9 pass, 0 fail, 88 assertions**
- `bun test tests/routing/session-affinity.test.ts tests/routing/policy-execution.test.ts`: **29 pass, 0 fail, 1151 assertions**
- `bun test tests/routing/routing-policy-fallback.test.ts tests/routing/routing-policy-surface-parity.test.ts tests/providers/opencode-go-session-header.test.ts`: **105 pass, 0 fail, 936 assertions**
- `bun run typecheck`: passed
- `git diff --check`: passed

No Pool abstraction, context estimator, persistence, load scheduler, parent-child inheritance, OpenCode change, or cost optimizer was added.

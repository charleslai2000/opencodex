# Stage 4 placement review

status: BLOCKED — structural semantic gap; no HRW added

## Finding
Current policy selection places every new unbound session on the first declared eligible candidate when candidates are otherwise equivalent.

Evidence:
- `src/routing/evaluator.ts:190`: `configuredPriorityScore(index, total) = (total - index) / total`.
- `src/routing/evaluator.ts:417`: this declaration-order score is included in each candidate total.
- `src/routing/evaluator.ts:474-477`: selection updates only on strict `score.total > bestScore`; equal scores also retain the earlier candidate.
- No random, deterministic hash, load-aware, or existing tie-break mechanism was found.
- Health/latency can change ranking only when their configured score weights and evidence produce a difference; with equal health and equal capability they do not distribute new sessions.

Focused baseline test:
- `tests/routing/session-affinity.test.ts`: 32 different unbound session lanes across four equivalent `v0..v3/qwen` candidates all select `v0/qwen`.

## Why HRW was not implemented
The Stage 4 constraints require HRW only among the “current highest-level truly equivalent candidates,” while never overriding configured priority, capability preference, health/cooldown, or an explicit score advantage. The current evaluator does not expose a semantic tier/rank bucket that distinguishes “equal tier” from “different tier”; every candidate receives a declaration-order priority score, and its numeric score is intentionally different even when provider/model capabilities and health are identical.

Adding HRW to all eligible candidates would violate the hard constraint by overriding configured priority. Adding a new `pool`, `group`, or equivalence schema would violate the no-new-schema requirement and invent semantics not present in the current policy model. Therefore the correct action under the requested STOP rule is to report the structural gap rather than silently change routing semantics.

## Verification
- `bun run typecheck`: passed
- `bun test tests/routing/policy-execution.test.ts`: 20 pass, 0 fail, 74 assertions
- `bun test tests/routing/session-affinity.test.ts`: 5 pass, 0 fail, 44 assertions
- `git diff --check`: passed

No context estimation, Pool abstraction, weighted scheduler, live metrics, persistence, parent-child inheritance, or OpenCode changes were made.

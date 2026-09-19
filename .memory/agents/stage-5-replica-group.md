# Stage 5 replicaGroup + HRW placement

status: PASS

## Modified files
- `src/types/config.ts`: optional `replicaGroup?: string` on policy candidates.
- `src/routing/profile.ts`: validates non-empty group strings, trims them during normalization, and includes them naturally in the profile revision digest.
- `src/routing/replica-placement.ts`: stable SHA-256 HRW selector.
- `src/routing/evaluator.ts`: after existing hard eligibility and normal score winner selection, if there is no usable affinity hit and the normal winner declares `replicaGroup`, selects only eligible candidates in that same group using HRW. Existing configured priority score is unchanged.
- `src/router.ts`: passes the existing Stage-3 affinity key into evaluator for initial placement and invalidated-binding re-placement.
- `tests/routing/session-affinity.test.ts`: Stage 5 placement, distribution, determinism, boundaries, hard exclusions, schema/revision, and remap coverage.

## Final schema
```ts
replicaGroup?: string
```
Optional, non-empty after trim. It has no pool, weight, health, fallback, or nested target semantics.

## Placement insertion
1. Existing evaluator calculates all candidate hard eligibility and scores.
2. Existing normal winner is captured as `normalSelectedIndex`.
3. If a usable affinity binding exists, `affinity-hit` wins and HRW is skipped.
4. Otherwise, only if the normal winner has `replicaGroup`, eligible candidates with exactly the same group are collected.
5. HRW chooses among that group only.
6. Trace reason/tie-break is `replica-hrw`; invalidated binding keeps `affinity-invalidated` trace semantics.

The group never competes across policy tiers. A candidate in another group or without a group cannot enter the HRW set.

## HRW
- Hash: SHA-256, interpreted lexicographically as a 64-character hex score.
- Input: `affinityKey + NUL + candidateIdentity`.
- Affinity key remains Stage 3’s `principal + NUL + routingProfileId + NUL + sessionLane`.
- Candidate identity: `provider + NUL + model`.
- No `Math.random`, process seed, modulo hashing, persistence, or Pool abstraction.

## Tests
- Stage 5/session-affinity: 9 pass, 0 fail, 1077 assertions.
- Stage 2/policy-execution: 20 pass, 0 fail, 74 assertions.
- Combined: 29 pass, 0 fail, 1151 assertions.
- `bun run typecheck`: passed.
- `git diff --check`: passed.

Coverage includes:
- ungrouped candidates preserve declaration-order winner;
- 512 new affinity keys across four replicas reach all four candidates;
- deterministic repeated placement;
- group boundary;
- disabled/hard-ineligible replica exclusion;
- effort/capability invalidation inherited from evaluator;
- deterministic minimal-remap property when a replica is removed;
- whitespace normalization, revision change, and invalid group validation;
- existing Stage 3 affinity hit does not invoke HRW.

No configured priority semantics were modified. No context estimation or other excluded work was started.

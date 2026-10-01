# T006 — Ordered Effort Routes runtime qualification

Status: DONE
Work area: real Pi persistent session, isolated ordered-route OpenCodex, mock pools, failure/rebind, and regression qualification
Objective: Qualify the complete V1.1 runtime semantics without adding routing functionality.

## Inputs
- T001–T005 ordered route foundation, public schema, candidate upstream effort, ordered HRW, and ordered affinity.
- Real installed Pi RPC mode.
- Formal instance `127.0.0.1:3456`, protected and not used for test state.

## Completion
Real Pi + isolated OpenCodex must prove normal low/medium/high routes, candidate-local wire effort, same-step HRW fallback, cross-step fallback, sticky ordered affinity, rebind, effort/profile isolation, Pi resume, restart reconstruction, and required regressions.

## Result
**Initial qualification run was blocked by an invalid loopback topology; the corrected authenticated qualification passed.**

Qualification runner added:

```text
scripts/adaptive-routing-ordered-qualification.ts
```

It uses real Pi RPC mode, isolated OpenCodex/home/session directories, public `routes` schema, per-backend mock providers, runtime failure control, persistent Pi session, and isolated OpenCodex restart. It cleans all test state in `finally` and health-checks formal `3456`.

Observed before the blocking assertion:

- Real Pi `lead/low` reached a Q9 mock with wire effort `low`.
- Real Pi `lead/medium` reached a Q27 mock with wire effort `high`.
- Real Pi `lead/high` reached a Luna mock with wire effort `high`.
- Same-step Q27 failure selected another Q27 candidate with wire effort `high`.
- All Q27 candidates failed, then Luna was selected with wire effort `medium`.

Blocking case:

```text
Q27 pool exhausted
→ Luna selected and succeeds @ medium
→ next same-session lead/medium request
→ Q27 selected again
```

The required sticky fallback invariant failed:

```text
fallback success → ordered affinity-hit
```

The initial assertion observed the fallback Luna call followed by a Q27 call, but T007 proved this was because loopback admission had no `contextPrincipalId`, so no ordered affinity key could exist. After changing only the isolated runner to remote-style authenticated admission, the same original runner observed Luna success followed by Luna affinity-hit.

## Verification
The qualification process cleaned its isolated Pi/OpenCodex/mock resources in `finally`; formal `3456` remained healthy. No test-port residue remained after the failed run.

Completed regression set before closure:

```text
50 pass / 0 fail / 1200 assertions
```

This covered ordered foundation, ordered HRW, schema, policy execution, policy fallback, and legacy session affinity. Also passed:

```text
bun run typecheck
bun run privacy:scan
git diff --check
```

The complete requested V1/V1.1 regression set was then rerun and passed: `215 pass / 0 fail / 2441 assertions`.

## Remaining
None for the requested runtime qualification. Persistent affinity remains out of scope; OpenCodex restart intentionally loses mutable ordered affinity and reconstructs from stable HRW.

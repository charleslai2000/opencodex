# T005 — Ordered session affinity

Status: DONE
Work area: process-local ordered route bindings, exact candidate occurrences, and fallback rebind
Objective: Add `session + profile + logicalEffort` ordered affinity without changing legacy V1 affinity.

## Completion
Ordered routes use an independent bounded TTL/LRU store and key. Bindings include exact step/candidate occurrence, provider/model, and effective upstream effort. Valid bindings win over HRW; invalid bindings are forgotten. Successful initial/fallback responses commit only after completion. Hard fallback failure invalidates the old binding and successful fallback rebinds. Restart remains process-local and loses ordered bindings.

## Result
Added ordered-specific affinity APIs in `src/routing/session-affinity.ts`:

```text
orderedAffinityKey()
lookupOrderedAffinity()
rememberOrderedAffinity()
forgetOrderedAffinity()
```

They use the existing policy affinity TTL and bounded capacity but separate storage/value semantics from legacy V1.

Ordered key:

```text
contextPrincipalId
+ NUL + profileId
+ NUL + logicalEffort
+ NUL + sessionLane
```

Ordered binding value includes:

```text
stepIndex
candidateIndex
provider
model
upstreamEffort
lastUsedAt
```

Ordered route lookup validates exact occurrence, provider/model, effective upstream effort, and current hard eligibility. A valid binding returns `affinity-hit`; an invalid binding is forgotten and normal ordered HRW resumes with `affinity-invalidated` semantics. Legacy `contextPrincipalId + profileId + sessionLane` lookup/value behavior is unchanged.

Responses and Chat success completion seams commit ordered bindings only after successful completion. Ordered fallback invalidates the prior binding before trying a new candidate and commits the successful candidate occurrence after success. A failed initial candidate is never committed.

Restart semantics remain process-local: the ordered store is cleared with process state, so a fresh OpenCodex process starts from the primary ordered HRW route. No persistence or background worker was added.

## Verification
Passed:

```text
50 pass / 0 fail / 1200 assertions
bun run typecheck
bun run privacy:scan
git diff --check
```

The existing legacy session-affinity suite passed unchanged. Formal `127.0.0.1:3456` was not modified or deployed.

## Remaining
No persistent affinity, parent-child inheritance, or production deployment was introduced. Ordered affinity remains process-local by design.

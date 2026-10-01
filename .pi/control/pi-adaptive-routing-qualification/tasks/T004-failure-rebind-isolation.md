# T004 — Multi-profile failure/rebind isolation

Status: DONE
Work area: real Pi RPC session, isolated mock transport failures, policy fallback, and affinity isolation
Objective: Verify that hard failure and rebind for one logical profile do not mutate another profile's process-local affinity, including first-bind and all-failed cases.

## Inputs
- Existing isolated qualification topology and stable placement fix.
- `scripts/adaptive-routing-pi-resume-qualification.ts` real Pi RPC/session pattern.
- Existing policy fallback and session-affinity semantics.
- Formal instance `127.0.0.1:3456`, which remained untouched.

## Completion
All requested runtime failure/rebind cases passed with actual Pi requests, captured concrete provider/model calls, profile isolation evidence, cleanup, and regression validation.

## Result
The runtime-switchable mock failure control is in `scripts/adaptive-routing-qualification.ts`. It returns HTTP 503 for selected concrete targets only; it does not modify OpenCodex fallback logic.

Initial same-session bindings were established and then exercised:

```text
coder / low       -> local/replica-2
reasoner / medium -> deepseek-a/model-b
 general / high   -> local-b/replica-4
coder / low       -> local/replica-2
```

Coder failure/rebind:

The bound coder target was forced to HTTP 503. Existing fallback/eligibility semantics selected a different healthy coder candidate, and the next coder request hit that successful fallback target directly. The recorded successful fallback and subsequent affinity hit were captured at sequences 52 and 53; the exact concrete replica is run-dependent because HRW placement is keyed by the isolated session/admission identity.

Immediately after coder rebind:

```text
reasoner -> deepseek-a/model-b
 general -> local-b/replica-4
```

Both remained on their own bindings.

Reasoner failure/rebind:

```text
bound reasoner target -> HTTP 503
fallback -> deepseek-a/model-a
subsequent reasoner -> deepseek-a/model-a
coder -> local/replica-2
```

The reverse isolation check passed: reasoner rebind did not change coder placement.

First-bind failure case:

```text
new session T / policy/firstfail
initial replica-0 -> HTTP 503
fallback -> local/replica-1
next request -> local/replica-1
```

The failed first target was not committed; the successful fallback was the subsequent target.

All-failed case:

```text
all mock targets -> HTTP 503
request failed
```

No successful response or failed-target binding was committed. The process was then cleaned normally.

The qualification runner preserves the existing immutable route decision and physical fallback attempt accounting; no persistent schema or fallback logic was changed. Formal `3456` remained healthy. Temporary Pi/OpenCodex/mock processes, homes, sessions, and ports were cleaned.

## Verification
Required regression set passed:

```text
174 pass
0 fail
2252 assertions
```

Included admission identity, Pi compatibility, policy execution, session affinity, replica placement, adaptive closure, persistent qualification coverage, policy fallback, surface parity, and Go session-header tests. Also passed:

```text
bun run typecheck
bun run privacy:scan
git diff --check
```

## Remaining
Failure/rebind isolation is PASS. The remaining real-smoke environmental limitation is the formal ChatGPT account rejecting `gpt-5.4` low despite catalog visibility. Context V2, Pool, load-aware scheduling, and persistent affinity remain excluded.

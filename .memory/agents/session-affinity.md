# Stage 3 minimal session affinity

status: PASS

## Result
Implemented bounded process-local sticky selection for `routingProfiles/policy`. Existing hard eligibility is evaluated first; only then is a valid binding allowed to override ordinary scoring. Bindings are committed only after successful Responses completion or successful Chat completion/terminal.

## Affinity key
`principal + NUL + routingProfileId + NUL + sessionLane`.

The request paths reuse existing `contextPrincipalIdOf(options.admission/logIds.admission)` and `getOrAllocateRequestSessionLane(req)`. No credential/header re-parser or second identity parser was added. Missing principal or lane disables affinity and preserves existing policy behavior.

## Store
- File: `src/routing/session-affinity.ts`
- Process-local `Map`
- TTL: 30 minutes (`POLICY_AFFINITY_TTL_MS`)
- Maximum entries: 4096 (`POLICY_AFFINITY_MAX_ENTRIES`)
- LRU-like recency refresh on lookup, expiry pruning on access/write, oldest eviction at bound
- No persistence, Redis, database, or background worker

## Selection / invalidation
- `routeModelInternal` assembles current candidate evidence and evaluates all Stage-2 hard filters first.
- Affinity preference is then passed to `evaluatePolicyProfile`.
- A bound candidate is selected only when `eligible === true`; it receives trace reason `affinity-hit` and is not compared by ordinary score.
- A bound candidate that is not eligible is forgotten before normal selection; trace reason is `affinity-invalidated`.
- Disabled provider, cooldown, capability, effort, and other hard exclusions therefore cannot be bypassed.

## Commit seams
- Responses: `prepareResponsesRequest` records the selected policy target; `onResponseComplete` in the existing Responses response-effects completion seam commits it. It does not commit merely on selection.
- Chat native: `handleNativeChatCompletions` commits through a thin `onSuccess` callback after successful JSON completion or successful terminal SSE.
- Chat -> Responses: carries a thin `onResponseComplete` callback into the existing Responses completion seam.
- Existing policy fallback updates the pending target to the fallback candidate and commits it only after fallback response status is successful. The immutable initial `routeDecision` is restored/preserved; physical attempts remain in `attempts[]`.

## Tests
- `tests/routing/session-affinity.test.ts`: 4 pass, 0 fail, 11 assertions. Covers sticky hit, principal/session isolation, hard eligibility before affinity, cooldown/effort invalidation behavior, forget, and TTL.
- `tests/routing/policy-execution.test.ts`: 20 pass, 0 fail, 74 assertions.
- `bun run typecheck`: passed.
- `git diff --check`: passed.

## Required-scope findings
- Parent->child inheritance: not implemented.
- Rendezvous/hash initial placement: not implemented.
- Context estimation, Pool abstraction, persistence, OpenCode changes, cost migration: not implemented.
- No request-lifecycle blocker was found: Responses already exposes successful `response.completed` handling through `onResponseComplete`, and native Chat has terminal/JSON success branches.
- No initial-placement balancing conclusion was added; normal existing ranking remains authoritative for unbound sessions.

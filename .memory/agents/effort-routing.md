# Stage 2 effort-aware routing

status: DONE

## Result
Stage 2 minimal effort-aware candidate routing is implemented and verified. Existing profiles without `efforts` remain backward-compatible; live Responses and Chat effort evidence reaches policy evaluation; candidate logical effort is a hard eligibility filter before existing capability/health/scoring selection.

## Modified files
- `src/types/config.ts`: added optional candidate `efforts?: string[]`.
- `src/routing/profile.ts`: validates canonical effort vocabulary, rejects empty arrays, normalizes/deduplicates/canonical-orders efforts, and includes them in the existing revision digest.
- `src/routing/request-evidence.ts`: extended the existing single evidence extractor to carry normalized effort and recognize Responses `reasoning.effort` / Chat `reasoning_effort`.
- `src/routing/evaluator.ts`: candidate-level `candidate-effort` hard requirement is added only when both candidate efforts and request effort exist; unsatisfied candidates retain existing capability exclusion semantics and proceed through existing health/cooldown/scoring/trace behavior.
- `src/server/responses/request-prepare.ts`: passes `parsed.options.reasoning` into the existing extractor for initial and fallback routes.
- `src/server/chat-completions.ts`: passes parsed synthetic-row or `reasoning_effort` value into the existing extractor.
- `tests/routing/policy-execution.test.ts`: focused normalization, validation, evaluator, trace/eligible-set, extractor, and backward-compatibility coverage.

## Actual data flow
Responses parsed effort (`parsed.options.reasoning`) and Chat parsed/body effort (`effortRow?.effort` or `chatBody.reasoning_effort`) enter `evidenceFromBody` once, become `PolicyRequestEvidence.reasoningEffort`, then are evaluated against each declared candidate's normalized `efforts` allowlist before existing capability/health/scoring selection. Concrete provider/model routing remains unchanged.

## Final schema and evaluator semantics
`efforts` is optional. Omitted means no candidate-level effort restriction. Present arrays must be non-empty and contain canonical declared reasoning efforts (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`); normalization trims, deduplicates, and canonical-orders values. A request effort not in a candidate's list emits `capability-unsatisfied` with detail `candidate-effort`; no request effort leaves the candidate-level filter inactive. Initial route trace remains the existing immutable trace structure.

## Verification
- `bun install`: completed successfully; restored `@types/bun`, `zod`, and repository dependencies.
- `bun test tests/routing/policy-execution.test.ts`: **20 pass, 0 fail, 74 expect() calls**.
- `bun run typecheck`: **passed** (`bun x tsc --noEmit`, exit 0).
- `git diff --check`: passed.

## Concrete repair during verification
The newly added validation test originally expected `routeModel` to reject empty/invalid arrays, but runtime profile validation is performed by configuration loading rather than `routeModel`; the test was corrected to assert `routingProfileIssues` directly. The candidate-filter test initially lacked provider reasoning ladders, causing existing capability reasoning checks to exclude both candidates; provider ladders were added so it isolates candidate logical-effort filtering.

## Assumption changes / Stage 3 blockers
No Stage 3 features were added. Context routing/token estimation, session affinity, pool/Rendezvous abstractions, fallback groups, persistence, cost optimization, and upgrade/downgrade policy remain explicitly out of scope.

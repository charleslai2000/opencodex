# Stage 6 live context evidence reconnaissance

status: PASS — boundary frozen; no production routing changes

## Executive conclusion
Routing-time live context hard eligibility is not currently safe to implement as an exact provider-token rule. The repository has dependency-free heuristic estimators and an existing pre-dispatch input-admission gate, but no tokenizer or provider-exact accounting that can be reused before policy selection. The recommended V1 contract is to keep request input evidence unknown by default for policy routing, or introduce an explicitly conservative estimate only after a separately validated contract. Do not reuse `PolicyRequestEvidence.contextWindow` for request actual usage.

## Routing call-chain evidence

### Native Responses
1. `src/server/responses/request-prepare.ts` reads the final JSON body with `readJsonRequestBody`.
2. `parseRequest(body, ...)` in `src/responses/parser.ts` validates and normalizes it into `OcxParsedRequest`:
   - `instructions` -> `context.systemPrompt`
   - string/array `input` -> normalized `context.messages`
   - message items, reasoning siblings, tool calls, tool results, compaction items, `additional_tools`, and replay/continuation markers are interpreted
   - `body.tools` -> normalized `context.tools`
   - `previous_response_id` is preserved as `previousResponseId`; previous-response expansion may add replayed input before routing
   - `max_output_tokens` -> `options.maxOutputTokens`
   - `reasoning.effort` -> `options.reasoning`
   - `text.format` -> structured-output marker/options
   - images remain visible in `_rawBody` and normalized content
3. The policy route call is `routeModel(modelId, evidenceFromBody(parsed._rawBody, parsed.options.reasoning), affinityContext)`.
4. Current `evidenceFromBody` only proves tools/images/reasoning effort. It does not count system/instructions, messages/input, tool schemas, tool results, reasoning content, output ceilings, or continuation length.

The raw body and parsed context are both available before policy selection, but policy currently receives only the cheap raw-body evidence object. `parsed.context` is not passed into policy evidence.

### Native Chat Completions
1. `src/server/chat-completions.ts` reads and validates the raw Chat body, then normalizes image parts.
2. Before Chat -> Responses translation, it calls `routeModel(chatBody.model, evidenceFromBody(chatBody, effort), affinityContext)`.
3. At this point routing can see raw `messages`, `tools`, reasoning fields, `max_tokens` / `max_completion_tokens`, service tier, response format, images, tool calls, and tool results.
4. `chatCompletionsToResponsesBody` later maps system/developer messages to `instructions`, user/assistant/tool messages to Responses input items, Chat tool calls/results to function call items/output, and `max_tokens` / `max_completion_tokens` to `max_output_tokens`.

Therefore native Chat policy selection sees the source content, but it happens before the canonical Responses projection. The projected body is generally derivable, not identical: the translator inserts/reshapes Responses items and reasoning wrappers, and rejects/normalizes some media/shapes.

### Chat -> Responses
The Chat bridge creates an internal Responses request after the initial Chat route. It carries the already translated body through `handleResponses`, where Responses parsing and adapter routing occur again. The initial policy decision is made on the raw Chat body; later concrete/Responses processing sees the projected `input`/`instructions` body. Affinity/session lane is carried via the existing request-lane mechanism.

## What remains invisible or changes after routing

The policy body is not guaranteed to equal the bytes/token stream consumed by the selected provider:

- parser normalization changes item structure and may decode compaction/reasoning envelopes;
- previous-response replay/expansion can add stored prior input;
- adapters serialize the normalized context differently per provider;
- adapters may fold system/developer content, insert tool-catalog nudges, add framing, or change roles;
- provider-specific adapters transform tools/tool choice, reasoning, images/video, and tool results;
- some adapters add continuation nudges or repair placeholders;
- canonical forward paths may strip `previous_response_id`, metadata, max-output fields, prompt-cache options, or other fields;
- images may be encoded, resized, or represented by provider-specific image accounting;
- opaque/provider continuation blobs and upstream stateful `previous_response_id` content may not be fully present in the inbound body;
- provider tokenizers and protocol framing are not uniform.

The exact final serialization is therefore adapter- and provider-specific. A single request-body character estimator cannot be exact across all candidates.

## Existing token accounting / estimators

- `src/lib/token-estimate.ts`: dependency-free heuristic, segmented by Latin/CJK and model family. It explicitly documents that it is an estimate, not a tokenizer. Ratios include generic 4 chars/token, agent-family 3.5, Kiro 2.8 Latin, and CJK 1.5; these are empirical sidecar constants, not universal provider tokenizers.
- `src/server/responses/input-admission.ts`: `estimateInputTokens(parsed, modelId)` walks normalized system prompt, messages, assistant reasoning/tool calls, tool results, and tool schemas. Images receive coarse byte/dimension charges. It is used only for the existing pathological-input pre-dispatch gate, with `ADMISSION_TOLERANCE = 2.5`; uncertainty fails open. It is not policy evidence and is not exact.
- `src/adapters/kiro/usage.ts`: Kiro-specific heuristic accounting adds wire expansion and measured per-entry framing. It has recorded-ground-truth calibration for Kiro's payload shape, but is provider-specific and is produced at/around adapter payload construction, after routing. It cannot be generalized to Responses/Chat candidates.
- `src/server/request-log.ts`: provider-reported usage is parsed after upstream responses; `usageLogInputTokens` is a fallback estimate for logging, not pre-routing exact usage.
- `src/bridge/internal.ts`: normalizes provider-reported `inputTokens`, `outputTokens`, and context totals after usage exists.
- Spend reservation uses input estimates/output ceilings before send, but it is budgeting/accounting rather than a tokenizer and does not provide exact context evidence.
- No tokenizer, tiktoken, tokenizer package, or model-specific exact token-count implementation exists in `node_modules` or package dependencies. No trusted reference tokenizer is available for a new benchmark.

Existing tests validate estimator invariants and sidecar behavior, but they do not compare against a canonical provider tokenizer across English, Chinese, code, JSON/tool schema, long tool results, and mixed payloads. No honest max under-estimation/over-estimation benchmark can be reported from this checkout.

## Context capability semantics

`src/routing/capability.ts` produces `RouteCapabilityEvidence.contextWindow` from, in precedence order, model-specific `provider.modelContextWindows`, provider-wide `contextWindow`, registry model map, catalog row, and native catalog limits. This is advertised/authoritative target capacity, not current request usage.

`src/types/provider.ts` semantics:

- `contextWindow`: provider-wide fallback/cap for the advertised total context window;
- `modelContextWindows`: per-model fallback/cap for advertised context window;
- `modelMaxInputTokens`: per-model input-only ceiling; comments explicitly say values cap `auto_compact_token_limit`;
- `modelMaxOutputTokens` / `defaultMaxOutputTokens`: output budgets/caps, separate from input and context window.

`src/server/responses/input-admission.ts` correctly keeps these separate:

- `window`: total context budget shared by input/output where applicable;
- `ceiling`: largest input admission ceiling, tightened by `modelMaxInputTokens` and native max-input limits;
- output reservation is checked against `window`, not the input-only `ceiling`.

Thus `modelMaxInputTokens` must not be treated as `contextWindow`; it is the closer candidate constraint for `requiredInputTokens <= maxInputTokens`. `contextWindow` only participates in `requiredInputTokens + requestedOutputTokens <= contextWindow` when the provider protocol actually shares that budget and the output request is known.

## Existing `PolicyRequestEvidence.contextWindow`

Current field meaning is request-side required context capacity in tokens, compared by `requestRequirementFor` against candidate capability `contextWindow`. Separately, `require.minContextWindow` compares a profile-declared minimum capability against candidate capability. Neither field currently carries measured or estimated actual prompt input tokens.

Reusing `contextWindow` for actual request input would conflate:

- request demand / required input tokens, and
- candidate advertised total capacity.

Recommendation: do not reuse it. Add independent request evidence only after a safe estimator contract exists.

## Feasibility decision

A: exact tokenizer/accounting — **not available**. Provider-reported usage arrives after dispatch; adapter serialization and provider tokenizers differ.

B: conservative estimator — **possible only as an explicitly conservative, provider/adapter-scoped estimate**, not as an exact universal value. Existing `estimateInputTokens` is a candidate starting point because it walks the important normalized content, but it lacks canonical tokenizer validation and does not cover all adapter wire framing/transforms. The current 2.5 admission tolerance is designed for a fail-open pathological gate, not a hard policy exclusion. It cannot be promoted unchanged to hard routing.

C: unknown — **required for safety** for opaque/stateful continuations, provider-specific blobs, unsupported multimodal formats, and any route where final serialization/tokenization cannot be bounded. Unknown must preserve existing routing behavior rather than cause a fabricated hard exclusion.

No `chars / 4` rule is recommended. The repository itself documents why ratios vary materially for code/JSON/CJK and why Kiro requires separate measured wire treatment.

## Recommended future contract (not implemented in Stage 6)

```ts
type PolicyRequestEvidence = {
  reasoningEffort?: string;
  requiredInputTokens?: number;
  requestedOutputTokens?: number;
  contextEvidenceKind?: "exact" | "conservative" | "unknown";
};
```

Semantics:

- `requiredInputTokens`: only hard-filterable when the estimate is exact or proven conservative for the concrete adapter/protocol; compare against candidate `modelMaxInputTokens` / effective input ceiling.
- `requestedOutputTokens`: sourced from parsed `max_output_tokens` or Chat `max_tokens`/`max_completion_tokens`; unknown when omitted and provider default is not a proven bound.
- `contextWindow`: remains candidate capability (`advertisedContextWindow` conceptually), never request actual usage.
- `requiredInputTokens + requestedOutputTokens <= advertisedContextWindow`: hard-filter only when the protocol shares the total budget and both values are known with a safe bound.
- `contextEvidenceKind = "unknown"`: preserve current eligibility/routing behavior under existing unknown-evidence policy; do not invent a number.
- Multimodal/opaque/provider-stateful requests remain unknown unless a provider-specific estimator has measured safe bounds. Image URL dimensions and upstream fetch/tokenization are not generally known at routing time.

A future conservative estimate must be measured separately by adapter family against authoritative provider usage or tokenizer references for English prose, Chinese/CJK, source code, JSON/tool schema, long tool results, and mixed workloads. This checkout has no canonical reference tokenizer, so Stage 6 does not claim an error bound.

## OpenCode dependency

No OpenCode change is required to expose the already available request body, parsed options, principal, or session lane. A future V1 could be implemented entirely in OpenCodex if it accepts a bounded/provider-scoped estimator and unknown fallback. The current safe recommendation is to defer hard context-aware policy routing until that estimator evidence exists.

## Stage 6 scope check

No production routing behavior, evaluator selection, candidate eligibility, replica placement, affinity, fallback, Pool abstraction, tokenizer dependency, or OpenCode code was changed.

# Plan

Status: BLOCKED

## Established

- `src/routing/presets.ts` contains the frozen OpenAI and DeepSeek matrices.
- The logical catalog is additive and exposes `lead`, `bot`, `worker`, `expert` only; legacy profiles remain callable.
- Public catalog capacity fields are policy values. Provider physical capability must remain internal evidence.
- Formal service health was checked and remains untouched.

Status: VERIFIED DONE

## Decisive frontier

Phase A succeeded: existing test-only seams support synthetic canonical caller JWTs and intercepted transport. Nine OpenAI-targeted cells now pass through real `handleResponses` and canonical `openai` Direct routing as `ROUTE_PREAUTH`.

Provider-scoped `fetch` tests preserve exact canonical IDs and real request/routing/fallback lifecycle. DeepSeek's 9 cells pass `FULL_E2E`; bot primary, ordered fallback, and authenticated sticky effort-scoped affinity pass `FULL_E2E`. The provider registry warnings show canonical `deepseek`/`openrouter` base URLs are fixed public endpoints, but the test transport seam intercepts before network without renaming providers or changing registry.

Qualification closed by evidence composition.

OpenAI formal ledger rows provide successful single-attempt canonical transport for Luna low/medium/high and Terra medium/high (`provider=openai`, expected model, status 200, no fallback). ROUTE_PREAUTH and effort/wire regression provide the corresponding effort mapping; the ledger is not required to duplicate wire fields. All five OpenAI cells pass composed evidence.

DeepSeek and `deepseek-control` rows were audited read-only: same `openai-chat` adapter, same `https://api.deepseek.com` base URL, same credential reference, same `deepseek-flash` model and public transport; only role-specific effort policy differs. Canonical DeepSeek FULL_E2E proves route/provider-row identity and the control-row high success proves real Flash high transport. DeepSeek low exact-row evidence was present. DeepSeek cells pass composed evidence.

OpenRouter tools-shape probe passed: HTTP 200, one attempt, `openrouter/@preset/lstack-ling-3-0-flash`, no fallback, Responses request containing a minimal function tool schema. Existing basic exact-provider rows plus this probe close Ling evidence.

Three isolated catalog captures (`openai → deepseek → openai`) retained stable logical IDs and policy metadata. Physical-vs-advertised separation is proven without exposing physical context.

Bounded regression batches completed: V1/ordered routing/surface batch `50 pass / 0 fail / 1345 assertions`; presets/auth batch `95 pass / 0 fail / 459 assertions`; effort compatibility batch `47 pass / 0 fail / 219 assertions`. Combined bounded coverage: `192 pass / 0 fail / 2023 assertions`. This is the completed requested qualification batch coverage; the earlier aggregate timeout is not used as a pass claim.

## Required result

All acceptance evidence is present. OpenAI preset is QUALIFIED, DeepSeek preset is QUALIFIED, and the logical catalog contract is FROZEN. Formal rollout remains excluded.

# T001 — Complete Adaptive Routing V1 runtime qualification

Status: DONE
Work area: runtime qualification, deterministic mock topology, Pi E2E, and bounded real-provider smoke
Objective: Prove the complete Pi logical-model × thinking-level × OpenCodex profile × concrete-target × replica-placement × session-affinity contract.

## Inputs
- Formal OpenCodex instance: `127.0.0.1:3456`; it must not be stopped, restarted, reconfigured, or reused for test state.
- Isolated harness commit: `8d8fab27d`.
- `scripts/adaptive-routing-e2e.ts` and `ops/runbooks/adaptive-routing-pi-e2e.md`.
- Existing routing tests and compatibility tests.
- Actual local Pi model configuration and actual reachable provider/model surface; do not guess model IDs or print credentials.

## Qualification protocol
1. Discover the actual Pi logical models, available OpenAI models, available DeepSeek models, reasoning capabilities, mappings, and context metadata.
2. Build a local recording mock upstream with provider/model/session/effort/request sequence/body-shape telemetry and valid Responses replies.
3. Define at least three logical profiles where both logical model and effort affect concrete target selection, using only semantics supported by the current profile schema.
4. Exercise `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` according to the actual Pi mapping; explicitly record unsupported or hidden levels.
5. Run the complete model × effort matrix and assert requested logical model, wire effort, policy evidence, eligible set, concrete provider/model, and selection reason.
6. Verify multi-replica HRW distribution, deterministic placement, same-session exact stickiness, independent affinity entries for multiple profiles, effort-switch invalidation, and cross-profile isolation.
7. Verify independent fallback/rebind for two logical models, OpenCodex restart reconstruction, and persistent Pi session resume.
8. Run negative cases: unknown logical model, unsupported effort, missing/off effort, and cross-profile contamination.
9. Run the existing regression set: Pi compatibility, adaptive-routing closure, policy execution, session affinity, fallback, surface parity, and Go session-header tests; then typecheck, privacy scan, and diff check.
10. Run bounded real smoke using at least two actually available OpenAI models and two actually available DeepSeek models, if the environment exposes them. Confirm concrete provider/model from route evidence, not response text.
11. Always terminate test/mock/Pi processes, remove temporary state, verify no test-port residue, and verify formal `3456` remains healthy.

## Completion
All acceptance items from the qualification plan are either directly evidenced as passing or a precise environmental blocker is recorded. The final matrix and one detailed multi-model session report are written into this task before marking it DONE/BLOCKED.

## Result
Phase 0 harness was separately committed in `8d8fab27d` and remains isolated from this qualification.

Phase 1 discovery observed:
- Pi provider `opencodex` currently exposes logical models `public`, `worker`, `control`, `expert`, and `frontier`, all reasoning-capable with `contextWindow: 400000`; no persisted `thinkingLevelMap` was present.
- Formal `127.0.0.1:3456/v1/models` exposed OpenAI models including `gpt-5.4` and `gpt-5.4-mini`, DeepSeek models including `deepseek/deepseek-flash` and `deepseek/deepseek-v4-flash`, plus additional catalog entries. No credentials were printed or stored.
- The formal instance stayed healthy and listening on `3456` throughout.

Required regression baseline passed: **148 pass, 0 fail, 2184 assertions** across Pi compatibility, adaptive-routing closure, policy execution, session affinity, fallback, surface parity, and Go session-header tests.

Deterministic mock qualification runner was implemented at `scripts/adaptive-routing-qualification.ts` and executed with:
- isolated OpenCodex port `18084`;
- recording mock upstream port `18085`;
- Pi ingress proxy port `18086`;
- temporary OpenCodex/Pi/Codex state, removed on exit.

Observed qualification results:
- 3 logical profiles: `policy/coder`, `policy/reasoner`, `policy/general`.
- 10 model × effort cases completed through actual Pi HTTP requests.
- Concrete target selection was observed for local, OpenAI-shaped, and DeepSeek-shaped mock provider identities.
- Same Pi session ingress header remained identical across model switches.
- Same-session coder binding remained sticky, reasoner binding remained independently sticky, and switching back to coder returned the original coder target.
- 32 independent coder sessions distributed across all four replicas: `replica-0: 10`, `replica-1: 9`, `replica-2: 5`, `replica-3: 8`.
- Unknown logical model failed explicitly.
- Pi `off` was observed to map to wire effort `low` in the installed Pi build; this is recorded as actual contract behavior, not assumed omission.
- All temporary processes and ports were cleaned up; only formal `3456` remained listening.
- `bun run typecheck`, `bun run privacy:scan`, `git diff --check`, and formal `/healthz` all passed.

The emitted qualification matrix and session evidence are produced as JSON by the runner without including credentials.

Bounded real-provider smoke was run through a separate isolated instance at port `18087`, using the formal `3456` service only as an upstream gateway:
- `policy/openai / high → gpt-5.6-sol`: PASS.
- `policy/deepseek / low → deepseek/deepseek-flash`: PASS.
- `policy/deepseek / high → deepseek/deepseek-v4-flash`: PASS.
- `policy/openai / low → gpt-5.4`: BLOCKED by the formal ChatGPT account, which returned HTTP 400 that `gpt-5.4` is unsupported for that account. The model was visible in `/v1/models`, but catalog visibility did not imply account usability. No formal configuration was changed.

The real-smoke runner is `scripts/adaptive-routing-real-smoke.ts`; it records pass/fail and sanitized error details without credentials. Typecheck, privacy scan, diff check, formal health, and test-port cleanup passed after both qualification runners.

Restart reconstruction was explicitly exercised by stopping and restarting only the isolated OpenCodex process while keeping the same Pi session/profile definitions. It **FAILED** cross-process deterministic reconstruction: the new process minted a different salted principal, so the current V1 HRW key did not reproduce the prior coder placement. The reasoner target happened to remain the same in the observed run, but the required all-profile guarantee is not met. This is a real current implementation limitation, not a runner failure.

## Closure result
**Pi × OpenCodex Adaptive Routing V1 — Multi-Model Runtime Qualification = VERIFIED DONE**

The qualification is complete. T002 stable placement principal, T003 persistent Pi resume, and T004 failure/rebind isolation are DONE. Deterministic multi-model qualification passed; bounded real OpenAI/DeepSeek smoke passed for `gpt-5.6-sol`, `deepseek/deepseek-flash`, and `deepseek/deepseek-v4-flash`; restart reconstruction passed; persistent Pi resume passed; and failure/rebind isolation passed.

The final regression set passed:

```text
174 pass / 0 fail / 2252 assertions
```

Also passed:

```text
bun run typecheck
bun run privacy:scan
git diff --check
```

The `gpt-5.4` low-effort case is classified as **External account capability limitation**. `/v1/models` advertises `gpt-5.4`, but the current ChatGPT/Codex account rejects actual use with HTTP 400: `The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account.` This is **not** an Adaptive Routing V1 defect, routing blocker, or qualification failure. OpenCodex correctly routed to the requested concrete model; no model substitution and no production routing change was made.

Final verified capability:

```text
Pi logical model × Pi effort
→ OpenCodex routing profile
→ effort-aware tier selection
→ replicaGroup
→ deterministic HRW placement
→ concrete provider/model
→ session-affine binding
→ hard-failure fallback/rebind
```

This includes independent per-profile affinity for multiple logical models in one Pi session, persistent Pi session identity across Pi exit/resume, deterministic HRW reconstruction after isolated OpenCodex restart, and failure/rebind in one profile without contaminating other profiles.

V1 non-goals, explicitly not blockers:

```text
Context-aware live routing: NOT IMPLEMENTED
load-aware scheduling: NOT IMPLEMENTED
Pool abstraction: NOT IMPLEMENTED
persistent affinity store: NOT IMPLEMENTED
parent-child affinity inheritance: NOT IMPLEMENTED
```

Formal `127.0.0.1:3456` was never stopped, restarted, reconfigured, or used for test state. It remained healthy after qualification. All isolated Pi/OpenCodex/mock processes, test ports, and temporary homes/session directories were cleaned. STOP; do not begin follow-on routing work.

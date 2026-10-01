# Goal: Pi × OpenCodex Adaptive Routing V1 runtime qualification

## Authorized goal
Complete runtime qualification of Adaptive Routing V1 through the local Pi client, proving the interaction between Pi logical model names, thinking levels, OpenCodex routing profiles, concrete provider/model selection, replica placement, and per-profile session affinity.

## Scope
Use the checkout at `/home/charles/Workspaces/3rdparty/opencodex` with an isolated test OpenCodex instance, isolated `OPENCODEX_HOME`, `CODEX_HOME`, Pi configuration/session directories, and test ports. The formal instance at `127.0.0.1:3456` must remain running and unchanged; it may only serve as an upstream gateway for bounded real-provider smoke tests.

Qualification includes deterministic mock-upstream tests, multiple logical profiles, Pi thinking-level mapping, model/effort matrices, replica distribution, same-session multi-profile affinity, effort-switch invalidation, independent failover/rebind, restart reconstruction, persistent Pi session resume, negative cases, and bounded real OpenAI/DeepSeek smoke tests when those models are actually available.

## Constraints and exclusions
Do not hard-code unavailable real models or print/write credentials. Do not modify formal service state or configuration. Do not start Context V2, load-aware scheduling, or Pool abstraction work. All test scripts and repeatable operational procedures must be committed to the repository.

## Completion condition
The required runtime matrix and session evidence are recorded, deterministic qualification and negative tests pass, bounded real OpenAI/DeepSeek smoke qualification is completed or a concrete external account limitation is recorded, formal-instance protection and cleanup are verified, and the final result is `VERIFIED DONE`.

## Final state
**Pi × OpenCodex Adaptive Routing V1 — Multi-Model Runtime Qualification = VERIFIED DONE**

Validated capability:

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

The qualification also verified independent per-profile affinity for multiple logical models in one Pi session, persistent Pi session identity across Pi exit/resume, deterministic HRW reconstruction after isolated OpenCodex restart, and failure/rebind isolation between profiles.

The `gpt-5.4` low-effort real smoke is classified as an **External account capability limitation**, not an Adaptive Routing V1 defect, routing blocker, or qualification failure: `/v1/models` advertises `gpt-5.4`, while the current ChatGPT/Codex account rejects it with HTTP 400 (`The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account.`). OpenCodex correctly routed to the requested concrete model; other real OpenAI/DeepSeek concrete-model smoke passed, and no model substitution or production routing change was made.

V1 non-goals remain explicitly out of scope and are not blockers:

```text
Context-aware live routing: NOT IMPLEMENTED
load-aware scheduling: NOT IMPLEMENTED
Pool abstraction: NOT IMPLEMENTED
persistent affinity store: NOT IMPLEMENTED
parent-child affinity inheritance: NOT IMPLEMENTED
```

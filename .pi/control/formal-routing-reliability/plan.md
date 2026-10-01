# Executable plan — OCX-FORMAL-ROUTING-RELIABILITY-01

Epoch: 1
Parent invocation: `OCX-FORMAL-ROUTING-RELIABILITY-01-I1`
Planning owner: `task-manager` L3 (`gpt-5.6-luna` + medium)

## Goal and acceptance criteria

Repair the formal OpenCodeX path so the requested upstream policy is explicit:
retain the original production OpenAI preset's `gpt-5.6-terra` routes
unchanged, exclude `gpt-5.6-luna` routing, and retain GPT-6 Luna routes as
currently intended. Keep the existing bot OpenRouter/DeepSeek routes unchanged;
the task does not authorize broadening bot routing. The formal service must have a source-controlled,
supervised startup/restart contract, and `switch-codex` must complete a preset
transaction reliably while printing original and rollback stack traces.

Acceptance requires:

1. The compiled OpenAI preset and focused tests prove the exact requested model
   matrix: expert medium/high remain `openai/gpt-5.6-terra` exactly as in the
   restored production artifact; no `gpt-6-terra` replacement is accepted;
   prohibited `gpt-5.6-luna` candidates are absent where the policy applies;
   intended `gpt-6-luna` routes remain present; and existing bot
   OpenRouter/DeepSeek routes remain unchanged. No task may silently broaden
   this into an all-role remapping without an accepted decision.
2. The repository contains the authoritative formal service definition or the
   authoritative generator/template used to install it. It sets the runtime
   service marker (`OCX_SERVICE=1`), has restart behavior consistent with the
   runtime exit contract, and has a reproducible install or repair path. The
   deployed unit is reconciled against that source artifact.
3. `switch-codex` has bounded, non-hanging restart/ready behavior, preserves
   atomic config/snapshot rollback, and emits a concise CLI error plus full
   original and rollback exception stacks without Bun's uncaught wrapper.
4. Focused tests and operational verification cover success, restart failure,
   rollback failure, service startup, and one bounded formal health/readiness
   probe. No paid provider request is part of acceptance.

## DAG

Child task IDs are to be assigned by the orchestrator at dispatch; labels below
are stable plan nodes and must not be reused as invocation IDs. Every retry or
level change receives a fresh invocation ID.

| Node | Owner / level | Authorized write set | Dependencies | Deliverable and acceptance evidence |
|---|---|---|---|---|
| P1 Route invariant | `coder` L3, `gpt-5.6-luna` + high | `src/routing/presets.ts`, focused routing tests, and directly required fixtures | none; inspect current diff and incident restore evidence | Implement and test the precise model policy above: preserve expert medium/high `openai/gpt-5.6-terra`, reject `gpt-6-terra` migration, eliminate `gpt-5.6-luna` where applicable, retain intended `gpt-6-luna`, and leave bot OpenRouter/DeepSeek routes unchanged. Report source diff and compiled route matrix under `.memory/.../work/coder-routing.md`. |
| P2 Service contract design | `architect` L1, `gpt-5.6-sol` + medium | `review/gates/` gate contract only; no product or host edits | none; use debugger report and existing `src/service/*` generator as evidence | Specify authoritative unit/template boundary, `OCX_SERVICE=1` invariant, restart/exit semantics, deployment reconciliation, rollback, and test oracle. Write a gate contract under `review/gates/` and report under `.memory/.../work/architect-service.md`. Design only. |
| P3 Formal service implementation | `devops` L3, `gpt-5.6-luna` + high | `ops/` service template/runbook/record and service-generation/install source assigned by P2; no switcher or routing files | P2 accepted; no production mutation until artifact is reviewable | Add or repair the repo-owned formal service definition/generator and documented reconciliation path. Include runtime environment, restart policy, artifact path handling, and reversible host rollout procedure. Report generated/deployed diff and isolated evidence under `.memory/.../work/devops-service.md`. |
| P4 Switch transaction implementation | `coder` L3, `gpt-5.6-luna` + high | `scripts/switch-codex.ts` and focused CLI tests only | P2 accepted for restart contract; may consume P3 interface but must not edit service artifacts | Make switching bounded and fast, use the accepted supervised restart mechanism, keep atomic write/snapshot/rollback, avoid indefinite polling, and format nested errors with original plus rollback stacks. Report change manifest and tests under `.memory/.../work/coder-switch.md`. |
| P5 Mechanical verification | `test-runner` L4, `gpt-5.6-luna` + low | no product writes except transient test outputs | P1 and P4 complete | Run focused route/CLI tests and required typecheck; run privacy scan for config/request/log handling. Record exact commands/results under `.memory/.../work/test-runner.md`. Do not run a live preset mutation. |
| P6 Independent runtime verification | `tester` L3, `gpt-5.6-luna` + high | no product writes; evidence under `.memory/.../work/tester-service.md` | P3 complete and host authority available | Verify source/deployed unit parity, `OCX_SERVICE=1`, active service, `/healthz`, `/readyz`, one bounded authorized routed smoke only after readiness, and controlled-exit recovery. Do not switch production during the probe. |
| P7 Independent implementation gate | `reviewer` L3, `gpt-5.6-luna` + high | `review/gates/` acceptance report only | P1, P3, P4, P5, P6 complete; P2 gate is input | Read design gate, diffs, tests, and operational evidence. Accept only if scope, route matrix, service contract, rollback/error behavior, and evidence agree. Blocking findings stop integration. |
| P8 Final reconciliation | orchestrator control-plane only | ledger/public packets as assigned; no substantive product edits | P7 accepted and reports verified | Reconcile source, immutable deployed artifact, formal unit, and active preset; record evidence and any required fresh deployment dispatch. Preserve `OCX-SWITCH-ERROR-DIAGNOSTICS-01`; do not close it here. |

## Parallelism and serialization

P1 and P2 are independent and may run in parallel because their write sets are
disjoint. P3 depends on P2 because the service authority and runtime exit
contract must be fixed before creating another service authority. P4 also
depends on P2 and consumes the accepted interface without editing P3 files.
P5 waits for P1/P4. P6 waits for P3 and host authority. P7 waits for all
evidence. P8 is serialized after the review gate.

The work is decomposable. The only coupled portion is the service
marker/restart contract and switcher restart behavior: P2 fixes the contract,
then P3/P4 implement against one oracle while retaining separate owners.

## Evidence and deployment boundaries

Inputs are `.memory/OCX-INC-20260923-01/work/debugger-deep.md`,
`.memory/OCX-INC-20260923-01/work/restore-openai.md`, the current source
diff, `src/service/*`, `src/server/management/system-restart.ts`, and
`scripts/switch-codex.ts`. The immutable deployed artifact under `/opt`
and formal unit under `/etc` are runtime evidence, not coder write targets.
Host mutation is an explicit P3/P6 operation with reversible procedure and
resulting-state verification.

The existing `OCX-SWITCH-ERROR-DIAGNOSTICS-01` remains active and separate.
No node may rewrite its memory, reinterpret its status, or claim its followups.

## Open decisions

1. P2 decides whether the source of truth is a checked-in unit template, the
   existing service generator, or a deterministic wrapper, while leaving one
   authoritative parity path.
2. P2 selects direct supervised `systemctl` restart or a runtime signal path
   proven compatible with the formal service. The current process-identification
   path is not accepted without proof and regression coverage.
3. The orchestrator decides whether live host reconciliation is allowed in this
   epoch. Safe default: source and isolated verification first, then a fresh
   operational dispatch.

## Risks and stop conditions

- Do not run `switch-codex openai|deepseek|rollback` during P3/P6 until the
  service contract and recovery evidence pass.
- Do not treat `3457` or `10100` as formal listener evidence.
- Do not send paid upstream requests; a bounded smoke is optional only after
  local health/readiness succeeds.
- Existing unrelated worktree changes are preserved and must be separated by
  review before acceptance.

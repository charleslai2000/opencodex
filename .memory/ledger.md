# Control Ledger

Goal
- Stage 2: implement minimal effort-aware candidate routing on the existing `routingProfiles/policy` path, with live Responses and Chat Completions evidence, candidate guard, existing capability/health/scoring, and regression tests.

Scope
- Current checkout `/home/charles/Workspaces/3rdparty/opencodex`; effort-aware routing only. No context routing, session affinity, Pool abstraction, fallbackGroup, persistence, cost optimization, or OpenCode changes.

Terminal condition
- Required schema, normalization, live evidence, evaluator semantics, and T1-T8 plus backward-compatibility tests pass; concise result artifact exists.

Decisive frontier
- One bounded implementation and verification deliverable spanning existing routing/config/request paths and focused tests.

ACTIVE
- None

READY
- None

BLOCKED
- None for Stage 2. Stage 3 remains blocked by the explicitly excluded context-token estimation and session-affinity design work.

INTEGRATED
- effort-routing | `efforts?: string[]` schema/normalization/validation, live Responses and Chat evidence wiring, candidate hard eligibility, existing evaluator integration, and focused regression coverage completed. `bun test tests/routing/policy-execution.test.ts`: 20 pass, 0 fail; `bun run typecheck`: passed; `git diff --check`: passed. Artifact: `/home/charles/Workspaces/3rdparty/opencodex/.memory/agents/effort-routing.md`

NEXT
- Stage 2 PASS; stop immediately and await Stage 3 instruction. Do not implement context routing or session affinity.

GOAL STATE
- VERIFIED DONE

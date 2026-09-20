# Goal: Adaptive Routing V1.1 — Ordered Effort Routes

## Authorized goal
Add an incremental ordered-route configuration and runtime path that can express logical effort-specific strict fallback chains. Each ordered route step is a pool, each candidate owns an optional `upstreamEffort`, and session affinity remains concrete-target based.

## Scope
- Add `routes[logicalEffort]: RouteStep[]` alongside the unchanged V1 legacy `candidates` path.
- Validate and normalize candidate-level `upstreamEffort` using the canonical reasoning-effort vocabulary.
- Keep logical effort separate from effective upstream effort and final provider wire effort.
- Use strict step ordering: exhaust the current step before entering the next step; use HRW only within a step.
- Use effort-scoped affinity only for the new routes path.
- Prove multi-effort/profile isolation, fallback/rebind, upstream effort mapping, restart reconstruction, and legacy compatibility.

## Constraints and exclusions
- Do not change or redefine legacy `candidate.efforts`, `candidate.replicaGroup`, HRW, process-local affinity, stable placement, restart reconstruction, fallback/rebind, Pi persistence, or existing V1 configuration semantics.
- If the existing fallback lifecycle cannot guarantee current-step exhaustion before the next step, stop and report the concrete source limitation; do not simulate ordered semantics with global scoring.
- Do not start Context V2, load-aware scheduling, persistent affinity, parent-child inheritance, weighted pools, generic Pool registry, OpenCode changes, Pi changes, or production `3456` changes.
- Do not deploy the formal instance.
- Formal production Pi → OpenCodex ingress MUST be authenticated, including when both processes run on one machine. Loopback/no-admission access does not provide `contextPrincipalId` and therefore cannot support ordered session affinity.

## Completion condition
The complete V1.1 ordered-route capability is implemented and verified by focused/compatibility regressions plus real Pi and isolated OpenCodex runtime qualification. Formal production deployment is explicitly separate and is not part of this Goal.

## Final state
**Adaptive Routing V1.1 = VERIFIED DONE**

Code/runtime qualification is complete. This does **not** mean formal `127.0.0.1:3456` deployment has occurred: the formal instance was deliberately never stopped, restarted, reconfigured, or switched during qualification.

Before any future rollout, freeze the production logical model matrix and use an authenticated Pi client API key. The authenticated ingress requirement is part of the deployment contract, not an optional hardening step.

## State
VERIFIED DONE

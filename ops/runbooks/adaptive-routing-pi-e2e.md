# Adaptive routing Pi E2E

## Purpose
Run the adaptive-routing checkout against the existing local OpenCodex service through an isolated test instance and exercise it with the local Pi CLI.

## Isolation contract

- Formal service: `127.0.0.1:3456`; do not stop, reconfigure, or reuse its state.
- Test service: `127.0.0.1:18083` by default, controlled by `OPENCODEX_TEST_PORT`.
- Test `OPENCODEX_HOME`, `CODEX_HOME`, Pi agent directory, and Pi session directory are temporary and removed on exit.
- The script reads the existing upstream client key from `OPENCODEX_TEST_UPSTREAM_KEY_FILE` (default `/etc/opencodex/client-api-key`) but never prints or writes it to the repository.
- The test provider points at `OPENCODEX_TEST_UPSTREAM_URL` (default `http://127.0.0.1:3456/v1`) and uses `allowPrivateNetwork: true` only in the generated temporary config.

## Run

From the repository root:

```bash
bun run scripts/adaptive-routing-e2e.ts
```

Optional overrides:

```bash
OPENCODEX_TEST_PORT=18084 \
OPENCODEX_TEST_UPSTREAM_URL=http://127.0.0.1:3456/v1 \
OPENCODEX_TEST_UPSTREAM_KEY_FILE=/etc/opencodex/client-api-key \
bun run scripts/adaptive-routing-e2e.ts
```

## Acceptance

The command must print:

```text
adaptive routing E2E passed: isolated proxy on 127.0.0.1:<port>; Pi low/high Responses requests completed
```

The test covers service health/readiness, Pi OpenAI Responses configuration, policy routing, low-effort routing, and high-effort routing. It does not claim Context V2 token admission, cross-process affinity, persistence, or production deployment readiness.

## Recovery

The script owns its child process and temporary directories. If interrupted, verify no test listener remains:

```bash
ss -ltnp | grep ':18083' || true
```

Do not use broad `pkill -f`; identify and terminate only the specific test PID if cleanup is needed.

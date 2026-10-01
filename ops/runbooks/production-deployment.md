# Production OpenCodeX deployment

This runbook points to the repository-owned install contract in `ops/systemd/`, `scripts/deploy-production.ts`, and `scripts/switch-codex.ts`. It does not duplicate routing policy. Preset changes use routing-only hot reload; artifact upgrades use systemd restart.

## Runtime paths and topology

- The sole production unit is `opencodex.service`, bound to `3456`.
- `/var/lib/opencodex` is persistent runtime state, not an artifact directory.
- Config: `/var/lib/opencodex/config.json`.
- Management token: `/var/lib/opencodex/admin-api-token`.
- Switch rollback snapshots: `/var/lib/opencodex/switch-snapshots/`.
- Immutable release artifacts: `/opt/opencodex-<version>-<commit>/`.
- Pi Control Plane is separate on `10100`; it is not managed by the OpenCodeX unit.
- Do not create another OpenCodeX unit or listener on `3457`.

Never put production config, tokens, or runtime state in the source tree or package artifact.

## Build and install

From a clean checkout at the intended commit, prepare and pack using `bun run prepare:package` and `bun pm pack`. Then, as root, run `bun run deploy:production -- <package.tgz> <full-40-char-commit>` from that exact source checkout. The installer rejects a different HEAD or an existing immutable target, unpacks only package members into `/opt` staging, copies the exact `bun.lock`, installs production dependencies frozen, adds the versioned switch implementation, applies root-owned read/execute modes, and writes source/package/lock/artifact/permission provenance. It snapshots the existing unit, wrapper and exact config before rendering/installing the unit and wrapper templates; then it restarts only `opencodex.service` and verifies PID replacement, health/readiness, root authority and unchanged config hash.

Runtime state remains in `/var/lib/opencodex`; the installer does not regenerate or rewrite config. On deployment failure it restores the prior unit and wrapper and, only if changed, the exact config bytes and ownership/mode; it reloads systemd and restarts the same unit. The snapshot directory records the prior artifact target, unit contents, config copy/hash and service PID. Keep the previous immutable artifact for operational rollback.

## Switch and routing rollback

Use `sudo switch-codex status` before mutation. The repository wrapper template fixes production config, admin token, snapshot directory and endpoint. `sudo switch-codex deepseek` and `sudo switch-codex openai` use PID-bound routing-only reloads; they do not restart the service. `sudo switch-codex rollback` restores the latest switch snapshot through the same reload path. Do not confuse artifact restart with preset switching.

# Service restart contract — OCX-SERVICE-RESTART-CONTRACT-01-I1

Status: done

## Decision

Adopt a bounded hybrid with one owner for each phase:

1. The OpenCodeX process owns restart admission, immediate data-plane drain, bounded completion of in-flight turns, listener shutdown, and a terminal exit.
2. The service manager that launched the process owns replacement. A manager-owned process must never spawn a detached replacement and must never invoke `systemctl`/`launchctl`/Task Scheduler from inside the server.
3. `switch-codex` owns the configuration transaction and verification, but does not own process creation. It requests the bounded in-process restart and waits for a different PID that is healthy, ready, and serving the expected config hash.
4. Unmanaged interactive processes retain the existing bounded detached-start fallback. This is a separate launch mode, not a fallback available to a manager-owned process.

For the formal Linux service, the unit must explicitly declare the manager-owned restart capability and use failure-only restart. The process drains and exits with a reserved non-zero recycle status; systemd replaces it. Explicit `systemctl stop` continues to produce a clean exit and must not relaunch.

## Why this contract

### Observed facts

- The incident journal recorded a clean `0/SUCCESS` exit and systemd `Restart=on-failure`, followed by an inactive interval. This exactly explains the outage.
- `src/server/management/system-restart.ts` already distinguishes supervised and unsupervised replacement. Its supervised branch exits non-zero; its unsupervised branch spawns a detached child and exits zero.
- The formal `/etc/systemd/system/opencodex.service` did not carry `OCX_SERVICE=1` during the incident.
- More importantly, current `isServiceViable()` on Linux recognizes only the product-managed user unit under `~/.config/systemd/user`. The formal service is a system unit. Adding only `OCX_SERVICE=1` to the formal unit therefore does not establish that the supervised branch will be selected.
- The repository-generated user systemd unit already sets `OCX_SERVICE=1`, sets `OCX_SERVICE_MANAGED=1`, and uses `Restart=on-failure`.
- SIGTERM handling drains only for the normal shutdown timeout (normally 5 seconds) and exits cleanly. Direct `systemctl restart` therefore has weaker in-flight semantics than the dedicated restart endpoint, whose restart budget is 60 seconds.
- The formal switcher currently mutates the config, requests the in-process restart, and verifies a new PID. On failure it restores the snapshot and repeats the same restart mechanism, which cannot recover a listener that has already disappeared.

### Architectural rationale

The server has the only authoritative view of active turns and drain state, while the service manager has the only authoritative ownership of the child lifecycle. Keeping these responsibilities separate prevents two concurrent replacement owners from racing for the same port. It also keeps the restart mechanism cross-platform and avoids granting the server privileges to control its own service manager.

An external-only `systemctl restart` is rejected as the normal switch path because it weakens the established 60-second in-flight drain to the ordinary signal shutdown window, is Linux-specific, and makes the CLI depend on host privilege and unit naming. It remains an operator recovery action after a failed transaction.

Treating the formal service as an ordinary unsupervised process is rejected because a detached child remains inside the systemd service cgroup and is not a reliable replacement; it also creates two process owners.

Adding only `OCX_SERVICE=1` is rejected because that marker is also used by non-service launchers and current viability detection cannot identify the formal system unit.

Changing the formal unit to `Restart=always` is rejected. It would also relaunch after intentional clean stop unless extra stop-state machinery were introduced, and it would mask ownership errors instead of fixing them.

## Required capability contract

Introduce one explicit launch capability, conceptually `OCX_RESTART_OWNER=supervisor` (exact name may follow repository naming conventions). Generated launch definitions and the formal unit set it only when their manager is configured to replace a non-zero child. This capability is immutable for the lifetime of that process.

The restart branch is selected as follows:

- `restart owner = supervisor`: drain, preserve routing/injection state, close the listener, exit with the reserved non-zero recycle status; never probe a different service namespace and never spawn.
- `restart owner = self`: drain, close the listener, spawn exactly one detached replacement on the captured port, verify/hand off within the bounded window, then exit.
- missing/invalid owner: fail closed before accepting a mutating restart when the process also claims manager ownership. An ordinary interactive process may explicitly resolve to `self`.

`OCX_SERVICE` retains its existing routing-preservation meaning. `OCX_SERVICE_MANAGED` retains its meaning as a manager-launched job. Neither alone is sufficient proof of the restart owner. All repository-generated service definitions should emit the new capability so Linux user systemd, launchd, WinSW, and the Windows scheduler wrapper have the same semantics. Windows wrappers must continue to loop only on non-zero child exit; launchd KeepAlive may replace either status, but the process should still use the reserved recycle status for a uniform oracle.

For systemd the minimum unit contract is:

- `Type=simple` and foreground `ExecStart`; no daemonization.
- `Environment=OCX_SERVICE=1`.
- `Environment=OCX_SERVICE_MANAGED=1`.
- `Environment=OCX_RESTART_OWNER=supervisor` (or accepted final name).
- `Restart=on-failure` and a bounded `RestartSec`.
- The shell wrapper must use `exec` for the actual Bun/OpenCodeX process so MainPID, signals, and exit status belong to OpenCodeX rather than a surviving shell.
- A stop timeout longer than the maximum restart drain plus cleanup margin, or a documented distinction between systemd stop timeout and the endpoint's internal terminal deadline.
- A stable `User`, `Group`, `WorkingDirectory`/home, config home, port, and immutable artifact reference. Secret values stay outside the tracked unit, supplied by a root-owned environment/credential file.

The reserved recycle status must be documented and tested. It must be non-zero so failure-only managers replace it, but ordinary crashes may keep their native status. The CLI's success oracle is replacement readiness, not the old process exit code.

## Switch transaction and recovery semantics

Before writing configuration, `switch-codex` must preflight all of the following within a short bound: exact live runtime identity, current PID, management authentication, restart-owner capability exposed by a health/management response, and an available recovery owner for the formal unit. A missing listener or ambiguous process identity is a preflight failure and must leave config unchanged.

The apply state machine is:

1. Read and validate the current bytes; create a secure snapshot.
2. Render and validate complete next bytes.
3. Acquire the switch/restart operation lock so concurrent switches cannot interleave.
4. Atomically write the next bytes and immediately request the bounded restart against the preflight PID. The endpoint latches drain synchronously before returning accepted.
5. Wait for a different PID on the same formal port; require health, readiness, expected artifact identity, expected preset/profile state, and exact config hash.
6. Commit success only after all checks pass.

Rollback is also bounded and state-specific:

- Failure before restart acceptance: atomically restore the snapshot; the original process is still the target, so verify the restored bytes and service health without a second restart unless the runtime actually consumed the new state.
- Failure after acceptance but before a replacement is reachable: restore the snapshot, then use the independently owned formal service recovery operation (`systemctl start`/`restart` issued by the privileged wrapper or operator), not the dead process's API. Wait for health/readiness and verify the restored hash.
- Failure after a replacement is reachable but verification fails: restore the snapshot, request one restart against that new, exactly identified PID, and verify. If that fails, use the external recovery operation once.
- If rollback verification fails, stop automatic retries and report both the original and rollback failures. Do not alternate indefinitely between API restart and manager restart.

Snapshots and writes remain atomic, ownership/mode preserving, and idempotent. Reapplying the already-active preset may return success after verification without restarting. This is the main fast path. A real switch still may take up to the configured drain deadline when active turns exist; the CLI should show that it is draining and the active-turn count rather than appearing frozen.

## Invariants

- Exactly one component owns replacement for a given process generation.
- A manager-owned process never launches a detached replacement.
- A restart request rejects new data-plane work before it acknowledges acceptance.
- Existing turns either finish within the published deadline or are terminated at that deadline; there is no unbounded wait.
- The old generation cannot report switch success.
- Success requires a new PID, the intended port, health, readiness, artifact identity, and expected config hash/profile state.
- A clean operator stop never causes an automatic restart.
- A failed apply either returns to the byte-exact prior config with verified serving state or ends with an explicit recovery failure; it never claims rollback merely because bytes were rewritten.
- Manager detection does not depend on probing a different service namespace from the service account.
- Restart logs and CLI errors contain no credentials or raw private paths.

## Repository ownership

The formal system service definition should have a repository-owned, sanitized authoritative template plus an idempotent installer/render step. The deployed `/etc/systemd/system/opencodex.service` is generated state and should not be edited as the source of truth.

Keep the existing `src/service/systemd.ts` as the product's per-user systemd implementation. The formal system-wide service has different account, privilege, port, artifact, and deployment ownership, so its template belongs with formal deployment operations (for example `ops/templates/opencodex-formal.service` plus `ops/runbooks/formal-opencodex-service.md` and a narrowly scoped installer). The template must not contain credentials, host-private addresses, or a mutable dirty-worktree path. Rendering must record the selected immutable artifact and template revision, run `systemd-analyze verify`, install atomically, daemon-reload, and verify the loaded properties before restart.

The generic restart capability contract and cross-platform generated-definition changes remain product source under `src/service/*`, with the invariant documented in `structure/runtime.md`. The formal template consumes that contract rather than duplicating restart logic.

## Migration path and reversibility

1. Add the capability and focused unit/runtime tests without changing the formal service.
2. Add the sanitized formal unit template and render/install verification.
3. Qualify an isolated system unit using a disposable port and config home. Prove normal switch, active-turn drain, forced deadline, crash restart, explicit stop, failed startup, and rollback recovery.
4. Render the formal unit from the accepted immutable artifact, compare the full loaded property set, then atomically install and daemon-reload.
5. Perform one bounded formal restart in a maintenance window and run the success oracle below.

Rollback is to reinstall the prior captured unit bytes, daemon-reload, restore the prior immutable artifact/config snapshot, and start once. Do not revert only the environment marker while leaving runtime behavior that assumes supervisor ownership.

## Verification oracle

Automated focused tests must prove:

- supervisor capability selects drain plus reserved non-zero exit and records no spawn;
- self ownership selects exactly one detached start;
- missing/contradictory manager markers reject before terminal action;
- generated systemd/launchd/Windows definitions carry the matching capability and their restart policy responds to the reserved status;
- explicit stop exits cleanly and remains stopped;
- config apply preflight failure writes nothing;
- each rollback branch uses the correct live PID or external recovery owner and is bounded;
- CLI error output preserves original and rollback stacks without Bun's source-line dump.

The isolated runtime test must observe: old PID ready; restart accepted and data plane returns draining status; old in-flight request completes or reaches the documented deadline; old PID exits with the reserved status; manager restart count increments once; a different PID becomes healthy and ready on the same port; expected config hash/profile is served; no second listener or detached child exists.

The formal post-install oracle is the same plus loaded unit properties (`User`, `ExecStart`, the three ownership/capability environments, `Restart=on-failure`, restart delay), exact immutable artifact identity, and one minimal authorized routed request after readiness. Command success alone is insufficient.

## Prohibited paths

- Do not make the server call `sudo systemctl` or grant it service-manager control.
- Do not let both systemd and detached self-spawn own the same restart.
- Do not infer supervision solely from `OCX_SERVICE=1`, unit-file presence, or an enabled flag.
- Do not deploy only an environment edit without the runtime and verification changes.
- Do not use `Restart=always` as a substitute for distinguishing recycle from stop.
- Do not repeat the same API restart during rollback after the target listener is gone.
- Do not declare a switch successful from config bytes alone.

## Evidence

- `.memory/OCX-INC-20260923-01/work/debugger-deep.md`
- `.memory/OCX-INC-20260923-01/work/restore-openai.md`
- `scripts/switch-codex.ts`
- `src/server/management/system-restart.ts`
- `src/service/systemd.ts`
- `src/service/diagnostics.ts`
- `src/service/orchestration.ts`
- `src/service/state.ts`
- `src/cli/index.ts`
- `tests/server/system-restart.test.ts`
- `structure/runtime.md`

## Followups

- Return the accepted contract to a coder for product implementation and focused tests.
- Assign the formal template/installer and host migration to devops after isolated qualification.
- Assign independent runtime verification to tester and final gate acceptance to reviewer.

## Open issues

- The exact reserved recycle exit status and final capability variable name are implementation-level choices; they must be stable and documented before deployment.
- The current evidence does not include the complete formal unit contents or its `TimeoutStopSec`/shell `exec` behavior, so deployment must inspect and compare those properties before installation.
- A server-side transactional config-and-drain endpoint would close the small write-to-drain window completely. Until such an endpoint exists, the switch operation lock plus immediate PID-bound restart request is required, and the residual window should be measured in isolated qualification.

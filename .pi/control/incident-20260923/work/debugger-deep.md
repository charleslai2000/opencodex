# Debugger-deep report — OCX-INC-20260923-01-I1

Status: done

## Finding

The outage was a confirmed formal-listener outage, not evidence of an OpenAI
credential or upstream-provider failure.  The strongest causal explanation is
that `switch-codex openai` invoked a new in-process drain-and-restart path
against a systemd service that is not marked as a supervised service child.
The process therefore took the unsupervised branch and exited successfully.
The installed unit has `Restart=on-failure`, so systemd did not restart it.

The latest host journal also shows an external start after the outage:

- 06:49:27: `opencodex.service: Deactivated successfully`.
- 06:55:47: `Started opencodex.service`.
- 06:55:49: the new process logged that it was serving on port 3456.

This report cannot independently prove the currently restarted process is
reachable from this execution namespace: its loopback network does not share
the host listener.  The host journal is the authoritative current evidence
available here.

## Causal timeline

1. The installed wrapper `/usr/local/bin/switch-codex` selects immutable
   artifact `/opt/opencodex-gpt6-cab39de77` and runs its `scripts/switch-codex.ts`.
2. That script's `openai` path writes the selected preset, then calls
   `gracefulRestart()` (`scripts/switch-codex.ts:95-103,121,131`).
3. `gracefulRestart()` sends the exact running proxy the bounded
   `/api/system/restart` request.
4. The runtime starts a shutdown drain, rejects new data-plane traffic, then
   decides whether it is supervised using `process.env.OCX_SERVICE === "1"`
   (`src/server/management/system-restart.ts:151-155,359-390`).
5. `/etc/systemd/system/opencodex.service` has no `OCX_SERVICE=1` environment
   entry, but uses `Restart=on-failure` (lines 11-20).  The runtime therefore
   takes the unsupervised branch, attempts a detached replacement, marks itself
   recycling, and exits `0` on a completed drain
   (`src/server/management/system-restart.ts:396-425`).
6. The host journal records the service as "Deactivated successfully" at
   06:49:27 and no automatic replacement.  This matches the service exit-0 /
   `Restart=on-failure` interaction and the reported simultaneous failure of
   all routes that use port 3456.
7. At 06:55:47, an external actor started the unchanged formal unit; at 06:55:49
   it logged successful binding on 3456.  The action was outside this invocation.

## Observed facts

- The wrapper and formal unit both name the same `cab39de77` artifact.
- The wrapper requires root via `sudo` before it can invoke the switcher.
- The formal unit starts port 3456 as `dev-codex`, has `Restart=on-failure`, and
  has no `OCX_SERVICE=1` environment assignment.
- The last outage journal event before recovery was a successful deactivation,
  not a crash/restart loop.
- At 06:53, the port was connection-refused; an L4 executor could not run the
  prescribed start in this restricted execution environment because sudo and
  systemd D-Bus access were blocked.
- 3457 and 10100 were responding but are explicitly unrelated listeners and
  cannot be accepted as the formal 3456 service.

## Hypotheses ruled out or not established

- **Not established:** OpenAI upstream/auth failure.  There is no request-level
  upstream failure evidence after the local formal listener had disappeared.
- **Not established:** a preset route-map failure.  A route-map error cannot
  explain loopback connection refusal and the successful-deactivation journal
  event.
- **Likely but not directly logged:** the detached child of the unsupervised
  handoff did not remain serving.  The exit-0 branch guarantees no systemd
  recovery; cgroup cleanup is a plausible reason a detached child did not
  survive, but logs do not prove that sub-mechanism.

## Safe recovery and preconditions

1. Treat the host's 06:55 start as a recovery attempt, then on the host verify
   `opencodex.service` is active and that both `http://127.0.0.1:3456/healthz`
   and `/readyz` return valid success responses.  Verify one minimal authorized
   routed request only after listener health and readiness pass.
2. Do not run `switch-codex`, `rollback`, or a second restart while that check
   is in progress.  Those operations now enter the same unsafe restart path.
3. Before any later preset switch, repair the supervision contract: either the
   service must explicitly set `OCX_SERVICE=1` and the systemd restart semantics
   must be verified, or the switcher must use an independently verified systemd
   restart procedure.  This needs a fresh implementation/operations dispatch.

## Missing evidence

- Host-side health and readiness results for PID 977432 after the 06:55 restart.
- A minimal routed-request result, including whether the OpenAI route now
  succeeds.
- The accepted restart request timestamp and service process exit code; the
  current journal conclusively shows the inactive interval but does not itself
  identify the caller.

## Evidence references

- `/usr/local/bin/switch-codex:1-29`
- `/etc/systemd/system/opencodex.service:6-20`
- `scripts/switch-codex.ts:95-103,121-132`
- `src/server/management/system-restart.ts:151-155,359-425`
- host `journalctl -u opencodex.service --since '2026-09-23 06:43:00'`
- `.memory/OCX-INC-20260923-01/work/devops-executor.md`

## Followups

- Fresh L4 verification invocation: verify the 06:55 recovery from the actual
  host network and issue one bounded routed smoke request.
- Fresh L3/L4 implementation and operations work: correct the unit/switcher
  restart contract and test it on an isolated runtime before another formal
  preset mutation.

## Open issues

- This invocation did not modify the unit, artifact, config, service, or Pi.
- The exact actor that started the unit at 06:55 is not identified by the
  available journal records.

## Host-side recovery verification (root orchestrator, 2026-09-23 06:56 CST)

- `systemctl show/status opencodex.service`: active/running, MainPID 977432, same immutable artifact; startup logged 06:55:47–06:55:49.
- `curl http://127.0.0.1:3456/healthz`: HTTP 200, service `opencodex`, PID 977432.
- `curl http://127.0.0.1:3456/readyz`: HTTP 200, status `ready`.
- `/usr/local/bin/switch-codex status`: active preset `openai`, runtime matches formal artifact, health/readiness normal.
- The root orchestrator did not initiate service start; who/what initiated the 06:55 start is not established. No live provider inference was sent.

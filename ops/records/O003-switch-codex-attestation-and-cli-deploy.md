# O003 — switch-codex attestation failures and CLI output

Date: 2026-10-01

## Problem

`sudo switch-codex deepseek` on pc01 failed intermittently with
`no attested OpenCodeX process is running` or `unattested proxy process`, while
`/healthz` and `/readyz` answered 200 and the service was demonstrably alive.
`switch-codex status` also printed a JSON object instead of readable status.

## Root cause

The production listener binds `0.0.0.0` (`runtime-port.json` records
`hostname: "0.0.0.0"`). `findLiveProxy` probed that wildcard address, which does not
answer locally, so discovery fell through to the configured-port branch and labelled
the result `source: "config"`. The routing reload client accepts only
`source: "runtime"` for its PID-bound attestation, so the reload was refused with
`unattested proxy process` even though the running process was the correct one.

Two further defects were fixed in the same change set:

1. Preset switching wrote `config.json` before the running process was attested, so a
   failed discovery left the on-disk preset changed and the runtime untouched.
2. `SwitchApplyError` reported `rollback verification failed` for both "apply failed,
   snapshot restored" and "rollback could not be verified", which obscured what had
   actually happened.

## Change

- `src/server/proxy-liveness.ts` — the configured-port fallback now reports
  `source: "runtime"` when the runtime record agrees on both PID and port, so
  wildcard-bound production listeners can be attested.
- `scripts/switch-codex.ts` — the target process is attested before `config.json` is
  written; failure messages distinguish "configuration was not changed" from
  "snapshot restored, but runtime rollback could not be verified".
- CLI output is human readable: `status` prints preset, runtime path, verification
  result and per-role logical routes; a successful switch prints the same route table.

## Deployment

- Artifact: `/opt/opencodex-2.59.0-2c45d767` (installed by `scripts/deploy-production.ts`
  from source commit `2c45d767`; the fix itself was still an uncommitted working-tree
  change at deploy time).
- Wrapper: `/usr/local/bin/switch-codex` re-rendered for the new artifact.
- Recovery material: `/var/lib/opencodex/deploy-snapshots/2026-10-01T010803.045Z-2c45d767`
  (previous unit, wrapper and config copy); the previous artifact
  `/opt/opencodex-2.59.0-ba93e37e7` is retained.
- Preset switch snapshots for this session:
  `config-1790817051496-openai.json`, `config-1790817079706-deepseek.json`,
  `config-1790817092631-openai.json` under `/var/lib/opencodex/switch-snapshots/`.

## Verification

- `sudo switch-codex status` prints human-readable status and routes; no JSON.
- Four consecutive switches succeeded without an attestation error
  (`deepseek`, `openai`, `deepseek`, plus one debug run).
- Data-plane evidence (`/var/lib/opencodex/usage.jsonl`) shows `requestedModel: lead`
  served by `openai/gpt-6-luna` while the preset was `openai` and by
  `deepseek/deepseek-flash` (status 200) while the preset was `deepseek`, on the same
  service PID — the preset change takes effect without a service restart.
- Final state: preset `deepseek`, service healthy and ready, `lead`/`worker`/`expert`
  route to `deepseek/deepseek-flash`, `bot` prefers OpenRouter with DeepSeek fallback.

## Open items

- The fix is not committed; a future deployment from a clean checkout of `2c45d767`
  would ship the old `switch-codex`.

## Addendum 2026-10-03 — attestation failed again under host load

Repeated `switch-codex deepseek` failures returned `could not attest the running
OpenCodeX process` while PID 2075 was running, `runtime-port.json` recorded the same
PID and port, and the unit was active. Direct probes showed the cause was not identity:
`/healthz` intermittently exceeded the switch client's 750 ms default probe, and
`/v1/models` took 11-12 s against a 5 s client timeout. The host was under sustained
load from several `pi` processes (load average ~13, service at ~65% CPU), and simple
loopback requests to `/healthz` alone timed out at 3-8 s.

Resolution: the switch client now probes with a bounded 5 s budget and 3 attempts, and
uses a 20 s timeout for management reads and the routing reload. Source: `scripts/switch-codex.ts`.
The running artifact's `scripts/switch-codex.ts` was updated in place (backup:
`/var/lib/opencodex/switch-codex.ts.pre-timeout-fix-20261003160730`) without restarting
the service; service PID 2075 was unchanged throughout.

Verification: `switch-codex status` reports healthy/ready and passes catalog verification
under the same load; two `switch-codex deepseek` runs succeeded; `/var/lib/opencodex/usage.jsonl`
shows `requestedModel: lead` served by `deepseek/deepseek-flash` (status 200) afterwards.

Consequence to respect: the deployed artifact's tree digest no longer matches its
`RELEASE-PROVENANCE.json`, because a file inside the artifact changed after installation.
The next deployment must be built from a commit that contains this fix, and should not be
verified against the old provenance digest.

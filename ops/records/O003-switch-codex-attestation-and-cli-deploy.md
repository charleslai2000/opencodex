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

- The first switch attempt after the service restart failed once with
  `apply failed; snapshot restored: The operation timed out.`; a retry seconds later
  succeeded and the condition has not recurred. Catalog and management endpoints
  measured 0.1 s or less afterwards, so the onset coincided with post-restart provider
  model discovery rather than a persistent condition. Not explained further.
- The fix is not committed; a future deployment from a clean checkout of `2c45d767`
  would ship the old `switch-codex`.

# O002 — Pi profile unification

Date: 2026-09-22

## Result

Unified the Pi model catalogs for these accounts to the four logical OpenCodex profiles:

- `lead`
- `bot`
- `worker`
- `expert`

Each profile exposes the three active reasoning levels `low`, `medium`, and `high`, with `contextWindow=400000` and `maxTokens=128000`. All catalogs use the OpenAI-compatible OpenCodex provider and the verified V1.1 service.

## Targets

- pc01 `charles`: `/home/charles/.pi/agent/models.json`, local endpoint `127.0.0.1:3456`
- pc01 `dev-codex`: `/home/dev-codex/.pi/agent/models.json`, local endpoint `127.0.0.1:3456`
- svr01 `admin`: `/home/admin/.pi/agent/models.json`, endpoint `192.168.1.203:3456`
- sglang `ubuntu`: `/home/ubuntu/.pi/agent/models.json`, endpoint `192.168.1.203:3456`

All configuration files are account-owned and mode `0600`. Existing configurations were backed up before replacement under `/var/backups/pi-config-unification-20260922-042426` (local and svr01) and `/home/ubuntu/models.json.pre-unification-20260922-042426` (sglang).

## Pi runtimes

- svr01: installed system-wide as root, Pi `0.87.0`, Node `22.23.2`; available to `admin` through `/usr/local/bin/pi`.
- sglang: installed user-locally for `ubuntu`, Pi `0.87.0`, Node `22.23.2`; available through `~/.local/bin`.
- dev-codex: installed user-locally, Pi `0.87.0`, Node `22.23.2`.
- charles: existing Pi `0.86.0` retained; no runtime upgrade was required for the catalog change.

## Verification

- All four JSON files parse successfully.
- All contain exactly the ordered profiles `lead`, `bot`, `worker`, `expert`.
- All contain the active `low`/`medium`/`high` mappings.
- Formal V1.1 `/healthz` remains `ok`.
- No OpenCodex service, Pi session JSONL, or `switch-codex` file was modified.

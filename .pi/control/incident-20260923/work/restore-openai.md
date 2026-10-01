ENTRY: ACCEPT

Status: done

Commands and evidence:

- Read `/var/lib/opencodex/config.json`: routingPreset was `deepseek`; service was inactive.
- Applied deployed artifact `/opt/opencodex-gpt6-cab39de77/src/routing/presets.ts` via temporary `/tmp/restore-openai.ts`, including removal of `providerContextCaps.openai`, and atomically replaced the config while preserving `dev-codex:dev-codex` ownership and mode `0600`.
- Snapshot retained at `/var/lib/opencodex/config-snapshots/config-1790118298969-deepseek.json` with mode `0600`.
- Started `opencodex.service`; `systemctl is-active` returned `active`.
- `GET /healthz` returned HTTP 200 and status `ok`; `GET /readyz` returned HTTP 200 and status `ready` on port 3456.
- Config verification: `routingPreset=openai`; lead and worker routes use provider `openai`, model `gpt-6-luna` for low/medium/high; expert routes use OpenAI `gpt-6-luna` low/high effort and `gpt-5.6-terra` medium/high as defined by the deployed preset.

No paid provider request was sent.

Followups: terminal `switch-codex` usability can be handled separately.
Open issues: none for this restoration.

# O005 — Expert low switched to Luna xhigh

Applied: 2026-10-17 22:32:21.380 UTC (2026-10-18 06:32:21.380 CST)

## Runtime change

- `expert/low`: `openai/gpt-6-luna`, upstream `xhigh`.
- `expert/medium`: `openai/gpt-6.1-sol`, upstream `medium` (unchanged).
- `expert/high`: `openai/gpt-6.1-sol`, upstream `xhigh` (unchanged).
- The `routingPreset` marker was cleared because the custom low route no longer matches the compiled `openai` preset. Runtime reports `custom / unset`.
- Applied by routing hot reload; the service was not restarted.
- Runtime artifact and active config digest were verified on the host. Their local paths and digest are omitted from this public record.
- The exact pre-change config snapshot remains in the host's local switch-snapshot archive.

## Cache stability comparison boundary

Use `2026-10-17T22:32:21.380Z` (`1792276341380` epoch milliseconds) as the inclusive start time for the next natural-traffic cache stability review. The final Responses request telemetry is active in this artifact and records the serialized `reasoning.effort` value without recording request bodies.

This timestamp marks the routing change, not a cache event. Do not initiate model requests for the comparison. Usage records can establish upstream-reported cache-token changes; they do not by themselves prove per-session prefix identity or a server-side cause.

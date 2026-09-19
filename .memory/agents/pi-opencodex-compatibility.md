# Pi → OpenCodex compatibility gate

## Scope

This is an integration boundary check for switching the frontend from OpenCode to Pi coding agent. It does not modify the frozen Adaptive Routing V1 router.

## Findings

- Pi custom models support `api: "openai-responses"`, a custom `baseUrl`, `contextWindow`, `reasoning`, and `compat`.
- Pi's OpenAI Responses implementation sends the configured model id in the request body. Configure the Pi model id as `policy/coder` so OpenCodex enters policy dispatch rather than concrete-provider dispatch.
- Pi maps its thinking level to Responses `reasoning.effort`. OpenCodex's Responses evidence parser consumes the same field. Pi's OpenAI Responses adapter does not implicitly map `minimal` to `low`: unless `thinkingLevelMap` is configured, `minimal` is sent as `reasoning.effort: "minimal"`. Therefore a V1 profile exposing only `low/medium/high/xhigh` must either hide `minimal` with `thinkingLevelMap: { "minimal": null }`, or explicitly map it with `thinkingLevelMap: { "minimal": "low" }`. `off` disables reasoning and sends no effort evidence.
- With `compat.sessionAffinityFormat: "openai"`, Pi sends the stable `sessionId` as `session_id` and `x-client-request-id`, and uses it for `prompt_cache_key` when prompt caching is enabled. OpenCodex reads both `session_id` and `session-id`; therefore the current Pi implementation is accepted, and the alternate hyphenated form remains compatible.
- OpenCodex hashes the supplied session identity when producing its internal session lane. This is intentional: the affinity key remains `principal + NUL + routingProfileId + NUL + sessionLane`, without exposing the raw Pi UUID in routing state.
- Pi's `contextWindow` is frontend compaction metadata. It should describe the logical model's supported context, not the smallest individual V100 replica. It is not a substitute for the deferred Context V2 admission policy.

## Minimal Pi model configuration

```json
{
  "providers": {
    "opencodex": {
      "baseUrl": "http://opencodex.example/v1",
      "api": "openai-responses",
      "apiKey": "$OPENCODEX_API_KEY",
      "models": [
        {
          "id": "policy/coder",
          "name": "OpenCodex adaptive coder",
          "reasoning": true,
          "thinkingLevelMap": {
            "minimal": "low"
          },
          "contextWindow": 128000,
          "input": ["text", "image"],
          "compat": {
            "sessionAffinityFormat": "openai"
          }
        }
      ]
    }
  }
}
```

Adjust `contextWindow` and `input` to the logical profile contract actually exposed by the deployment. Do not use a replica's advertised `contextWindow` as a V1 hard route filter.

## Automated gate

`tests/routing/pi-compatibility-gate.test.ts` verifies:

1. `policy/coder` plus `reasoning.effort` produces the expected OpenCodex evidence.
2. Both `session_id` and `session-id` resolve to the same normalized OpenCodex session lane.
3. `minimal` is not implicitly accepted as `low`; it must be mapped/hidden or the profile must explicitly expose it.
4. A committed successful placement is reused on a later Pi turn with the same session/profile.

## Verification

- Pi compatibility gate: 5 pass, 0 fail, 9 assertions.
- Adaptive Routing V1 regression set: 38 pass, 0 fail, 1239 assertions.
- `bun run typecheck`: passed.
- `git diff --check`: passed.

## Decision

No V1 architecture rewrite is required. Pi is a compatible frontend when configured as an OpenAI Responses client using the policy model id and stable session id. Remaining deployment work is a runtime wire-capture check against the actual Pi/OpenCodex endpoint; Context V2 remains out of scope.

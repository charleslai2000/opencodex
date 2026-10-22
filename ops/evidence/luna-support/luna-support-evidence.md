# Luna prompt-cache observations

This report contains only GPT-6 Luna observations from existing records. No new model requests were made. The original request bodies are not included.

The Luna-only source set contains 168 physical requests, 166 usage records, and 2 requests without usage. Three linked Warm→Cold→Warm sequences with two warm baselines and stable inputs/configuration were reconstructed. Replay of the corrected event-state logic found 3 threshold events, matching all three stable sequences.

## Observed events

| Event | Cold (UTC; cached/input) | Immediate recovery | Follow-up 1 | Follow-up 2 | Classification |
|---|---|---|---|---|---|
| 1 | 2026-10-17T18:22:17.309Z; 0/96574; response `resp_REDACTED_0001` | 2026-10-17T18:22:20.770Z; 87936/96902 | 2026-10-17T18:22:27.592Z; 94080/97563 | 2026-10-17T18:22:33.518Z; 72832/97989 | SUSTAINED_RECOVERY_THROUGH_TWO_FOLLOWUPS |
| 2 | 2026-10-17T18:22:52.335Z; 0/99264; response `resp_REDACTED_0002` | 2026-10-17T18:22:58.564Z; 98688/101263 | 2026-10-17T18:23:09.614Z; 0/102574 | 2026-10-17T18:23:22.115Z; 0/103613 | TRANSIENT_RECOVERY_THEN_ZERO_HIT |
| 3 | 2026-10-17T18:33:17.014Z; 0/144924; response `resp_REDACTED_0003` | 2026-10-17T18:33:21.483Z; 144256/145029 | 2026-10-17T18:33:28.859Z; 0/145116 | 2026-10-17T18:33:37.544Z; 0/145957 | TRANSIENT_RECOVERY_THEN_ZERO_HIT |

Cold `cached_tokens=0` is present in the captured upstream usage block for all three events. Missing usage fields are not defaulted to zero.

## Request-prefix verification

The verifier parses the captured final outbound JSON body. It compares the ordered `input` arrays semantically: JSON objects are canonicalized by sorted keys, array order is preserved, and each previous array must equal the same-length prefix of the next array. This verifies the complete previous input-item prefix and excludes ordinary appended tail items. It is not a byte-for-byte comparison of serialized JSON whitespace/key order. For every adjacent pair in each six-request sequence, the JSON includes item counts, SHA-256 of the previous input prefix and matching current prefix, and SHA-256 of non-input configuration after excluding only `input` and `prompt_cache_options.comparison_response_id`.

Model, instructions, tools schema, service tier, reasoning, verbosity, format, prompt cache key, and other prompt-cache option values are checked pairwise. Only equality booleans and hashes are exported; prompt text and tool definitions are not included. The per-turn comparison ID differs, is present in the captured request body, and matches capture metadata.

## Interpretation and limits

All three Cold requests were followed immediately by a high-cache linked response. Only Event 1 sustained recovery through both following requests (both at or above a 70% cache ratio). Events 2 and 3 were transient: each had two subsequent linked requests with cached_tokens=0. Thus the immediate recovery alone does not show durable cache reuse.

The comparison ID is a changing diagnostic request parameter and could affect cache eligibility; current records cannot exclude that confounder. `diagnostics=unavailable` is reported as unavailable and is not interpreted as a cache-miss explanation.

Capture-local chain IDs were grouped with their capture window because those IDs restart between bounded captures; this prevents joining unrelated requests across windows. With that scope applied, no additional threshold candidate remains beyond the three reported sequences.

All 18 selected event rows say no conversation key was available to the capture hook. The collector stores only a presence flag and, when present, a short hash—not the raw identity. A scan of the existing service journal for the Luna capture interval found no thread/session, WebSocket connection/reconnect, retry, compaction, or reroute markers. Thread/turn/Pi session and WebSocket connection IDs therefore remain UNKNOWN. Selected requests report physicalAttempt=1 and compactionRequest=false; transport is Codex WebSocket, but no connection ID or handshake headers were recorded. Request rates for each capture window are in the JSON file.

These observations do not establish server-side cache eviction, routing migration, or excess billing/Credits. Token-category differences are not a billing-loss estimate.

## English summary for OpenAI Support

We observed three GPT-6 Luna cold requests whose upstream usage reported `cached_tokens: 0`, each followed immediately by a linked response with high cache usage. Recovery persisted across the next two linked requests in one sequence, but was transient in two others: both subsequent requests again reported zero cached tokens. Pairwise canonicalized input-array checks confirm that the complete prior input array was an ordered prefix in all six-request sequences; non-input configuration hashes match after excluding `input` and the changing per-turn `prompt_cache_options.comparison_response_id`. The diagnostic parameter is present in the final captured request body and links to the preceding response, so we cannot exclude it as a cache-eligibility confounder. Diagnostics returned `unavailable`. Please investigate the listed response IDs and confirm whether comparison_response_id changes cache eligibility. This evidence does not establish server-side root cause or billing loss.

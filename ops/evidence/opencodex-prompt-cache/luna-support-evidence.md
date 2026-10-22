# Luna prompt-cache observations

This report contains only GPT-6 Luna observations from existing records. No new model requests were made. The original request bodies are not included.

The Luna-only source set contains 168 physical requests, 166 usage records, and 2 requests without usage. Three linked Warm→Cold→Warm sequences were reconstructed. Deterministic replay detected 3/3.

## Observed events

| Event | Warm (UTC; cached/input) | Cold (UTC; cached/input; response ID) | Recovery (UTC; cached/input) | Comparison ID link | Prefix/config |
|---|---|---|---|---|---|
| 1 | 2026-10-17T18:33:12.678Z; 124672/144801 | 2026-10-17T18:33:17.014Z; 0/144924; `resp_REDACTED_0003` | 2026-10-17T18:33:21.483Z; 144256/145029 | resp_REDACTED_0018; prior response link=True | ordered input prefix=True; non-input config stable excluding comparison ID=True |
| 2 | 2026-10-17T18:22:13.255Z; 91136/94548 | 2026-10-17T18:22:17.309Z; 0/96574; `resp_REDACTED_0001` | 2026-10-17T18:22:20.770Z; 87936/96902 | resp_REDACTED_0006; prior response link=True | ordered input prefix=True; non-input config stable excluding comparison ID=True |
| 3 | 2026-10-17T18:22:47.861Z; 92672/98856 | 2026-10-17T18:22:52.335Z; 0/99264; `resp_REDACTED_0002` | 2026-10-17T18:22:58.564Z; 98688/101263 | resp_REDACTED_0012; prior response link=True | ordered input prefix=True; non-input config stable excluding comparison ID=True |

Cold `cached_tokens=0` is present in the captured upstream usage block for all three events. Missing usage fields are not defaulted to zero.

## Interpretation and limits

The captures show three upstream usage drops to zero cached input followed by recovery, with stable ordered request input prefixes and stable non-input request configuration after excluding `comparison_response_id`. The comparison ID is present as a varying per-turn diagnostic parameter and may itself affect cache eligibility; these records do not exclude that confounder. `diagnostics=unavailable` is reported as unavailable and is not interpreted as a cache-miss explanation.

The recorded event requests have no conversation key, thread ID, turn ID, Pi session ID, or WebSocket connection identifier. Selected rows show physical attempt 1 and compactionRequest=false. Reconnect and reroute state are unknown. The recorded response transport is Codex WebSocket; the upstream request ID was not captured in these records. Request rates for each capture window are in the JSON file.

These observations do not establish server-side cache eviction, routing migration, or excess billing/Credits. Token-category differences are not a billing-loss estimate.

## English summary for OpenAI Support

We observed three GPT-6 Luna Responses requests where upstream usage reported cached input dropping to 0 and then recovering on the next linked response. In each sequence, the prior request input was an exact ordered prefix of the next request, and the non-input request configuration matched after excluding the per-turn `prompt_cache_options.comparison_response_id`. The cold requests' raw upstream usage blocks contain `input_tokens` and `input_tokens_details.cached_tokens: 0`; response IDs and comparison IDs are included in the accompanying JSON. Diagnostics reported as unavailable are not treated as a cache-miss reason. Because the comparison ID changes on each turn, we cannot rule out that diagnostic parameter changing cache eligibility. Thread/session identity and WebSocket connection/reconnect identifiers were not captured. Please confirm whether comparison_response_id can affect prompt-cache eligibility and, if not, investigate why these otherwise prefix-stable Luna requests returned zero cached input. This report does not claim a confirmed server-side root cause or billing loss.

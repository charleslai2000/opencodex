# OpenCodeX Prompt Cache — Evidence Review

Generated: 2026-10-17T18:41:35.366Z (offline analysis; the script initiated no model requests)

## Evidence scope and preservation

11 raw JSONL files were reviewed: 5 Sol files and 6 Luna/OpenAI files. Their absolute paths, byte sizes, modes, SHA-256 hashes, request counts, and UTC ranges are in evidence-manifest.json. The raw files remain in place with mode 0400; no prompt body was copied into this package or committed.

The five original Sol SHA-256 values match the prior recorded hashes. Original evidence is preserved at <capture-root>/; the Luna captures are under <capture-root>/.

## Independent request and usage counts

| Model group | Requests | Usage rows | Requests missing usage | Raw input/cached/cache-write fields missing in usage rows |
|---|---:|---:|---:|---:|
| Sol | 42 | 24 | 18 | input 0, cached 0, cache-write 0 |
| Luna | 168 | 166 | 2 | input 0, cached 0, cache-write 0 |

Missing fields are represented as null in the machine report; they are not replaced with zero. The eighteen Sol requests from the earliest three captures have no usage rows and are excluded from token sums. For the remaining Sol and Luna usage rows, the original upstream usage blocks include input_tokens, cached_tokens, and cache_write_tokens. The Sol values 5,376 (twice) and 0 (once) are verbatim cached_tokens values in upstream usage blocks.

## Sol Warm→Cold→Warm evidence

### Sol W-C-W 1: confirmed_warm_cold_warm

Cold request 2026-10-17T16:51:57.460Z; prior cached-token reference 12800; actual additional uncached tokens versus that reference 7424.
Recovery: 2026-10-17T16:52:02.480Z; two pre-cold rows: true; two post-recovery rows: false.

| UTC | Position | Input | Cached | Uncached | Cache write | Response ID | Input items | Ordered prefix / stable fields |
|---|---|---:|---:|---:|---:|---|---:|---|
| 2026-10-17T16:51:44.714Z | neighbor | 47482 | 12800 | 34682 | 0 | resp_REDACTED_0022 | 49 | n/a |
| 2026-10-17T16:51:50.741Z | neighbor | 47802 | 12800 | 35002 | 0 | resp_REDACTED_0023 | 51 | true / true |
| 2026-10-17T16:51:57.460Z | cold | 47927 | 5376 | 42551 | 0 | resp_REDACTED_0024 | 53 | true / true |
| 2026-10-17T16:52:02.480Z | neighbor | 49650 | 12800 | 36850 | 0 | resp_REDACTED_0025 | 55 | true / true |
| 2026-10-17T16:52:13.911Z | neighbor | 50127 | 12800 | 37327 | 0 | resp_REDACTED_0026 | 59 | true / true |

### Sol W-C-W 2: confirmed_warm_cold_warm

Cold request 2026-10-17T16:52:21.166Z; prior cached-token reference 12800; actual additional uncached tokens versus that reference 12800.
Recovery: 2026-10-17T16:52:26.526Z; two pre-cold rows: true; two post-recovery rows: false.

| UTC | Position | Input | Cached | Uncached | Cache write | Response ID | Input items | Ordered prefix / stable fields |
|---|---|---:|---:|---:|---:|---|---:|---|
| 2026-10-17T16:52:02.480Z | neighbor | 49650 | 12800 | 36850 | 0 | resp_REDACTED_0025 | 55 | n/a |
| 2026-10-17T16:52:13.911Z | neighbor | 50127 | 12800 | 37327 | 0 | resp_REDACTED_0026 | 59 | true / true |
| 2026-10-17T16:52:21.166Z | cold | 51237 | 0 | 51237 | 0 | resp_REDACTED_0027 | 61 | true / true |
| 2026-10-17T16:52:26.526Z | neighbor | 52594 | 12800 | 39794 | 0 | resp_REDACTED_0028 | 63 | true / true |
| 2026-10-17T16:52:33.081Z | neighbor | 61722 | 12800 | 48922 | 0 | resp_REDACTED_0029 | 70 | true / true |

### Sol W-C-C-W 3: confirmed_warm_cold_warm

Cold request 2026-10-17T17:00:43.390Z; prior cached-token reference 103680; actual additional uncached tokens versus that reference 90880.
Recovery: 2026-10-17T17:01:02.613Z; two pre-cold rows: true; two post-recovery rows: false.

| UTC | Position | Input | Cached | Uncached | Cache write | Response ID | Input items | Ordered prefix / stable fields |
|---|---|---:|---:|---:|---:|---|---:|---|
| 2026-10-17T17:00:14.483Z | neighbor | 109944 | 85248 | 24696 | 0 | resp_REDACTED_0030 | 189 | n/a |
| 2026-10-17T17:00:27.144Z | neighbor | 112785 | 103680 | 9105 | 0 | resp_REDACTED_0031 | 200 | true / true |
| 2026-10-17T17:00:43.390Z | cold | 113366 | 12800 | 100566 | 0 | resp_REDACTED_0032 | 202 | true / true |
| 2026-10-17T17:00:51.613Z | neighbor | 113862 | 12800 | 101062 | 0 | resp_REDACTED_0033 | 205 | true / true |
| 2026-10-17T17:01:02.613Z | neighbor | 114179 | 102272 | 11907 | 0 | resp_REDACTED_0034 | 208 | true / true |

### Sol W-C-C-W 4: confirmed_warm_cold_warm

Cold request 2026-10-17T17:01:34.988Z; prior cached-token reference 89216; actual additional uncached tokens versus that reference 76416.
Recovery: 2026-10-17T17:01:57.706Z; two pre-cold rows: true; two post-recovery rows: false.

| UTC | Position | Input | Cached | Uncached | Cache write | Response ID | Input items | Ordered prefix / stable fields |
|---|---|---:|---:|---:|---:|---|---:|---|
| 2026-10-17T17:01:02.613Z | neighbor | 114179 | 102272 | 11907 | 0 | resp_REDACTED_0034 | 208 | n/a |
| 2026-10-17T17:01:22.167Z | neighbor | 114642 | 89216 | 25426 | 0 | resp_REDACTED_0035 | 210 | true / true |
| 2026-10-17T17:01:34.988Z | cold | 116359 | 12800 | 103559 | 0 | resp_REDACTED_0036 | 212 | true / true |
| 2026-10-17T17:01:46.116Z | neighbor | 117468 | 12800 | 104668 | 0 | resp_REDACTED_0037 | 214 | true / true |
| 2026-10-17T17:01:57.706Z | neighbor | 118115 | 82304 | 35811 | 0 | resp_REDACTED_0038 | 216 | true / true |

### Sol partial recovery at capture end: partial_drop_recovery_not_fully_observed

Cold request 2026-10-17T17:02:09.919Z; prior cached-token reference 82304; actual additional uncached tokens versus that reference 76928.
Recovery: not observed; two pre-cold rows: true; two post-recovery rows: false.

| UTC | Position | Input | Cached | Uncached | Cache write | Response ID | Input items | Ordered prefix / stable fields |
|---|---|---:|---:|---:|---:|---|---:|---|
| 2026-10-17T17:01:46.116Z | neighbor | 117468 | 12800 | 104668 | 0 | resp_REDACTED_0037 | 214 | n/a |
| 2026-10-17T17:01:57.706Z | neighbor | 118115 | 82304 | 35811 | 0 | resp_REDACTED_0038 | 216 | true / true |
| 2026-10-17T17:02:09.919Z | cold | 118915 | 5376 | 113539 | 0 | resp_REDACTED_0039 | 219 | true / true |
| 2026-10-17T17:02:45.964Z | neighbor | 121097 | 12800 | 108297 | 0 | resp_REDACTED_0040 | 222 | true / true |

At the two clean single-turn triples, the cold request follows an exact append-only input prefix and identical non-input body fields; model, reasoning, and tool count are stable, and service_tier is absent in all three bodies. The observed token delta is 7,424 and 12,800 additional uncached tokens versus the immediately preceding warm cached-token count. A 17:02:09 Sol request fell from 82,304 cached tokens to 5,376 and the captured next request rose only to 12,800; that is a partial recovery at the file boundary, not a complete Warm→Cold→Warm triple.

## Luna compare and diagnostic evidence

The earlier Luna file contains twelve requests, eleven usage rows, eight physical request bodies with comparison_response_id, and seven response payloads with diagnostics exactly {"type":"unavailable"}. The eight IDs are present in the captured body passed at the physical send hook and correspond to earlier response IDs in that same file. Seven completed responses returned HTTP 200; the eighth request had no captured response or usage. Full per-request redacted details are in support-evidence.json.

This final Luna sample does not show a verified large-context Warm→Cold→Warm pattern. Its small-context chain includes cached values 0 → 9,856 → 0; we do not interpret unavailable as a miss reason or label this sequence a confirmed event. The three earlier Luna windows also contain mixed/parallel contexts and do not establish the requested continuous warm/cold/recovery sequence.

## Luna event-based natural capture

The deployed collector captured 120 Luna physical requests and 119 usage rows across two bounded windows, each stopped at 60 requests. Live state reported zero completed events in both windows. Independent offline analysis found 3 complete linked high→cold→recovery events across 22 chains (target: two). Each has two subsequent requests, a stable ordered input prefix, and an unchanged non-input body hash. Across those cold turns, uncached_tokens totaled 340762; the cached-token delta versus immediately preceding warm references totaled 308480. These are token-category amounts, not a Credits or cost calculation. The first run exposed an orphan-cold state bug; the second exposed that cold follow-up turns were incorrectly replacing an already recovered event. Commit 62909c3c fixes both and passes regression tests, and is deployed after these captures. Its live event stop behavior remains unverified because no third capture was started. The event classifications are SERVER_REUSE_FAILURE_SUSPECTED, not a confirmed OpenAI root cause.

| Capture file | UTC range | Requests / usage | Runtime stop / events | Offline complete events | Collector commit |
|---|---|---:|---|---:|---|
| requests-1792260966652.jsonl | 2026-10-17T18:17:26.788Z – 2026-10-17T18:23:58.932Z | 60 / 59 | max_requests / 0 | 2 | 2cce4fa8 |
| requests-1792261959127.jsonl | 2026-10-17T18:32:43.521Z – 2026-10-17T18:37:24.277Z | 60 / 60 | max_requests / 0 | 1 | 5dc21abb |

### INCONCLUSIVE — chain luna-chain-3

| UTC | Role | Model (request/response) | Input | Cached | Uncached | Cache write | Response ID | comparison_response_id | x-request-id | HTTP / transport | Attempt | Compaction | Diagnostics | Prefix/config match from prior |
|---|---|---|---:|---:|---:|---:|---|---|---|---|---:|---|---|---|
| 2026-10-17T18:19:26.441Z | warm | gpt-6-luna / gpt-6-luna | 361750 | 354688 | 7062 | 0 | resp_REDACTED_0041 | resp_REDACTED_0042 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | n/a |
| 2026-10-17T18:19:31.938Z | warm | gpt-6-luna / gpt-6-luna | 363059 | 336512 | 26547 | 0 | resp_REDACTED_0043 | resp_REDACTED_0041 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:19:38.522Z | cold | gpt-6-luna / gpt-6-luna | 363260 | 0 | 363260 | 0 | resp_REDACTED_0044 | resp_REDACTED_0043 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:19:45.531Z | recovery | gpt-6-luna / gpt-6-luna | 363957 | 356480 | 7477 | 0 | resp_REDACTED_0045 | resp_REDACTED_0044 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |

### INCONCLUSIVE — chain luna-chain-6

| UTC | Role | Model (request/response) | Input | Cached | Uncached | Cache write | Response ID | comparison_response_id | x-request-id | HTTP / transport | Attempt | Compaction | Diagnostics | Prefix/config match from prior |
|---|---|---|---:|---:|---:|---:|---|---|---|---|---:|---|---|---|
| 2026-10-17T18:20:32.389Z | warm | gpt-6-luna / gpt-6-luna | 88046 | 77056 | 10990 | 0 | resp_REDACTED_0046 | resp_REDACTED_0047 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | n/a |
| 2026-10-17T18:20:46.280Z | warm | gpt-6-luna / gpt-6-luna | 88746 | 72832 | 15914 | 0 | resp_REDACTED_0048 | resp_REDACTED_0046 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:20:50.790Z | cold | gpt-6-luna / gpt-6-luna | 89269 | 0 | 89269 | 0 | resp_REDACTED_0049 | resp_REDACTED_0048 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |

### INCONCLUSIVE — chain luna-chain-6

| UTC | Role | Model (request/response) | Input | Cached | Uncached | Cache write | Response ID | comparison_response_id | x-request-id | HTTP / transport | Attempt | Compaction | Diagnostics | Prefix/config match from prior |
|---|---|---|---:|---:|---:|---:|---|---|---|---|---:|---|---|---|
| 2026-10-17T18:21:15.735Z | warm | gpt-6-luna / gpt-6-luna | 91313 | 90368 | 945 | 0 | resp_REDACTED_0050 | resp_REDACTED_0051 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | n/a |
| 2026-10-17T18:21:19.950Z | warm | gpt-6-luna / gpt-6-luna | 91453 | 89728 | 1725 | 0 | resp_REDACTED_0052 | resp_REDACTED_0050 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:21:23.038Z | cold | gpt-6-luna / gpt-6-luna | 91919 | 0 | 91919 | 0 | resp_REDACTED_0053 | resp_REDACTED_0052 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |

### SERVER_REUSE_FAILURE_SUSPECTED — chain luna-chain-6

| UTC | Role | Model (request/response) | Input | Cached | Uncached | Cache write | Response ID | comparison_response_id | x-request-id | HTTP / transport | Attempt | Compaction | Diagnostics | Prefix/config match from prior |
|---|---|---|---:|---:|---:|---:|---|---|---|---|---:|---|---|---|
| 2026-10-17T18:21:51.440Z | warm | gpt-6-luna / gpt-6-luna | 94229 | 91776 | 2453 | 0 | resp_REDACTED_0004 | resp_REDACTED_0005 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | n/a |
| 2026-10-17T18:22:13.255Z | warm | gpt-6-luna / gpt-6-luna | 94548 | 91136 | 3412 | 0 | resp_REDACTED_0006 | resp_REDACTED_0004 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:22:17.309Z | cold | gpt-6-luna / gpt-6-luna | 96574 | 0 | 96574 | 0 | resp_REDACTED_0001 | resp_REDACTED_0006 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:22:20.770Z | recovery | gpt-6-luna / gpt-6-luna | 96902 | 87936 | 8966 | 0 | resp_REDACTED_0007 | resp_REDACTED_0001 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:22:27.592Z | post_recovery_1 | gpt-6-luna / gpt-6-luna | 97563 | 94080 | 3483 | 0 | resp_REDACTED_0008 | resp_REDACTED_0007 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:22:33.518Z | post_recovery_2 | gpt-6-luna / gpt-6-luna | 97989 | 72832 | 25157 | 0 | resp_REDACTED_0009 | resp_REDACTED_0008 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |

### SERVER_REUSE_FAILURE_SUSPECTED — chain luna-chain-6

| UTC | Role | Model (request/response) | Input | Cached | Uncached | Cache write | Response ID | comparison_response_id | x-request-id | HTTP / transport | Attempt | Compaction | Diagnostics | Prefix/config match from prior |
|---|---|---|---:|---:|---:|---:|---|---|---|---|---:|---|---|---|
| 2026-10-17T18:22:42.740Z | warm | gpt-6-luna / gpt-6-luna | 98411 | 74240 | 24171 | 0 | resp_REDACTED_0010 | resp_REDACTED_0011 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | n/a |
| 2026-10-17T18:22:47.861Z | warm | gpt-6-luna / gpt-6-luna | 98856 | 92672 | 6184 | 0 | resp_REDACTED_0012 | resp_REDACTED_0010 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:22:52.335Z | cold | gpt-6-luna / gpt-6-luna | 99264 | 0 | 99264 | 0 | resp_REDACTED_0002 | resp_REDACTED_0012 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:22:58.564Z | recovery | gpt-6-luna / gpt-6-luna | 101263 | 98688 | 2575 | 0 | resp_REDACTED_0013 | resp_REDACTED_0002 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:23:09.614Z | post_recovery_1 | gpt-6-luna / gpt-6-luna | 102574 | 0 | 102574 | 0 | resp_REDACTED_0014 | resp_REDACTED_0013 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:23:22.115Z | post_recovery_2 | gpt-6-luna / gpt-6-luna | 103613 | 0 | 103613 | 0 | resp_REDACTED_0015 | resp_REDACTED_0014 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |

### SERVER_REUSE_FAILURE_SUSPECTED — chain luna-chain-1

| UTC | Role | Model (request/response) | Input | Cached | Uncached | Cache write | Response ID | comparison_response_id | x-request-id | HTTP / transport | Attempt | Compaction | Diagnostics | Prefix/config match from prior |
|---|---|---|---:|---:|---:|---:|---|---|---|---|---:|---|---|---|
| 2026-10-17T18:33:05.217Z | warm | gpt-6-luna / gpt-6-luna | 144658 | 143616 | 1042 | 0 | resp_REDACTED_0016 | resp_REDACTED_0017 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | n/a |
| 2026-10-17T18:33:12.678Z | warm | gpt-6-luna / gpt-6-luna | 144801 | 124672 | 20129 | 0 | resp_REDACTED_0018 | resp_REDACTED_0016 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:33:17.014Z | cold | gpt-6-luna / gpt-6-luna | 144924 | 0 | 144924 | 0 | resp_REDACTED_0003 | resp_REDACTED_0018 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:33:21.483Z | recovery | gpt-6-luna / gpt-6-luna | 145029 | 144256 | 773 | 0 | resp_REDACTED_0019 | resp_REDACTED_0003 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:33:28.859Z | post_recovery_1 | gpt-6-luna / gpt-6-luna | 145116 | 0 | 145116 | 0 | resp_REDACTED_0020 | resp_REDACTED_0019 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:33:37.544Z | post_recovery_2 | gpt-6-luna / gpt-6-luna | 145957 | 0 | 145957 | 0 | resp_REDACTED_0021 | resp_REDACTED_0020 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |

### INCONCLUSIVE — chain luna-chain-5

| UTC | Role | Model (request/response) | Input | Cached | Uncached | Cache write | Response ID | comparison_response_id | x-request-id | HTTP / transport | Attempt | Compaction | Diagnostics | Prefix/config match from prior |
|---|---|---|---:|---:|---:|---:|---|---|---|---|---:|---|---|---|
| 2026-10-17T18:33:48.398Z | warm | gpt-6-luna / gpt-6-luna | 264471 | 228096 | 36375 | 0 | resp_REDACTED_0054 | resp_REDACTED_0055 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | n/a |
| 2026-10-17T18:33:54.882Z | warm | gpt-6-luna / gpt-6-luna | 264642 | 264064 | 578 | 0 | resp_REDACTED_0056 | resp_REDACTED_0054 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:34:04.308Z | cold | gpt-6-luna / gpt-6-luna | 265538 | 0 | 265538 | 0 | resp_REDACTED_0057 | resp_REDACTED_0056 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |

### INCONCLUSIVE — chain luna-chain-9

| UTC | Role | Model (request/response) | Input | Cached | Uncached | Cache write | Response ID | comparison_response_id | x-request-id | HTTP / transport | Attempt | Compaction | Diagnostics | Prefix/config match from prior |
|---|---|---|---:|---:|---:|---:|---|---|---|---|---:|---|---|---|
| 2026-10-17T18:36:06.487Z | warm | gpt-6-luna / gpt-6-luna | 280834 | 259200 | 21634 | 0 | resp_REDACTED_0058 | missing | missing | 200 / codex-websocket | 1 | false | null | n/a |
| 2026-10-17T18:36:14.525Z | warm | gpt-6-luna / gpt-6-luna | 284852 | 252672 | 32180 | 0 | resp_REDACTED_0059 | resp_REDACTED_0058 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |
| 2026-10-17T18:36:25.246Z | cold | gpt-6-luna / gpt-6-luna | 285132 | 0 | 285132 | 0 | resp_REDACTED_0060 | resp_REDACTED_0059 | missing | 200 / codex-websocket | 1 | false | {"type":"unavailable"} | {"orderedInputPrefix":true,"stableNonInputConfig":true} |

Across the two windows, responses had statuses {"200":120} and transports {"codex-websocket":120}. The selected events had physicalAttempt=1 and compactionRequest=false. The conversation-key hash is absent, so direct thread/session continuity cannot be confirmed from these captures. All responses visible to the hook lacked x-request-id; because the WebSocket adapter synthesizes the Response and does not expose its upgrade handshake headers, origin-level absence remains unproven. Request/config hashes, comparison IDs, response/usage associations, attempt number, compaction flag, conversation-key hash, response transport and diagnostics are retained per request in support-evidence.json without prompt text.

## Final request comparison and parameter checks

For each Sol cold event, the report compares the preceding/current request input arrays in order and checks the remaining request-body fields after removing only input and prompt_cache_options.comparison_response_id. The two confirmed triples report true / true: the previous full input is an exact prefix, and all stable fields match. Other request tails grow normally; no historical input-prefix edit is seen in these selected triples.

For the Luna final capture, comparison_response_id is independently checked in the captured physical-send body, against a preceding captured response ID. Its own field is stripped only for the prefix/config comparison; thus the diagnostic parameter does not count as a changed input prefix. See the boolean checks and body hashes in support-evidence.json.

## Headers and adapter limits

The telemetry hook reads x-request-id and openai-request-id from the response object before sanitizePassthroughHeaders runs. All sampled response objects exposed to that hook lacked those values. This rules out the normal HTTP passthrough sanitizer as the cause. It does not prove the OpenAI origin omitted a header: the capture predates transport tagging, and Codex WebSocket success returns a synthesized Response based on filtered WebSocket metadata. A WebSocket upgrade's handshake headers are not exposed by this current capture path. New event captures tag HTTP versus Codex WebSocket, but still cannot recover an unavailable handshake header.

## Classification and exclusions

- **Confirmed:** upstream usage reported sharp cached-token drops in Sol while the captured client input was append-only and stable outside normal tail growth.
- **Confirmed:** Luna compare IDs were present in physical-send request bodies; the linked calls returned HTTP 200 and seven returned diagnostics.type=unavailable.
- **Not established:** server eviction, routing migration, deliberate cache clearing, or excess subscription Credits.
- **Pending:** whether Sol supports comparison_response_id; whether comparison_response_id changes cache eligibility; whether the origin supplies x-request-id on the transport used; OpenAI's server-side reason for the three Luna cache drops.
- **Credits:** not calculated from these usage blocks. Token-category deltas are not equivalent to subscription Credits.

## Root-cause exclusion matrix

| Candidate | Existing Sol triples | Existing Luna sample | What remains to capture or ask Support |
|---|---|---|---|
| Historical input-prefix edit | Excluded for the two clean Sol triples: ordered full input prefix matched | Not a large-context cache cliff in the final window | Event capture stores per-request input hash and ordered-chain ID, not prompt text in the derived report |
| Model/reasoning/tools/service tier/format/verbosity | Excluded for the two clean Sol triples by stable non-input body hash; service tier absent | Comparison parameter is stripped only for the input/config diff; body hash retains request-body evidence | Compare each naturally observed event's stable body hash and explicit config fields |
| Diagnostic comparison option affecting eligibility | Sol triples had no comparison option | Luna final requests carry comparison_response_id; this field is excluded from the client-prefix comparison by design | OpenAI must confirm whether this diagnostic option can itself affect cache eligibility |
| Conversation/session identity | Old records did not retain a safe conversation key hash | conversationKeyHash is absent in the 120 event-capture Luna requests; response-linked cache chains are present | Direct threadId/turnId/session identity could not be verified; the capture stores only a hash when the local conversation key is available |
| Retries/reconnects/compaction/reroute | Not established from old captures | Selected event rows show physicalAttempt=1, compactionRequest=false, model/response model both gpt-6-luna, and Codex WebSocket transport | No retry/compaction was observed in these events; WebSocket reconnect state, direct session identity, and OpenAI's internal reroute remain unavailable |
| Upstream cache reuse failure | Observed usage cliff with stable captured request inputs; server cause not known | Three complete Luna Warm→Cold→Warm sequences; upstream cached_tokens=0 on each cold turn while input prefix/config stayed stable | Classified SERVER_REUSE_FAILURE_SUSPECTED; OpenAI must explain the service-side cause; unavailable diagnostics are not a cause |
| Billing / subscription Credits | Not derivable from these usage rows | Not derivable from these usage rows | Reconcile provider billing/plan records separately |

## Source basis

- src/server/responses/sol-upstream-capture.ts: startSolRequestCapture defines the time/request/byte/event bounds; captureSolUpstreamRequest records the body at the physical send hook with attempt, compaction, comparison ID and cache-chain metadata; captureSolUpstreamPayload associates response ID, raw usage and diagnostics, then runs the in-memory event state machine; captureSolUpstreamResponseHeaders records visible request IDs and transport.
- src/server/responses/passthrough-dispatch.ts: solDiagnosticBody injects comparison_response_id only during capture; onPhysicalSolRequest runs for each physical send and supplies the pre-adapter comparison body, conversation key and attempt metadata.
- src/server/responses/passthrough-delivery.ts: response header telemetry runs before normal header sanitization. The 120 event-capture responses were tagged as Codex WebSocket.
- src/server/responses/codex-ws-exchange.ts: the WebSocket path creates a synthesized Response from WebSocket metadata; it does not expose the original upgrade handshake headers, so missing x-request-id here cannot prove origin omission.
- tests/responses/sol-upstream-capture.test.ts: covers Luna linkage, physical response headers, two-event stop, stale orphan-cold recovery, and post-recovery cold follow-ups. These are local simulation tests; they do not substitute for a live observation of the final build.

## Privacy

Raw request bodies contain prompts, tool definitions, and may contain user-provided source code or credential-like text. The evidence generator scans for common credential patterns but outputs only the match count. Raw JSONL bodies are excluded from Git and this package. No request headers or authorization credentials were captured. Only the redacted report and identifiers needed to correlate support cases are included.

## Collector and test status

The original captures were made by OpenCodeX source commit 7dd65c5cef62535b1b98fae2e3558585342b9681, release artifact <local-runtime-artifact>st event capture ran commit 2cce4fa8c885011d3dcfcad2e406744d4f950b4c; the second ran commit 5dc21abb95b159db04a1fde2577a35e468bf6b85. The current fix is deployed as commit 62909c3c90f0d0f5c2205b4c515132324e09004b at <local-runtime-artifact>ss both returned 200. The current event stop logic passed unit regression tests but has not yet been re-observed on live Luna traffic. This report generator performed offline parsing only and did not initiate any model requests.

## English summary for OpenAI Support

OpenAI Support investigation summary (redacted; generated from locally preserved OpenCodeX captures)

We observed repeated cache-usage drops in GPT-6.1 Sol upstream Responses usage while consecutive captured request bodies preserved the exact prior input array as an ordered prefix and kept all non-input body fields identical. The strongest examples are 2026-10-17 16:51:50–16:52:02 UTC and 16:52:13–16:52:26 UTC: cached input went 12,800 → 5,376 → 12,800, and 12,800 → 0 → 12,800, respectively. The upstream usage blocks themselves contain those cached_tokens values. These are observed usage changes; they do not establish why the service cache did not reuse the same prefix.

For GPT-6 Luna, a later 12-request capture recorded eight physical request bodies containing prompt_cache_options.comparison_response_id. Each ID matched an earlier captured response ID; seven corresponding responses recorded HTTP 200, while the eighth request had no captured response or usage before the file ended. Seven usage payloads returned prompt_cache_diagnostics {"type":"unavailable"}. This shows parameter acceptance on the seven completed calls but provides no cache-miss reason. The Luna final 12-request sample did not establish a large-context Warm→Cold→Warm event; a small-context branch showed 0 → 9,856 → 0 cached tokens, which we do not treat as the requested event.

A pair of bounded event-based captures observed ordinary Luna traffic only. Both stopped at 60 physical requests; their live state reported zero completed events. Independent offline parsing found three complete linked high→cold→recovery sequences (two in the first window and one in the second), each followed by two requests, with ordered-prefix and non-input-config checks all true. All three cold usage rows report cached_tokens=0:
2026-10-17T18:22:17.309Z: input_tokens=96574, cached_tokens=0, uncached_tokens=96574; recovery at 2026-10-17T18:22:20.770Z reported cached_tokens=87936.
2026-10-17T18:22:52.335Z: input_tokens=99264, cached_tokens=0, uncached_tokens=99264; recovery at 2026-10-17T18:22:58.564Z reported cached_tokens=98688.
2026-10-17T18:33:17.014Z: input_tokens=144924, cached_tokens=0, uncached_tokens=144924; recovery at 2026-10-17T18:33:21.483Z reported cached_tokens=144256.
Across the three cold turns, uncached_tokens totaled 340762; the cache-hit token delta versus the immediately preceding warm references totaled 308480. These are token-category comparisons, not a Credits or cost calculation. The first runtime mismatch exposed an orphan-cold state bug; commit 5dc21abb fixed that case, but its live run still failed to count an event whose two post-recovery turns were themselves cold. Commit 62909c3c handles both cases and passes regression tests for orphan drops and cold follow-up turns. It was deployed after the two windows and has not been observed in another live capture. No model requests were generated for testing.

The earlier Luna 12-request window reported 1,500,524 input tokens, 1,088,256 cached tokens, and 412,268 uncached tokens across eleven usage rows. One of twelve requests had no captured usage block. Across all captured Luna usage rows, cache_write_tokens was present and zero. For the two fully observed Sol triples, the cold request had 7,424 and 12,800 more uncached input tokens than the immediately preceding 12,800-cached warm reference. This is a token-category delta only, not an API-cost or subscription-Credits calculation.

The response object exposed to OpenCodeX capture had no x-request-id or openai-request-id value in the sampled headers. Capture reads these headers before ordinary HTTP passthrough sanitization. However, the captured Sol/Luna records do not tag whether each response used HTTP or the Codex WebSocket adapter. That adapter synthesizes a Response from WebSocket metadata and cannot expose a WebSocket upgrade's HTTP handshake headers through the current capture. Therefore absence from the captured Response does not prove absence at the OpenAI origin.

We cannot confirm server cache eviction, backend routing migration, deliberate cache clearing, or excess subscription Credits. Please investigate why cached_tokens dropped for requests whose captured input prefix and request configuration were unchanged, and provide the cache-miss reason and request correlation IDs if available. We can supply the local raw JSONL files through an approved secure support channel; they contain prompts/tool data and are intentionally not included in this redacted report.

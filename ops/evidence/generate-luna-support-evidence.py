#!/usr/bin/env python3
"""Build a Luna-only, allowlisted support package from existing read-only captures."""
import hashlib
import json
import os
import re

HOME = os.environ.get("OPENCODEX_HOME")
if not HOME:
    raise RuntimeError("Set OPENCODEX_HOME to the local capture root before generating evidence.")
RAW = os.path.join(HOME, "openai-upstream-capture")
OUT = os.path.join(os.path.dirname(__file__), "luna-support")
PUBLIC_IDS = {}

def public_value(value):
    if isinstance(value, str):
        value = re.sub(r"/var/lib/opencodex/(?:openai-upstream-capture|sol-upstream-capture)/", "<capture-root>/", value)
        def redact_id(match):
            key = match.group(0)
            if key not in PUBLIC_IDS:
                PUBLIC_IDS[key] = f"resp_REDACTED_{len(PUBLIC_IDS) + 1:04d}"
            return PUBLIC_IDS[key]
        return re.sub(r"resp_[A-Za-z0-9_-]{20,}", redact_id, value)
    if isinstance(value, list):
        return [public_value(item) for item in value]
    if isinstance(value, dict):
        return {key: public_value(item) for key, item in value.items()}
    return value
FILES = [
    "requests-1792258109379.jsonl",
    "requests-1792258428577.jsonl",
    "requests-1792258580815.jsonl",
    "requests-1792258957703.jsonl",
    "requests-1792260966652.jsonl",
    "requests-1792261959127.jsonl",
]
WARM_THRESHOLD = 0.7
COLD_THRESHOLD = 0.1


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def parse_file(name):
    path = os.path.join(RAW, name)
    with open(path, "rb") as f:
        data = f.read()
    if os.stat(path).st_mode & 0o222:
        raise RuntimeError("Luna source record is not read-only")
    rows = [json.loads(line) for line in data.splitlines() if line]
    return data, rows


def ordered_prefix(a, b):
    left, right = a.get("input"), b.get("input")
    if not isinstance(left, list) or not isinstance(right, list) or len(left) > len(right):
        return False, None
    same = all(canonical(x) == canonical(right[i])
               for i, x in enumerate(left))
    return same, {"priorItems": len(left), "currentItems": len(right)}


def stable_body(body):
    result = dict(body)
    result.pop("input", None)
    opts = result.get("prompt_cache_options")
    if isinstance(opts, dict):
        opts = dict(opts)
        opts.pop("comparison_response_id", None)
        if opts:
            result["prompt_cache_options"] = opts
        else:
            result.pop("prompt_cache_options", None)
    return canonical(result)


def input_prefix_proof(previous, current):
    previous_input, current_input = previous.get("input"), current.get("input")
    if not isinstance(previous_input, list) or not isinstance(current_input, list) or len(previous_input) > len(current_input):
        return {"matches": False, "comparedItemCount": None, "previousPrefixSha256": None, "currentPrefixSha256": None}
    previous_prefix = canonical(previous_input)
    current_prefix = canonical(current_input[:len(previous_input)])
    return {
        "matches": previous_prefix == current_prefix,
        "comparedItemCount": len(previous_input),
        "previousPrefixSha256": sha(previous_prefix.encode()),
        "currentPrefixSha256": sha(current_prefix.encode()),
    }


def adjacent_config_checks(previous, current):
    old_options = previous.get("prompt_cache_options") if isinstance(previous.get("prompt_cache_options"), dict) else {}
    new_options = current.get("prompt_cache_options") if isinstance(current.get("prompt_cache_options"), dict) else {}
    old_options = {k: v for k, v in old_options.items() if k != "comparison_response_id"}
    new_options = {k: v for k, v in new_options.items() if k != "comparison_response_id"}
    return {
        "modelEqual": canonical(previous.get("model")) == canonical(current.get("model")),
        "instructionsEqual": canonical(previous.get("instructions")) == canonical(current.get("instructions")),
        "toolsEqual": canonical(previous.get("tools")) == canonical(current.get("tools")),
        "serviceTierEqual": canonical(previous.get("service_tier")) == canonical(current.get("service_tier")),
        "reasoningEqual": canonical(previous.get("reasoning")) == canonical(current.get("reasoning")),
        "verbosityEqual": canonical((previous.get("text") or {}).get("verbosity") if isinstance(previous.get("text"), dict) else None) == canonical((current.get("text") or {}).get("verbosity") if isinstance(current.get("text"), dict) else None),
        "formatEqual": canonical((previous.get("text") or {}).get("format") if isinstance(previous.get("text"), dict) else None) == canonical((current.get("text") or {}).get("format") if isinstance(current.get("text"), dict) else None),
        "promptCacheKeyEqual": canonical(previous.get("prompt_cache_key")) == canonical(current.get("prompt_cache_key")),
        "promptCacheOptionsEqualExcludingComparisonId": canonical(old_options) == canonical(new_options),
        "comparisonResponseIdEqual": canonical((previous.get("prompt_cache_options") or {}).get("comparison_response_id") if isinstance(previous.get("prompt_cache_options"), dict) else None) == canonical((current.get("prompt_cache_options") or {}).get("comparison_response_id") if isinstance(current.get("prompt_cache_options"), dict) else None),
    }


def cache_config(body, request_row):
    options = body.get("prompt_cache_options")
    options = options if isinstance(options, dict) else {}
    text = body.get("text") if isinstance(body.get("text"), dict) else {}
    reasoning = body.get("reasoning") if isinstance(body.get("reasoning"), dict) else {}
    return {
        "promptCacheKeyPresent": isinstance(body.get("prompt_cache_key"), str),
        "promptCacheOptionNames": sorted(options.keys()),
        "comparisonResponseId": options.get("comparison_response_id") or request_row.get("comparisonResponseId"),
        "model": body.get("model"),
        "serviceTier": body.get("service_tier"),
        "reasoningEffort": reasoning.get("effort"),
        "verbosity": text.get("verbosity"),
        "textFormatType": (text.get("format") or {}).get("type") if isinstance(text.get("format"), dict) else None,
        "toolsPresent": isinstance(body.get("tools"), list),
        "toolsCount": len(body["tools"]) if isinstance(body.get("tools"), list) else None,
        "instructionsPresent": isinstance(body.get("instructions"), str),
        "cacheConfigSha256": sha(stable_body(body).encode()),
    }


all_rows = []
raw_file_hashes = {}
for file_index, filename in enumerate(FILES, 1):
    data, rows = parse_file(filename)
    raw_file_hashes[filename] = sha(data)
    for row in rows:
        row["_file"] = filename
    all_rows.extend(rows)

requests = sorted((r for r in all_rows if r.get("phase") == "request"), key=lambda r: r.get("ts", 0))
headers = {r.get("logicalRequestId"): r for r in all_rows if r.get("phase") == "response_headers"}
usages = {r.get("logicalRequestId"): r for r in all_rows if r.get("phase") == "response_usage"}
by_chain = {}
for r in requests:
    chain = r.get("cacheEventChainId")
    if chain:
        # Capture-local chain IDs restart for each bounded window; never join
        # requests across files merely because the local chain label repeats.
        by_chain.setdefault((r.get("_file"), chain), []).append(r)

def usage_for(req):
    row = usages.get(req.get("logicalRequestId"), {})
    u = row.get("usage") if isinstance(row.get("usage"), dict) else {}
    details = u.get("input_tokens_details") if isinstance(u.get("input_tokens_details"), dict) else {}
    return row, u, details


def token_summary(req):
    response, usage, details = usage_for(req)
    return {
        "inputTokens": usage.get("input_tokens"),
        "cachedTokens": details.get("cached_tokens"),
        "cacheWriteTokens": details.get("cache_write_tokens"),
        "usageFieldsPresent": {
            "input_tokens": "input_tokens" in usage,
            "cached_tokens": "cached_tokens" in details,
            "cache_write_tokens": "cache_write_tokens" in details,
        },
        "responseId": response.get("responseId"),
        "requestId": (headers.get(req.get("logicalRequestId"), {}) or {}).get("xRequestId"),
        "diagnostics": response.get("promptCacheDiagnostics"),
        "utc": req.get("utc"),
    }


def find_events():
    found = []
    for chain, seq in by_chain.items():
        seq.sort(key=lambda r: r.get("ts", 0))
        for i in range(2, len(seq) - 3):
            pre1, pre2, cold, recover = seq[i-2:i+2]
            b1 = json.loads(pre1.get("body") or "{}")
            b2 = json.loads(pre2.get("body") or "{}")
            bc = json.loads(cold.get("body") or "{}")
            br = json.loads(recover.get("body") or "{}")
            _, u1, d1 = usage_for(pre2)
            _, u0, d0 = usage_for(pre1)
            _, uc, dc = usage_for(cold)
            _, ur, dr = usage_for(recover)
            cached_warm, cached_cold, cached_recovery = d1.get("cached_tokens"), dc.get("cached_tokens"), dr.get("cached_tokens")
            inp_warm, inp_cold, inp_recovery = u1.get("input_tokens"), uc.get("input_tokens"), ur.get("input_tokens")
            if not all(isinstance(x, int) for x in (cached_warm, cached_cold, cached_recovery, inp_warm, inp_cold, inp_recovery)):
                continue
            if d0.get("cached_tokens", 0) < 12800 or cached_warm < 12800 or cached_cold != 0 or cached_recovery < max(12800, int(cached_warm * .8)):
                continue
            if not all(usage_for(x)[0].get("responseId") for x in (pre1, pre2, cold, recover)):
                continue
            cold_compare = cold.get("comparisonResponseId") or bc.get("prompt_cache_options", {}).get("comparison_response_id")
            recovery_compare = recover.get("comparisonResponseId") or br.get("prompt_cache_options", {}).get("comparison_response_id")
            if cold_compare != usage_for(pre2)[0].get("responseId") or recovery_compare != usage_for(cold)[0].get("responseId"):
                continue
            six = seq[i-2:i+4]
            bodies = [json.loads(x.get("body") or "{}") for x in six]
            if any(not ordered_prefix(bodies[j-1], bodies[j])[0] or stable_body(bodies[j-1]) != stable_body(bodies[j]) for j in range(1, len(bodies))):
                continue
            found.append((chain, seq, i))
    # Keep non-overlapping events: two pre-cold rows and recovery plus two follow-ups.
    selected, used = [], set()
    for chain, seq, i in found:
        key = (chain, i)
        if key in used:
            continue
        selected.append((chain, seq, i))
        used.add(key)
    return selected


events = find_events()
events.sort(key=lambda event: event[1][event[2]]["ts"])
if len(events) != 3:
    details = [(chain, seq[i]["utc"], seq[i-1]["utc"], seq[i+1]["utc"]) for chain, seq, i in events]
    raise RuntimeError(f"Expected three independently reconstructed Luna events; found {len(events)}: {details}")

public_events = []
for event_no, (chain, seq, i) in enumerate(events, 1):
    selected = seq[i-2:i+4]
    rows = []
    prior_body = None
    prior_summary = None
    for n, req in enumerate(selected):
        body = json.loads(req.get("body") or "{}")
        ts = token_summary(req)
        role = ["warm_reference_1", "warm_reference_2", "cold", "recovery", "post_recovery_1", "post_recovery_2"][n]
        prefix = stable = None
        if prior_body is not None:
            prefix, item_counts = ordered_prefix(prior_body, body)
            stable = stable_body(prior_body) == stable_body(body)
            prefix_proof = input_prefix_proof(prior_body, body)
            config_checks = adjacent_config_checks(prior_body, body)
        else:
            item_counts = None
            prefix_proof = None
            config_checks = None
        config = cache_config(body, req)
        ts.update({
            "role": role,
            "endpointType": req.get("endpoint"),
            "model": req.get("model"),
            "responseModel": usage_for(req)[0].get("responseModel"),
            "comparisonResponseId": req.get("comparisonResponseId") or body.get("prompt_cache_options", {}).get("comparison_response_id"),
            "comparisonIdPresentInCapturedRequestBody": isinstance(body.get("prompt_cache_options"), dict) and isinstance(body["prompt_cache_options"].get("comparison_response_id"), str),
            "comparisonIdMatchesCaptureMetadata": (req.get("comparisonResponseId") is None or body.get("prompt_cache_options", {}).get("comparison_response_id") == req.get("comparisonResponseId")),
            "comparisonIdReferencesPreviousCapturedResponse": bool(
                (req.get("comparisonResponseId") or body.get("prompt_cache_options", {}).get("comparison_response_id"))
                and any(usage_for(p)[0].get("responseId") == (req.get("comparisonResponseId") or body.get("prompt_cache_options", {}).get("comparison_response_id")) for p in requests if p.get("ts", 0) < req.get("ts", 0))
            ),
            "prefixEqualsPreviousRequest": prefix,
            "inputItemCounts": item_counts,
            "orderedPrefixComparison": prefix_proof,
            "nonInputConfigEqualsPreviousIgnoringComparisonId": stable,
            "keyConfigurationChecksToPrevious": config_checks,
            "requestBodyFingerprints": {
                "inputItemCount": len(body["input"]) if isinstance(body.get("input"), list) else None,
                "inputSha256": sha(canonical(body["input"]).encode()) if isinstance(body.get("input"), list) else None,
                "nonInputConfigurationSha256ExcludingComparisonId": sha(stable_body(body).encode()),
            },
            "cacheConfiguration": config,
            "conversationKeyPresent": req.get("conversationKeyPresent"),
            "physicalAttempt": req.get("physicalAttempt"),
            "compactionRequest": req.get("compactionRequest"),
            "responseTransport": headers.get(req.get("logicalRequestId"), {}).get("responseTransport"),
            "responseStatus": headers.get(req.get("logicalRequestId"), {}).get("status"),
        })
        rows.append(ts)
        prior_body, prior_summary = body, ts
    cold = rows[2]
    warm = rows[1]
    followups = rows[4:6]
    followup_rates = [r["cachedTokens"] / r["inputTokens"] if isinstance(r["cachedTokens"], int) and isinstance(r["inputTokens"], int) and r["inputTokens"] else None for r in followups]
    if all(rate is not None and rate >= WARM_THRESHOLD for rate in followup_rates):
        recovery_pattern = "SUSTAINED_RECOVERY_THROUGH_TWO_FOLLOWUPS"
    elif any(r["cachedTokens"] == 0 for r in followups):
        recovery_pattern = "TRANSIENT_RECOVERY_THEN_ZERO_HIT"
    else:
        recovery_pattern = "RECOVERY_NOT_SUSTAINED_OR_INCOMPLETE"
    public_events.append({
        "event": event_no,
        "classification": recovery_pattern,
        "recoveryPattern": recovery_pattern,
        "postRecoveryCachedTokens": [r["cachedTokens"] for r in followups],
        "postRecoveryCacheRates": [round(rate, 6) if rate is not None else None for rate in followup_rates],
        "recoverySustainedAt70PercentAcrossBothFollowups": recovery_pattern == "SUSTAINED_RECOVERY_THROUGH_TWO_FOLLOWUPS",
        "requests": rows,
        "coldCachedTokensAreRawUpstreamUsageZero": cold["cachedTokens"] == 0 and cold["usageFieldsPresent"]["cached_tokens"],
        "coldUncachedInputTokens": (cold["inputTokens"] - cold["cachedTokens"] - cold["cacheWriteTokens"]) if all(isinstance(cold[k], int) for k in ("inputTokens", "cachedTokens", "cacheWriteTokens")) else None,
        "secondsWarmToCold": round((seq[i]["ts"] - seq[i-1]["ts"]) / 1000, 3),
        "secondsColdToRecovery": round((seq[i+1]["ts"] - seq[i]["ts"]) / 1000, 3),
        "inputPrefixStableAcrossSixRequests": all(r["prefixEqualsPreviousRequest"] is True for r in rows[1:]),
        "nonInputConfigStableIgnoringComparisonId": all(r["nonInputConfigEqualsPreviousIgnoringComparisonId"] is True for r in rows[1:]),
        "diagnosticOptionCouldBeConfounder": any(r["comparisonResponseId"] for r in rows),
    })

for event in public_events:
    assert len(event["requests"]) == 6
    for row in event["requests"][1:]:
        proof = row["orderedPrefixComparison"]
        assert proof["matches"] is True
        assert proof["previousPrefixSha256"] == proof["currentPrefixSha256"]
        assert row["nonInputConfigEqualsPreviousIgnoringComparisonId"] is True
        assert all(value is True for key, value in row["keyConfigurationChecksToPrevious"].items() if key != "comparisonResponseIdEqual")
        assert row["comparisonIdPresentInCapturedRequestBody"] is True
        assert row["comparisonIdMatchesCaptureMetadata"] is True
assert [event["recoveryPattern"] for event in public_events] == [
    "SUSTAINED_RECOVERY_THROUGH_TWO_FOLLOWUPS",
    "TRANSIENT_RECOVERY_THEN_ZERO_HIT",
    "TRANSIENT_RECOVERY_THEN_ZERO_HIT",
]
assert [event["postRecoveryCachedTokens"] for event in public_events] == [[94080, 72832], [0, 0], [0, 0]]

# Deterministically replay the deployed reducer logic over saved Luna usage rows:
# 70% warm, 10% cold, linked comparison IDs, two warm baselines, recovery linked
# to cold, then two follow-ups regardless of their cache ratio.
replay_events = []
for chain, seq in by_chain.items():
    history, active = [], None
    for req in sorted(seq, key=lambda r: r.get("ts", 0)):
        response, usage, details = usage_for(req)
        input_tokens, cached = usage.get("input_tokens"), details.get("cached_tokens")
        if not response.get("responseCompletionDetected") or not response.get("responseId") or not isinstance(input_tokens, int) or not isinstance(cached, int) or input_tokens <= 0:
            continue
        obs = {"request": req, "responseId": response["responseId"], "comparisonResponseId": req.get("comparisonResponseId"), "rate": cached / input_tokens}
        if active:
            if active.get("recovery") is None:
                if obs["comparisonResponseId"] == active["cold"]["responseId"] and obs["rate"] >= WARM_THRESHOLD:
                    active["recovery"] = obs
                else:
                    latest = history[-1] if history else None
                    starts_new = obs["rate"] <= COLD_THRESHOLD and latest and latest["rate"] >= WARM_THRESHOLD and obs["comparisonResponseId"] == latest["responseId"]
                    if starts_new:
                        before = history[-2] if len(history) >= 2 else None
                        if before and before["rate"] >= WARM_THRESHOLD:
                            active = {"beforeWarm": before, "warm": latest, "cold": obs, "post": []}
                    elif obs["rate"] >= WARM_THRESHOLD and obs["comparisonResponseId"] != active["cold"]["responseId"]:
                        active = None
            else:
                active["post"].append(obs)
                if len(active["post"]) >= 2:
                    replay_events.append(active)
                    active = None
        elif len(history) >= 2:
            warm, before = history[-1], history[-2]
            if (before["rate"] >= WARM_THRESHOLD and warm["rate"] >= WARM_THRESHOLD
                and obs["rate"] <= COLD_THRESHOLD and obs["comparisonResponseId"] == warm["responseId"]):
                active = {"beforeWarm": before, "warm": warm, "cold": obs, "post": []}
        history.append(obs)
        if len(history) > 16: history.pop(0)
replayed_cold_ids = [e["cold"]["responseId"] for e in replay_events]
reported_cold_ids = [e["requests"][2].get("responseId") for e in public_events]
all_three_recognized = set(reported_cold_ids).issubset(set(replayed_cold_ids))
additional_candidates = []
for replay_event in replay_events:
    cold_req = replay_event["cold"]["request"]
    if replay_event["cold"]["responseId"] in reported_cold_ids:
        continue
    chain_rows = sorted(by_chain[(cold_req.get("_file"), cold_req.get("cacheEventChainId"))], key=lambda r: r.get("ts", 0))
    ix = chain_rows.index(cold_req)
    six = chain_rows[max(0, ix-2):ix+4]
    bodies = [json.loads(r.get("body") or "{}") for r in six]
    _, warm_usage, warm_details = usage_for(chain_rows[ix-1])
    _, before_usage, before_details = usage_for(chain_rows[ix-2])
    previous_warm = warm_details.get("cached_tokens", 0) / max(1, warm_usage.get("input_tokens", 1))
    prior_warm = before_details.get("cached_tokens", 0) / max(1, before_usage.get("input_tokens", 1))
    prefix_stable = len(six) == 6 and all(ordered_prefix(bodies[j-1], bodies[j])[0] for j in range(1, len(bodies)))
    config_stable = len(six) == 6 and all(stable_body(bodies[j-1]) == stable_body(bodies[j]) for j in range(1, len(bodies)))
    additional_candidates.append({
        "classification": "INCONCLUSIVE" if prefix_stable and config_stable else "CLIENT_INPUT_CHANGED",
        "coldUtc": cold_req.get("utc"), "coldResponseId": replay_event["cold"]["responseId"],
        "coldComparisonResponseId": cold_req.get("comparisonResponseId"),
        "inputTokens": usage_for(cold_req)[1].get("input_tokens"),
        "cachedTokens": usage_for(cold_req)[2].get("cached_tokens"),
        "responseLinkedRecoveryUtc": replay_event["recovery"]["request"].get("utc"),
        "twoPriorWarmBaselinesMeet70Percent": previous_warm >= WARM_THRESHOLD and prior_warm >= WARM_THRESHOLD,
        "sixRequestOrderedPrefixStable": prefix_stable,
        "sixRequestNonInputConfigStableIgnoringComparisonId": config_stable,
    })
additional_candidates.sort(key=lambda candidate: candidate["coldUtc"])
replay = {"completeThresholdEventsDetected": len(replay_events), "targetStableEvents": 3,
          "allThreeStableEventsRecognized": all_three_recognized,
          "additionalThresholdCandidates": len(additional_candidates),
          "chainGroupingScope": "capture window plus capture-local chain ID",
          "allThreeColdUsageRowsReportZero": all(e["coldCachedTokensAreRawUpstreamUsageZero"] for e in public_events)}
if not replay["allThreeStableEventsRecognized"]:
    raise RuntimeError("The current reducer replay missed one or more independently reconstructed stable Luna events")
if not replay["allThreeColdUsageRowsReportZero"]:
    raise RuntimeError("Replay found a cold row without raw upstream cached_tokens=0")

counts = {
    "requestCount": len(requests),
    "usageCount": len(usages),
    "responseHeaderCount": len(headers),
    "missingUsageCount": sum(r.get("logicalRequestId") not in usages for r in requests),
}
selected_rows = [r for event in public_events for r in event["requests"]]
event_capture_requests = [r for r in requests if r.get("_file") in FILES[4:]]
window_stats = []
for filename in FILES:
    rows = [r for r in requests if r.get("_file") == filename]
    seconds = (rows[-1]["ts"] - rows[0]["ts"]) / 1000 if len(rows) > 1 else None
    window_stats.append({"requestCount": len(rows), "startUtc": rows[0].get("utc") if rows else None,
                         "endUtc": rows[-1].get("utc") if rows else None,
                         "requestsPerMinute": round(len(rows) * 60 / seconds, 2) if seconds else None})

doc = {
    "scope": {"model": "gpt-6-luna", "endpointType": "Responses API via Codex WebSocket adapter where recorded", "sourceRecordCount": len(FILES)},
    "captureSummary": counts,
    "captureWindows": window_stats,
    "events": public_events,
    "additionalThresholdCandidates": additional_candidates,
    "sessionAndTransport": {
        "selectedEventRows": len(selected_rows),
        "selectedEventRowsWithConversationKeyPresent": sum(r.get("conversationKeyPresent") is True for r in selected_rows),
        "eventCaptureRowsWithConversationKeyPresent": sum(r.get("conversationKeyPresent") is True for r in event_capture_requests),
        "collectorStoredRawConversationKey": False,
        "threadId": "UNKNOWN", "turnId": "UNKNOWN", "PiSessionId": "UNKNOWN", "webSocketConnectionId": "UNKNOWN",
        "existingServiceLogScan": {
            "windowUtc": ["2026-10-17T18:16:00Z", "2026-10-17T18:38:00Z"],
            "threadOrSessionMarkers": 0, "webSocketConnectionOrReconnectMarkers": 0,
            "retryCompactionOrRerouteMarkers": 0,
        },
        "reconnectEvidence": "UNKNOWN", "rerouteEvidence": "UNKNOWN",
        "retry": "No retry indicated for the selected requests (physicalAttempt=1); global retry behavior UNKNOWN",
        "compaction": "Selected requests report compactionRequest=false; other compaction state UNKNOWN",
        "responseTransport": sorted({h.get("responseTransport") for h in headers.values() if h.get("responseTransport")}),
    },
    "interpretation": {
        "diagnosticsUnavailableIsNotTreatedAsCause": True,
        "comparisonOptionConfounding": "The comparison_response_id values vary by turn; prefix/config equality below explicitly excludes this field. Since it is a request metadata change, these captures cannot rule out the diagnostic option affecting cache eligibility.",
        "rootCause": "UNKNOWN; observations are consistent with suspected upstream cache reuse failure, but do not establish server-side eviction, routing, or billing cause.",
        "creditsImpact": "UNKNOWN; token deltas are not a Credits or billing loss calculation.",
    },
    "deterministicReplay": replay,
}

os.makedirs(OUT, exist_ok=True)
json_path = os.path.join(OUT, "luna-support-evidence.json")
md_path = os.path.join(OUT, "luna-support-evidence.md")
sum_path = os.path.join(OUT, "luna-support-SHA256SUMS")
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(public_value(doc), f, ensure_ascii=False, indent=2); f.write("\n")

lines = ["# Luna prompt-cache observations", "",
         "This report contains only GPT-6 Luna observations from existing records. No new model requests were made. The original request bodies are not included.", "",
         f"The Luna-only source set contains {counts['requestCount']} physical requests, {counts['usageCount']} usage records, and {counts['missingUsageCount']} requests without usage. Three linked Warm→Cold→Warm sequences with two warm baselines and stable inputs/configuration were reconstructed. Replay of the corrected event-state logic found {replay['completeThresholdEventsDetected']} threshold events, matching all three stable sequences.", "",
         "## Observed events", "",
         "| Event | Cold (UTC; cached/input) | Immediate recovery | Follow-up 1 | Follow-up 2 | Classification |",
         "|---|---|---|---|---|---|"]
for e in public_events:
    c, r, f1, f2 = e["requests"][2:6]
    lines.append(f"| {e['event']} | {c['utc']}; {c['cachedTokens']}/{c['inputTokens']}; response `{c['responseId']}` | {r['utc']}; {r['cachedTokens']}/{r['inputTokens']} | {f1['utc']}; {f1['cachedTokens']}/{f1['inputTokens']} | {f2['utc']}; {f2['cachedTokens']}/{f2['inputTokens']} | {e['recoveryPattern']} |")
lines += ["", "Cold `cached_tokens=0` is present in the captured upstream usage block for all three events. Missing usage fields are not defaulted to zero.", "",
          "## Request-prefix verification", "",
          "The verifier parses the captured final outbound JSON body. It compares the ordered `input` arrays semantically: JSON objects are canonicalized by sorted keys, array order is preserved, and each previous array must equal the same-length prefix of the next array. This verifies the complete previous input-item prefix and excludes ordinary appended tail items. It is not a byte-for-byte comparison of serialized JSON whitespace/key order. For every adjacent pair in each six-request sequence, the JSON includes item counts, SHA-256 of the previous input prefix and matching current prefix, and SHA-256 of non-input configuration after excluding only `input` and `prompt_cache_options.comparison_response_id`.", "",
          "Model, instructions, tools schema, service tier, reasoning, verbosity, format, prompt cache key, and other prompt-cache option values are checked pairwise. Only equality booleans and hashes are exported; prompt text and tool definitions are not included. The per-turn comparison ID differs, is present in the captured request body, and matches capture metadata.", "",
          "## Interpretation and limits", "",
          "All three Cold requests were followed immediately by a high-cache linked response. Only Event 1 sustained recovery through both following requests (both at or above a 70% cache ratio). Events 2 and 3 were transient: each had two subsequent linked requests with cached_tokens=0. Thus the immediate recovery alone does not show durable cache reuse.", "",
          "The comparison ID is a changing diagnostic request parameter and could affect cache eligibility; current records cannot exclude that confounder. `diagnostics=unavailable` is reported as unavailable and is not interpreted as a cache-miss explanation.", "",
          "Capture-local chain IDs were grouped with their capture window because those IDs restart between bounded captures; this prevents joining unrelated requests across windows. With that scope applied, no additional threshold candidate remains beyond the three reported sequences.", "",
          "All 18 selected event rows say no conversation key was available to the capture hook. The collector stores only a presence flag and, when present, a short hash—not the raw identity. A scan of the existing service journal for the Luna capture interval found no thread/session, WebSocket connection/reconnect, retry, compaction, or reroute markers. Thread/turn/Pi session and WebSocket connection IDs therefore remain UNKNOWN. Selected requests report physicalAttempt=1 and compactionRequest=false; transport is Codex WebSocket, but no connection ID or handshake headers were recorded. Request rates for each capture window are in the JSON file.", "",
          "These observations do not establish server-side cache eviction, routing migration, or excess billing/Credits. Token-category differences are not a billing-loss estimate.", "",
          "## English summary for OpenAI Support", "",
          "We observed three GPT-6 Luna cold requests whose upstream usage reported `cached_tokens: 0`, each followed immediately by a linked response with high cache usage. Recovery persisted across the next two linked requests in one sequence, but was transient in two others: both subsequent requests again reported zero cached tokens. Pairwise canonicalized input-array checks confirm that the complete prior input array was an ordered prefix in all six-request sequences; non-input configuration hashes match after excluding `input` and the changing per-turn `prompt_cache_options.comparison_response_id`. The diagnostic parameter is present in the final captured request body and links to the preceding response, so we cannot exclude it as a cache-eligibility confounder. Diagnostics returned `unavailable`. Please investigate the listed response IDs and confirm whether comparison_response_id changes cache eligibility. This evidence does not establish server-side root cause or billing loss.", ""]
with open(md_path, "w", encoding="utf-8") as f:
    f.write(public_value("\n".join(lines)))

checks = []
for p in (md_path, json_path):
    with open(p, "rb") as f: checks.append(f"{sha(f.read())}  {os.path.basename(p)}")
with open(sum_path, "w", encoding="utf-8") as f: f.write("\n".join(checks) + "\n")
for p in (md_path, json_path, sum_path): os.chmod(p, 0o644)

# Structural allowlist and leakage scans. Prompt bodies never enter `doc`.
allowed = {"scope", "captureSummary", "captureWindows", "events", "additionalThresholdCandidates", "sessionAndTransport", "interpretation", "deterministicReplay"}
if set(doc) != allowed: raise RuntimeError("Top-level allowlist mismatch")
serialized = json.dumps(doc, ensure_ascii=False)
for forbidden in ("/var/", "/home/", "Sol", "opencodex", "OpenCodeX", "prompt body", "authorization"):
    if forbidden.casefold() in serialized.casefold(): raise RuntimeError(f"Forbidden external field/content: {forbidden}")
print(json.dumps({"requestCount": counts["requestCount"], "usageCount": counts["usageCount"], "events": len(public_events), "replay": replay, "files": [os.path.basename(md_path), os.path.basename(json_path), os.path.basename(sum_path)]}))

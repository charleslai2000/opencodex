#!/usr/bin/env python3
"""Request-level, metadata-only OpenAI concurrency/latency analysis.

Input is a newline-delimited OpenCodeX usage.jsonl copied from the live host. No prompt or
response bodies are read or emitted, and the persisted artifact drops the account/session
identity fields entirely: this reports transport timing, token scale, and error shape only.

Standalone operator probe. It is not imported by the proxy, the build, or the test suite, so a
Python interpreter is the only thing it needs and its absence cannot fail any gate.

    python3 scripts/analyze-codex-pro-requests.py <usage.jsonl> \\
        --start '2026-10-04 09:00' --end '2026-10-04 12:00' \\
        --label morning --output /tmp/openai-window.json
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import heapq
import json
import math
import statistics
from pathlib import Path

LOCAL = dt.datetime.now().astimezone().tzinfo

# Account/session identity is not needed to describe transport behavior, and this repository does
# not persist account identifiers from tooling. Dropped before anything is written.
IDENTITY_FIELDS = ("apiKeyId", "accountLogLabel", "conversationId", "admissionKind")


def compact_row(row: dict) -> dict:
    return {k: v for k, v in row.items() if k not in IDENTITY_FIELDS}


def mode(values: list[str]) -> str | None:
    return collections.Counter(values).most_common(1)[0][0] if values else None


def epoch(s: str) -> int:
    return int(dt.datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=LOCAL).timestamp() * 1000)


def quantile(xs: list[float], p: float) -> float | None:
    if not xs:
        return None
    a = sorted(xs)
    return a[max(0, math.ceil(p * len(a)) - 1)]


def mean(xs: list[float]) -> float | None:
    return statistics.fmean(xs) if xs else None


def bucket(n: int) -> str:
    if n <= 0: return "0"
    if n == 1: return "1"
    if n == 2: return "2"
    if n <= 4: return "3-4"
    if n <= 6: return "5-6"
    if n <= 8: return "7-8"
    if n <= 10: return "9-10"
    if n <= 12: return "11-12"
    if n <= 15: return "13-15"
    return ">15"


def n(v):
    return v if isinstance(v, (int, float)) and math.isfinite(v) and v >= 0 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("usage_jsonl", type=Path)
    ap.add_argument("--start", required=True, help="local YYYY-MM-DD HH:MM")
    ap.add_argument("--end", required=True, help="local YYYY-MM-DD HH:MM")
    ap.add_argument("--label", default="window")
    ap.add_argument("--output", type=Path, required=True, help="private compact metadata artifact path")
    ap.add_argument("--match-model", default=None,
                    help="model id for the matched low/high-concurrency comparison; default: most common successful model")
    ap.add_argument("--match-effort", default=None,
                    help="effort for that comparison; default: most common effort among that model's successes")
    args = ap.parse_args()
    begin, end = epoch(args.start), epoch(args.end)

    rows, invalid = [], 0
    with args.usage_jsonl.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            try: r = json.loads(line)
            except Exception:
                invalid += 1
                continue
            if r.get("provider") != "openai":
                continue
            t = r.get("timestamp")
            if isinstance(t, (int, float)) and begin <= t < end:
                rows.append(r)
    rows.sort(key=lambda r: (r.get("timestamp", 0), r.get("requestId", "")))

    # The top-level timestamp is the request start; durationMs is request completion elapsed.
    # Outstanding requests started before the report window are not reconstructible from this file.
    valid_intervals = []
    for i, r in enumerate(rows):
        start = r.get("timestamp"); dur = n(r.get("durationMs"))
        if isinstance(start, (int, float)) and dur is not None and dur <= 30 * 60_000:
            valid_intervals.append((start, start + dur, i))
    valid_intervals.sort()

    # Count request starts strictly before each request start, while previous request is not finished.
    active = []
    concurrency = [0] * len(rows)
    for s, e, i in valid_intervals:
        while active and active[0] <= s:
            heapq.heappop(active)
        concurrency[i] = len(active)  # already in-flight before this request starts
        heapq.heappush(active, e)

    successes = []
    for i, r in enumerate(rows):
        if r.get("status") != 200:
            continue
        u = r.get("usage") if isinstance(r.get("usage"), dict) else {}
        inp = n(u.get("inputTokens")); cache = n(u.get("cacheReadInputTokens"))
        if cache is None: cache = n(u.get("cachedInputTokens"))
        out = n(u.get("outputTokens")); uncached = max(0, inp-cache) if inp is not None and cache is not None else None
        dur = n(r.get("durationMs")); ttft = n(r.get("firstOutputMs"))
        successes.append({
            "timestamp": r.get("timestamp"), "requestId": r.get("requestId"),
            "model": r.get("model"), "effort": r.get("requestedEffort"),
            "status": r.get("status"), "latency": dur, "ttft": ttft,
            "input": inp, "cached": cache, "uncached": uncached, "output": out,
            "concurrency": concurrency[i], "usageStatus": r.get("usageStatus"),
            "cacheProvenance": r.get("cacheProvenance"),
            "attempts": r.get("attempts") if isinstance(r.get("attempts"), list) else [],
        })

    print(f"## {args.label}: {args.start} to {args.end} local")
    print(f"OpenAI records={len(rows)} successful={len(successes)} invalid_json_lines_in_scanned_file={invalid}")
    keys = sorted(set().union(*(r.keys() for r in rows))) if rows else []
    ukeys = sorted(set().union(*((r.get("usage") or {}).keys() for r in rows))) if rows else []
    akeys = sorted(set().union(*(a.keys() for r in rows for a in (r.get("attempts") or []) if isinstance(a, dict)))) if rows else []
    print("top_fields=" + ",".join(keys))
    print("usage_fields=" + ",".join(ukeys))
    print("attempt_fields=" + ",".join(akeys))
    print("request_start=timestamp; finish=timestamp+durationMs; TTFT=firstOutputMs relative to request start; no raw headers logged")

    # Request-start concurrency bucket.
    byc = collections.defaultdict(list)
    for x in successes:
        if x["latency"] is not None:
            byc[bucket(x["concurrency"])].append(x)
    order = ["0", "1", "2", "3-4", "5-6", "7-8", "9-10", "11-12", "13-15", ">15"]
    print("\nCONCURRENCY bucket count mean_s p50_s p90_s p95_s p99_s ttft_p50_s ttft_p95_s output_tps")
    for b in order:
        xs = byc[b]
        if not xs: continue
        lat = [x["latency"] / 1000 for x in xs if x["latency"] is not None]
        tt = [x["ttft"] / 1000 for x in xs if x["ttft"] is not None]
        tps = [x["output"] / (x["latency"] / 1000) for x in xs if x["output"] is not None and x["latency"]]
        print(b, len(xs), round(mean(lat), 2), round(quantile(lat,.5),2), round(quantile(lat,.9),2), round(quantile(lat,.95),2), round(quantile(lat,.99),2), round(quantile(tt,.5),2) if tt else "NA", round(quantile(tt,.95),2) if tt else "NA", round(mean(tps),2) if tps else "NA")

    # Fifteen-minute bins. Completion throughput is bucketed by finish time;
    # latency/token and errors are bucketed by start time. In-flight is time-weighted.
    qbins = collections.defaultdict(list)
    for x in successes:
        qbins[int(x["timestamp"] // 900_000)].append(x)
    allerrbins = collections.defaultdict(list)
    for r in rows:
        allerrbins[int(r["timestamp"] // 900_000)].append(r)
    minute_stats = {}
    for m in range(begin // 60_000, (end + 59_999) // 60_000):
        ms, me = m * 60_000, (m + 1) * 60_000
        events=[]
        for s,e,_ in valid_intervals:
            if e <= ms or s >= me: continue
            events.append((max(ms,s),1)); events.append((min(me,e),-1))
        events.sort(key=lambda z:(z[0],z[1]))
        active_n=0; peak_n=0; area=0; prev=ms
        for t,delta in events:
            area += active_n*(t-prev); active_n += delta; peak_n=max(peak_n,active_n); prev=t
        area += active_n*(me-prev)
        minute_stats[m]=(area/60_000,peak_n)
    print("\nTIME 15m requests_started completions_per_min mean_s p50_s p95_s ttft_mean_s ttft_p95_s mean_inflight peak_inflight inputM cachedM uncachedM outputM 429 5xx")
    for b in sorted(set(qbins) | set(allerrbins)):
        xs=qbins[b]; er=allerrbins[b]
        lat=[x["latency"]/1000 for x in xs if x["latency"] is not None]
        tt=[x["ttft"]/1000 for x in xs if x["ttft"] is not None]
        inp=sum(x["input"] or 0 for x in xs); cache=sum(x["cached"] or 0 for x in xs); unc=sum(x["uncached"] or 0 for x in xs); out=sum(x["output"] or 0 for x in xs)
        mins=[minute_stats[m] for m in range(b*15,b*15+15) if m in minute_stats]
        mean_f=mean([v[0] for v in mins]); peak_f=max([v[1] for v in mins],default=0)
        completed=sum(1 for r in rows if isinstance(r.get("durationMs"),(int,float)) and b*900_000 <= r["timestamp"]+r["durationMs"] < (b+1)*900_000)
        stamp=dt.datetime.fromtimestamp(b*900).strftime("%m-%d %H:%M")
        print(stamp,len(xs),round(completed/15,2),round(mean(lat),2) if lat else "NA",round(quantile(lat,.5),2) if lat else "NA",round(quantile(lat,.95),2) if lat else "NA",round(mean(tt),2) if tt else "NA",round(quantile(tt,.95),2) if tt else "NA",round(mean_f,2) if mean_f is not None else "NA",peak_f,round(inp/1e6,2),round(cache/1e6,2),round(unc/1e6,2),round(out/1e6,3),sum(r.get('status')==429 for r in er),sum(isinstance(r.get('status'),int) and 500<=r['status']<600 for r in er))

    # Token-size deciles and Pearson correlations over rows complete with relevant fields.
    token_rows = [x for x in successes if x["input"] is not None and x["latency"] is not None]
    token_rows.sort(key=lambda x: x["input"])
    print("\nTOKEN decile count med_input med_cached med_uncached med_output latency_p50 latency_p95 ttft_p50 ttft_p95")
    for d in range(10):
        lo=d*len(token_rows)//10; hi=(d+1)*len(token_rows)//10; xs=token_rows[lo:hi]
        if not xs: continue
        def med(key):
            v=[x[key] for x in xs if x[key] is not None]
            return round(statistics.median(v)) if v else "NA"
        lat=[x['latency']/1000 for x in xs]
        tt=[x['ttft']/1000 for x in xs if x['ttft'] is not None]
        print(d+1,len(xs),med('input'),med('cached'),med('uncached'),med('output'),round(quantile(lat,.5),2),round(quantile(lat,.95),2),round(quantile(tt,.5),2) if tt else 'NA',round(quantile(tt,.95),2) if tt else 'NA')

    def corr(a,b):
        pairs=[(x[a],x[b]) for x in token_rows if x[a] is not None and x[b] is not None]
        if len(pairs)<3:return None
        av=[p[0] for p in pairs]; bv=[p[1] for p in pairs]
        ma=statistics.mean(av); mb=statistics.mean(bv)
        den=math.sqrt(sum((x-ma)**2 for x in av)*sum((y-mb)**2 for y in bv))
        return sum((x-ma)*(y-mb) for x,y in pairs)/den if den else None
    print("\nCORRELATION pearson_input_latency",corr('input','latency'),"input_ttft",corr('input','ttft'),"uncached_latency",corr('uncached','latency'),"output_latency",corr('output','latency'))

    # Error rows: only sanitized metadata and the already-redacted public error string. Headers are absent.
    errs=[r for r in rows if r.get('status')==429 or isinstance(r.get('status'),int) and 500<=r['status']<600]
    print("\nERRORS status_count",dict(collections.Counter(str(r.get('status')) for r in errs)))
    for r in errs:
        a=(r.get('attempts') or [{}])[0]
        msg=str(r.get('upstreamError') or r.get('errorCode') or "")
        if len(msg)>180: msg=msg[:177]+"..."
        print(dt.datetime.fromtimestamp(r['timestamp']/1000).strftime('%m-%d %H:%M:%S'),r.get('requestId'),r.get('model'),r.get('requestedEffort'),r.get('status'),'duration_s',round((r.get('durationMs') or 0)/1000,2),'input',((r.get('usage') or {}).get('inputTokens')),'attempts',len(r.get('attempts') or []),'sendCount',a.get('sendCount'),'attemptStatus',a.get('status'),'attemptError',a.get('errorCode'),'msg',msg)

    # Same model/effort and near-median token scale, split at the median concurrency: the
    # like-for-like comparison that time bins alone cannot give.
    successes.sort(key=lambda x:x['timestamp'])
    good=[x for x in successes if x['input'] is not None and x['output'] is not None and x['latency'] is not None]
    medin=statistics.median(x['input'] for x in good) if good else 0
    medout=statistics.median(x['output'] for x in good) if good else 0
    match_model=args.match_model or mode([x['model'] for x in good])
    match_effort=args.match_effort or mode([x['effort'] for x in good if x['model']==match_model])
    matched=[x for x in good if x['model']==match_model and x['effort']==match_effort and .8*medin<=x['input']<=1.2*medin and .5*medout<=x['output']<=2*medout]
    print('MATCHED selector','model',match_model,'effort',match_effort,'n',len(matched))
    if matched:
        cc=sorted(x['concurrency'] for x in matched); threshold=cc[len(cc)//2]
        for label,xs in [('low-conc',[x for x in matched if x['concurrency']<=threshold]),('high-conc',[x for x in matched if x['concurrency']>threshold])]:
            lat=[x['latency']/1000 for x in xs]; tt=[x['ttft']/1000 for x in xs if x['ttft'] is not None]
            print('MATCHED',label,'n',len(xs),'concurrency_median',statistics.median(x['concurrency'] for x in xs) if xs else None,'input_median',statistics.median(x['input'] for x in xs) if xs else None,'output_median',statistics.median(x['output'] for x in xs) if xs else None,'lat_p50',quantile(lat,.5),'lat_p95',quantile(lat,.95),'ttft_p50',quantile(tt,.5),'ttft_p95',quantile(tt,.95))

    # Save compact JSON report data, no bodies, headers, or account/session identity.
    out={"label":args.label,"start":args.start,"end":args.end,
         "rows":[compact_row(r) for r in rows],"invalidLines":invalid,"successes":successes}
    args.output.write_text(json.dumps(out,separators=(",",":")))
    print("\ncompact_request_metadata_artifact",args.output)

if __name__ == '__main__':
    main()

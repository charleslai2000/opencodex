# T007 — Debug ordered affinity fallback commit

Status: DONE
Work area: ordered Responses fallback success metadata and process-local affinity lifecycle
Objective: Fix only the blocker where cross-step fallback succeeds on Luna but the next same-session logical-effort request does not hit Luna affinity.

## Completion
Prove the A–G lifecycle checkpoints, make the smallest fix so final successful fallback occurrence commits under the exact ordered affinity key, pass focused Responses tests, rerun the original Stage F runner, then run required regressions.

## Result
Root cause was the qualification topology, not fallback final-candidate propagation or ordered store validation.

The original Stage F runner sent Pi through an isolated loopback ingress. OpenCodex correctly classified those requests as:

```text
DataPlaneAdmission.kind = loopback
contextPrincipalId = undefined
```

The ordered affinity contract intentionally requires:

```text
contextPrincipalId + profileId + logicalEffort + sessionLane
```

Therefore the original runner never produced an ordered affinity key and could not commit or look up ordered affinity. The apparent Q27-after-Luna behavior was the expected no-principal/no-affinity path.

The runner was corrected without routing-runtime changes to use a remote-style isolated ingress: an isolated client proxy forwards the configured API key through a non-loopback address to the isolated OpenCodex process. This produces configured admission identity while leaving formal `3456` untouched.

With the corrected runner, the lifecycle checkpoints were observed:

```text
A/B: final Luna fallback request succeeded as provider=luna-1, model=gpt-5.6-luna, effort=medium
C/D/E: ordered binding was committed for the final occurrence step=1/candidate=1/Luna/medium
F/G: next same-session lead/medium lookup used the same ordered key and returned Luna affinity-hit
```

The corrected original Stage F runner passed:

```text
lead low    -> q9-1 @ low
lead medium -> q27-0 @ high
lead high   -> luna-1 @ high
medium same-session hit -> q27-0
Q27 same-step failure -> q27-3 @ high
Q27 pool exhausted -> luna-1 @ medium
next medium -> same luna-1 affinity-hit
high remains independent -> luna-1 @ high
Pi persistent resume preserved low and medium bindings
isolated OpenCodex restart lost mutable affinity and rebuilt medium from q27 HRW
acceptance: PASS
```

The final fix was qualification-topology-only: authenticated isolated ingress. No ordered schema, HRW, fallback ordering, upstream effort, legacy V1, or formal service behavior was changed.

## Verification
Focused ordered/legacy regressions:

```text
50 pass / 0 fail / 1200 assertions
```

Full requested V1/V1.1 regression set:

```text
215 pass / 0 fail / 2441 assertions
```

Also passed:

```text
bun run typecheck
bun run privacy:scan
git diff --check
```

Formal `127.0.0.1:3456` stayed running and healthy. All isolated processes, mock backends, client proxy, test ports, temporary homes, and session directories were cleaned after the qualification run.

## Remaining
No runtime blocker remains for the tested ordered-affinity lifecycle. Persistent affinity remains intentionally absent; restart losing mutable ordered affinity and rebuilding from stable ordered HRW is expected V1.1 behavior. No Context V2 or further feature work was started.

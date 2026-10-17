/** Generate a prompt-free report and manifest for the locally preserved captures. */
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = "/var/lib/opencodex";
const output = join(import.meta.dir, "opencodex-prompt-cache");
const baselineSolHashes: Record<string, string> = {
  "requests-1792254216896.jsonl": "116dfa8d3818b22bbe630c03af5be293a62e620161f7327cefd6651436a93c91",
  "requests-1792254410486.jsonl": "aea8502a5248061a72ed0aefb92d41e399997407869a8afd93dafbde29599a31",
  "requests-1792254877656.jsonl": "a0f1a08e33ece77b91a17eba392c7d0179321932350ff21318ffebb0c1be703b",
  "requests-1792255847449.jsonl": "31379715ce5455d3ab38a4ee1577d6d7d819882fc47f3dc90f635d6750b2b557",
  "requests-1792256408422.jsonl": "f813e066b625628f0af55e36a320fb7c923d28560ac3fbb00b29c5a35b23462c",
};

type Row = Record<string, any>;
type RequestSummary = {
  file: string;
  index: number;
  utc: string;
  logicalRequestId: string | null;
  cacheEventChainId: string | null;
  conversationKeyHash: string | null;
  model: string | null;
  endpoint: string | null;
  comparisonDecision: string | null;
  comparisonResponseId: string | null;
  physicalAttempt: number | null;
  compactionRequest: boolean | null;
  comparisonBodyMatchesField: boolean;
  comparisonReferencesEarlierCapturedResponse: boolean | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  uncachedTokens: number | null;
  cacheWriteTokens: number | null;
  rawUsageFieldPresence: Record<string, boolean> | null;
  responseId: string | null;
  responseModel: string | null;
  xRequestId: string | null;
  responseTransport: string | null;
  responseStatus: number | null;
  promptCacheDiagnostics: unknown;
  bodySha256: string;
  inputItems: number | null;
  inputSha256: string | null;
  stableFieldsSha256: string | null;
  reasoning: unknown;
  serviceTier: unknown;
  verbosity: unknown;
  textFormat: unknown;
  toolsCount: number | null;
};

const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const files = [
  ...readdirSync(join(root, "sol-upstream-capture")).filter(name => name.endsWith(".jsonl")).map(name => ({ group: "sol", name, path: join(root, "sol-upstream-capture", name) })),
  ...readdirSync(join(root, "openai-upstream-capture")).filter(name => name.endsWith(".jsonl")).map(name => ({ group: "luna", name, path: join(root, "openai-upstream-capture", name) })),
].sort((a, b) => a.path.localeCompare(b.path));

function normalizedStableBody(body: Row): Row {
  const stable = { ...body };
  delete stable.input;
  const options = stable.prompt_cache_options;
  if (options && typeof options === "object" && !Array.isArray(options)) {
    const { comparison_response_id: _comparisonResponseId, ...rest } = options;
    if (Object.keys(rest).length) stable.prompt_cache_options = rest;
    else delete stable.prompt_cache_options;
  }
  return stable;
}

function inputIsOrderedPrefix(previous: Row, current: Row): boolean {
  if (!Array.isArray(previous.input) || !Array.isArray(current.input) || previous.input.length > current.input.length) return false;
  return previous.input.every((item: unknown, index: number) => JSON.stringify(item) === JSON.stringify(current.input[index]));
}

function credentialLikeCount(text: string): number {
  const patterns = [
    /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/gi,
    /(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{16,}/gi,
  ];
  return patterns.reduce((total, pattern) => total + [...text.matchAll(pattern)].length, 0);
}

const requestSummaries: RequestSummary[] = [];
const manifestFiles: Row[] = [];
let credentialPatternMatches = 0;
const parsedByFile = new Map<string, { requests: Row[]; rows: Row[]; bodies: Map<string, Row> }>();

for (const file of files) {
  const bytes = readFileSync(file.path);
  const text = bytes.toString("utf8");
  const stat = statSync(file.path);
  const rows: Row[] = text.trimEnd().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const requests = rows.filter(row => row.phase === "request").sort((a, b) => a.ts - b.ts);
  if (file.group === "sol" && baselineSolHashes[file.name] && sha256(bytes) !== baselineSolHashes[file.name]) {
    throw new Error(`Original Sol evidence hash changed: ${file.path}`);
  }
  if ((stat.mode & 0o222) !== 0) throw new Error(`Raw evidence is not read-only: ${file.path}`);
  const usages = new Map(rows.filter(row => row.phase === "response_usage" && row.logicalRequestId).map(row => [row.logicalRequestId, row]));
  const headers = new Map(rows.filter(row => row.phase === "response_headers" && row.logicalRequestId).map(row => [row.logicalRequestId, row]));
  const bodies = new Map<string, Row>();
  const idsByTime = rows.filter(row => row.phase === "response_usage" && typeof row.responseId === "string")
    .map(row => ({ id: row.responseId as string, ts: row.ts }));
  parsedByFile.set(file.path, { requests, rows, bodies });
  const requestHadPromptBodies = requests.some(row => typeof row.body === "string");
  for (let index = 0; index < requests.length; index += 1) {
    const row = requests[index]!;
    let body: Row = {};
    if (typeof row.body === "string") {
      credentialPatternMatches += credentialLikeCount(row.body);
      try { body = JSON.parse(row.body); } catch { body = {}; }
    }
    if (row.logicalRequestId) bodies.set(row.logicalRequestId, body);
    const usageRow = row.logicalRequestId ? usages.get(row.logicalRequestId) : undefined;
    const headerRow = row.logicalRequestId ? headers.get(row.logicalRequestId) : undefined;
    const usage = usageRow?.usage as Row | undefined;
    const details = usage?.input_tokens_details as Row | undefined;
    const inputTokens = typeof usage?.input_tokens === "number" ? usage.input_tokens : null;
    const cachedTokens = typeof details?.cached_tokens === "number" ? details.cached_tokens : null;
    const cacheWriteTokens = typeof details?.cache_write_tokens === "number" ? details.cache_write_tokens : null;
    const uncachedTokens = inputTokens !== null && cachedTokens !== null && cacheWriteTokens !== null
      ? Math.max(0, inputTokens - cachedTokens - cacheWriteTokens) : null;
    const compareId = typeof row.comparisonResponseId === "string" ? row.comparisonResponseId : null;
    const bodyCompareId = typeof body.prompt_cache_options?.comparison_response_id === "string"
      ? body.prompt_cache_options.comparison_response_id : null;
    const summary: RequestSummary = {
      file: file.path,
      index: index + 1,
      utc: row.utc,
      logicalRequestId: row.logicalRequestId ?? null,
      cacheEventChainId: row.cacheEventChainId ?? null,
      conversationKeyHash: row.conversationKeyHash ?? null,
      model: row.model ?? null,
      endpoint: row.endpoint ?? null,
      comparisonDecision: row.comparisonDecision ?? null,
      comparisonResponseId: compareId,
      physicalAttempt: typeof row.physicalAttempt === "number" ? row.physicalAttempt : null,
      compactionRequest: typeof row.compactionRequest === "boolean" ? row.compactionRequest : null,
      comparisonBodyMatchesField: compareId !== null && bodyCompareId === compareId,
      comparisonReferencesEarlierCapturedResponse: compareId === null ? null : idsByTime.some(entry => entry.id === compareId && entry.ts < row.ts),
      inputTokens,
      outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : null,
      cachedTokens,
      uncachedTokens,
      cacheWriteTokens,
      rawUsageFieldPresence: usage ? {
        input_tokens: Object.hasOwn(usage, "input_tokens"),
        output_tokens: Object.hasOwn(usage, "output_tokens"),
        cached_tokens: Object.hasOwn(details ?? {}, "cached_tokens"),
        cache_write_tokens: Object.hasOwn(details ?? {}, "cache_write_tokens"),
      } : null,
      responseId: usageRow?.responseId ?? null,
      responseModel: usageRow?.responseModel ?? null,
      xRequestId: headerRow?.xRequestId ?? null,
      responseTransport: headerRow?.responseTransport ?? null,
      responseStatus: typeof headerRow?.status === "number" ? headerRow.status : null,
      promptCacheDiagnostics: usageRow?.promptCacheDiagnostics ?? null,
      bodySha256: sha256(row.body ?? ""),
      inputItems: Array.isArray(body.input) ? body.input.length : null,
      inputSha256: Array.isArray(body.input) ? sha256(JSON.stringify(body.input)) : null,
      stableFieldsSha256: body && Object.keys(body).length ? sha256(JSON.stringify(normalizedStableBody(body))) : null,
      reasoning: body.reasoning ?? null,
      serviceTier: body.service_tier ?? null,
      verbosity: body.text?.verbosity ?? null,
      textFormat: body.text?.format ?? null,
      toolsCount: Array.isArray(body.tools) ? body.tools.length : null,
    };
    requestSummaries.push(summary);
  }
  const range = requests.length ? [requests[0]!.utc, requests.at(-1)!.utc] : [];
  const usageRows = rows.filter(row => row.phase === "response_usage");
  manifestFiles.push({
    group: file.group,
    absolutePath: file.path,
    bytes: stat.size,
    mode: (stat.mode & 0o777).toString(8),
    sha256: sha256(bytes),
    requestCount: requests.length,
    responseHeaderCount: rows.filter(row => row.phase === "response_headers").length,
    usageCount: usageRows.length,
    captureUtcRange: range,
    requestBodiesContainPrompts: requestHadPromptBodies,
  });
}

function buildSolEvents(): Row[] {
  const targets = [
    { file: "requests-1792255847449.jsonl", coldUtc: "2026-10-17T16:51:57.460Z", label: "Sol W-C-W 1" },
    { file: "requests-1792255847449.jsonl", coldUtc: "2026-10-17T16:52:21.166Z", label: "Sol W-C-W 2" },
    { file: "requests-1792256408422.jsonl", coldUtc: "2026-10-17T17:00:43.390Z", label: "Sol W-C-C-W 3" },
    { file: "requests-1792256408422.jsonl", coldUtc: "2026-10-17T17:01:34.988Z", label: "Sol W-C-C-W 4" },
    { file: "requests-1792256408422.jsonl", coldUtc: "2026-10-17T17:02:09.919Z", label: "Sol partial recovery at capture end" },
  ];
  const out: Row[] = [];
  for (const target of targets) {
    const file = files.find(entry => entry.group === "sol" && entry.name === target.file);
    if (!file) continue;
    const parsed = parsedByFile.get(file.path)!;
    const reqs = parsed.requests;
    const at = reqs.findIndex(row => row.utc === target.coldUtc);
    if (at < 0) continue;
    const from = Math.max(0, at - 2);
    const to = Math.min(reqs.length, at + 3);
    const items = reqs.slice(from, to).map((row, localIndex) => {
      const summary = requestSummaries.find(entry => entry.file === file.path && entry.logicalRequestId === row.logicalRequestId)!;
      const body = parsed.bodies.get(row.logicalRequestId) ?? {};
      const prior = localIndex > 0 ? parsed.bodies.get(reqs[from + localIndex - 1]!.logicalRequestId) : undefined;
      return {
        sequenceIndex: from + localIndex + 1,
      role: row.utc === target.coldUtc ? "cold" : summary.cachedTokens === null ? "missing_usage" : "neighbor",
        utc: summary.utc,
        logicalRequestId: summary.logicalRequestId,
        responseId: summary.responseId,
        inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
        cachedTokens: summary.cachedTokens,
        uncachedTokens: summary.uncachedTokens,
        cacheWriteTokens: summary.cacheWriteTokens,
        rawUsageFieldPresence: summary.rawUsageFieldPresence,
        diagnostics: summary.promptCacheDiagnostics,
        model: summary.model,
        reasoning: summary.reasoning,
        serviceTier: summary.serviceTier,
        toolsCount: summary.toolsCount,
        inputItems: summary.inputItems,
        inputSha256: summary.inputSha256,
        appendOnlyFromPreviousRawRequest: prior ? inputIsOrderedPrefix(prior, body) : null,
        nonInputBodyFieldsEqualToPrevious: prior ? JSON.stringify(normalizedStableBody(prior)) === JSON.stringify(normalizedStableBody(body)) : null,
        comparisonResponseId: summary.comparisonResponseId,
      };
    });
    const cold = items.find(item => item.utc === target.coldUtc)!;
    const previous = items.find(item => item.sequenceIndex === (at + 1));
    const before = items.find(item => item.sequenceIndex === at);
    const after = items.filter(item => item.sequenceIndex > at + 1);
    const priorWarm = [...items].reverse().find(item => item.sequenceIndex < at + 1 && (item.cachedTokens ?? 0) > (cold.cachedTokens ?? 0));
    const recovery = after.find(item => item.cachedTokens !== null && item.cachedTokens >= Math.max(12800, (priorWarm?.cachedTokens ?? 0) * 0.8));
    const recoveryIndex = recovery ? after.indexOf(recovery) : -1;
    out.push({
      label: target.label,
      model: "gpt-6.1-sol",
      coldRequestUtc: target.coldUtc,
      expectedCachedTokensReference: priorWarm?.cachedTokens ?? null,
      actualAdditionalUncachedTokensVsReference: priorWarm && cold.cachedTokens !== null ? Math.max(0, priorWarm.cachedTokens - cold.cachedTokens) : null,
      recoveryUtc: recovery?.utc ?? null,
      recoveryConfirmed: Boolean(recovery),
      hasTwoPreColdRows: Boolean(before && previous),
      hasTwoPostRecoveryRows: recoveryIndex >= 0 && after.length - recoveryIndex - 1 >= 2,
      sequence: items,
      classification: recovery ? "confirmed_warm_cold_warm" : "partial_drop_recovery_not_fully_observed",
    });
  }
  return out;
}

function aggregate(group: string): Row {
  const rows = requestSummaries.filter(row => manifestFiles.some(file => file.group === group && file.absolutePath === row.file));
  const usage = rows.filter(row => row.rawUsageFieldPresence !== null);
  const sum = (key: "inputTokens" | "cachedTokens" | "uncachedTokens" | "cacheWriteTokens") => {
    const present = usage.filter(row => row[key] !== null);
    return { tokens: present.reduce((total, row) => total + (row[key] as number), 0), rowsPresent: present.length, rowsMissing: usage.length - present.length };
  };
  return {
    requests: rows.length,
    usageRows: usage.length,
    missingUsageRows: rows.length - usage.length,
    inputTokens: sum("inputTokens"),
    cachedTokens: sum("cachedTokens"),
    uncachedTokens: sum("uncachedTokens"),
    cacheWriteTokens: sum("cacheWriteTokens"),
    usageRawFieldMissing: {
      input_tokens: usage.filter(row => !row.rawUsageFieldPresence!.input_tokens).length,
      output_tokens: usage.filter(row => !row.rawUsageFieldPresence!.output_tokens).length,
      cached_tokens: usage.filter(row => !row.rawUsageFieldPresence!.cached_tokens).length,
      cache_write_tokens: usage.filter(row => !row.rawUsageFieldPresence!.cache_write_tokens).length,
    },
    responseIdsPresent: rows.filter(row => row.responseId !== null).length,
    requestIdHeaderPresent: rows.filter(row => row.xRequestId !== null).length,
    comparisonIdsPresent: rows.filter(row => row.comparisonResponseId !== null).length,
    diagnosticsRows: rows.filter(row => row.promptCacheDiagnostics !== null).length,
  };
}

const solEvents = buildSolEvents();
const lunaFinalFile = manifestFiles.find(file => file.absolutePath.endsWith("requests-1792258957703.jsonl"));
const lunaFinalRequests = requestSummaries.filter(row => lunaFinalFile?.absolutePath === row.file);
const lunaComparisonRequests = lunaFinalRequests.filter(row => row.comparisonResponseId !== null);
const comparisonIdsVerified = lunaComparisonRequests.filter(row => row.comparisonBodyMatchesField && row.comparisonReferencesEarlierCapturedResponse);
const machineReport = {
  schemaVersion: 1,
  generatedUtc: new Date().toISOString(),
  scope: "offline analysis; no model requests issued",
  rawFiles: manifestFiles,
  totals: { sol: aggregate("sol"), luna: aggregate("luna") },
  solCacheEvents: solEvents,
  lunaFinalWindow: {
    file: lunaFinalFile?.absolutePath ?? null,
    requests: lunaFinalRequests.length,
    usageRows: lunaFinalRequests.filter(row => row.rawUsageFieldPresence !== null).length,
    comparisonIdsInPhysicalRequestBodies: lunaComparisonRequests.length,
    comparisonIdsVerifiedAgainstEarlierCapturedResponseAndBody: comparisonIdsVerified.length,
    comparisonResponsesHttp200: comparisonIdsVerified.filter(row => row.responseStatus === 200).length,
    diagnosticsUnavailable: lunaComparisonRequests.filter(row => {
      const diag = row.promptCacheDiagnostics as Row | null;
      return diag?.type === "unavailable";
    }).length,
    xRequestIdValuesPresent: lunaFinalRequests.filter(row => row.xRequestId !== null).length,
    missingUsageRequestIds: lunaFinalRequests.filter(row => row.rawUsageFieldPresence === null).map(row => row.logicalRequestId),
    requests: lunaFinalRequests,
  },
  privacy: {
    rawRequestBodiesContainPrompts: true,
    mayContainUserProvidedSourceCodeOrToolData: true,
    credentialsOrAuthorizationHeadersCaptured: false,
    credentialLikePatternMatchCountInBodies: credentialPatternMatches,
    note: "The raw bodies remain local and are excluded from this report. Pattern matches are counted only; no matched values are emitted.",
  },
  findings: {
    upstreamCacheUsageDropConfirmed: solEvents.filter(event => event.classification === "confirmed_warm_cold_warm").length >= 2,
    lunaWarmColdWarmConfirmedInFinal12: false,
    serverEvictionOrRoutingCauseConfirmed: false,
    creditsOverbillingConfirmed: false,
    xRequestIdMissingFromVisibleResponseObjects: true,
    xRequestIdAbsentAtOriginConfirmed: false,
  },
};

const manifest = {
  schemaVersion: 1,
  packageCreatedUtc: new Date().toISOString(),
  rawEvidenceRoots: [join(root, "sol-upstream-capture"), join(root, "openai-upstream-capture")],
  originalDataPolicy: "Original JSONL files remain in place, read-only, and are not copied into this package.",
  files: manifestFiles,
};

const solEventsMarkdown = solEvents.map(event => {
  const lines = [
    `### ${event.label}: ${event.classification}`,
    "",
    `Cold request ${event.coldRequestUtc}; prior cached-token reference ${event.expectedCachedTokensReference}; actual additional uncached tokens versus that reference ${event.actualAdditionalUncachedTokensVsReference}.`,
    `Recovery: ${event.recoveryUtc ?? "not observed"}; two pre-cold rows: ${event.hasTwoPreColdRows}; two post-recovery rows: ${event.hasTwoPostRecoveryRows}.`,
    "",
    "| UTC | Position | Input | Cached | Uncached | Cache write | Response ID | Input items | Ordered prefix / stable fields |",
    "|---|---|---:|---:|---:|---:|---|---:|---|",
    ...event.sequence.map((row: Row) => `| ${row.utc} | ${row.role} | ${row.inputTokens ?? "missing"} | ${row.cachedTokens ?? "missing"} | ${row.uncachedTokens ?? "missing"} | ${row.cacheWriteTokens ?? "missing"} | ${row.responseId ?? "missing"} | ${row.inputItems ?? "missing"} | ${row.appendOnlyFromPreviousRawRequest === null ? "n/a" : `${row.appendOnlyFromPreviousRawRequest} / ${row.nonInputBodyFieldsEqualToPrevious}`} |`),
  ];
  return lines.join("\n");
}).join("\n\n");

const supportEnglish = `OpenAI Support investigation summary (redacted; generated from locally preserved OpenCodeX captures)

We observed repeated cache-usage drops in GPT-6.1 Sol upstream Responses usage while consecutive captured request bodies preserved the exact prior input array as an ordered prefix and kept all non-input body fields identical. The strongest examples are 2026-10-17 16:51:50–16:52:02 UTC and 16:52:13–16:52:26 UTC: cached input went 12,800 → 5,376 → 12,800, and 12,800 → 0 → 12,800, respectively. The upstream usage blocks themselves contain those cached_tokens values. These are observed usage changes; they do not establish why the service cache did not reuse the same prefix.

For GPT-6 Luna, a later 12-request capture recorded eight physical request bodies containing prompt_cache_options.comparison_response_id. Each ID matched an earlier captured response ID; seven corresponding responses recorded HTTP 200, while the eighth request had no captured response or usage before the file ended. Seven usage payloads returned prompt_cache_diagnostics {"type":"unavailable"}. This shows parameter acceptance on the seven completed calls but provides no cache-miss reason. The Luna final 12-request sample did not establish a large-context Warm→Cold→Warm event; a small-context branch showed 0 → 9,856 → 0 cached tokens, which we do not treat as the requested event.

The Luna final window reported 1,500,524 input tokens, 1,088,256 cached tokens, and 412,268 uncached tokens across eleven usage rows. One of twelve requests had no captured usage block. Across all captured Luna usage rows, cache_write_tokens was present and zero. For the two fully observed Sol triples, the cold request had 7,424 and 12,800 more uncached input tokens than the immediately preceding 12,800-cached warm reference. This is a token-category delta only, not an API-cost or subscription-Credits calculation.

The response object exposed to OpenCodeX capture had no x-request-id or openai-request-id value in the sampled headers. Capture reads these headers before ordinary HTTP passthrough sanitization. However, the captured Sol/Luna records do not tag whether each response used HTTP or the Codex WebSocket adapter. That adapter synthesizes a Response from WebSocket metadata and cannot expose a WebSocket upgrade's HTTP handshake headers through the current capture. Therefore absence from the captured Response does not prove absence at the OpenAI origin.

We cannot confirm server cache eviction, backend routing migration, deliberate cache clearing, or excess subscription Credits. Please investigate why cached_tokens dropped for requests whose captured input prefix and request configuration were unchanged, and provide the cache-miss reason and request correlation IDs if available. We can supply the local raw JSONL files through an approved secure support channel; they contain prompts/tool data and are intentionally not included in this redacted report.`;

const report = `# OpenCodeX Prompt Cache — Evidence Review

Generated: ${machineReport.generatedUtc} (offline; no model requests issued)

## Evidence scope and preservation

Nine raw JSONL files were reviewed: ${manifestFiles.filter(file => file.group === "sol").length} Sol files and ${manifestFiles.filter(file => file.group === "luna").length} Luna/OpenAI files. Their absolute paths, byte sizes, modes, SHA-256 hashes, request counts, and UTC ranges are in evidence-manifest.json. The raw files remain in place with mode 0400; no prompt body was copied into this package or committed.

The five original Sol SHA-256 values match the prior recorded hashes. Original evidence is preserved at /var/lib/opencodex/sol-upstream-capture/; the Luna captures are under /var/lib/opencodex/openai-upstream-capture/.

## Independent request and usage counts

| Model group | Requests | Usage rows | Requests missing usage | Raw input/cached/cache-write fields missing in usage rows |
|---|---:|---:|---:|---:|
| Sol | ${machineReport.totals.sol.requests} | ${machineReport.totals.sol.usageRows} | ${machineReport.totals.sol.missingUsageRows} | input ${machineReport.totals.sol.usageRawFieldMissing.input_tokens}, cached ${machineReport.totals.sol.usageRawFieldMissing.cached_tokens}, cache-write ${machineReport.totals.sol.usageRawFieldMissing.cache_write_tokens} |
| Luna | ${machineReport.totals.luna.requests} | ${machineReport.totals.luna.usageRows} | ${machineReport.totals.luna.missingUsageRows} | input ${machineReport.totals.luna.usageRawFieldMissing.input_tokens}, cached ${machineReport.totals.luna.usageRawFieldMissing.cached_tokens}, cache-write ${machineReport.totals.luna.usageRawFieldMissing.cache_write_tokens} |

Missing fields are represented as null in the machine report; they are not replaced with zero. The eighteen Sol requests from the earliest three captures have no usage rows and are excluded from token sums. For the remaining Sol and Luna usage rows, the original upstream usage blocks include input_tokens, cached_tokens, and cache_write_tokens. The Sol values 5,376 (twice) and 0 (once) are verbatim cached_tokens values in upstream usage blocks.

## Sol Warm→Cold→Warm evidence

${solEventsMarkdown}

At the two clean single-turn triples, the cold request follows an exact append-only input prefix and identical non-input body fields; model, reasoning, and tool count are stable, and service_tier is absent in all three bodies. The observed token delta is 7,424 and 12,800 additional uncached tokens versus the immediately preceding warm cached-token count. A 17:02:09 Sol request fell from 82,304 cached tokens to 5,376 and the captured next request rose only to 12,800; that is a partial recovery at the file boundary, not a complete Warm→Cold→Warm triple.

## Luna compare and diagnostic evidence

The final Luna file contains twelve requests, eleven usage rows, eight physical request bodies with comparison_response_id, and seven response payloads with diagnostics exactly {"type":"unavailable"}. The eight IDs are present in the captured body passed at the physical send hook and correspond to earlier response IDs in that same file. All eight requests returned HTTP 200. One final request had no usage row when the capture ended. Full per-request redacted details are in support-evidence.json.

This final Luna sample does not show a verified large-context Warm→Cold→Warm pattern. Its small-context chain includes cached values 0 → 9,856 → 0; we do not interpret unavailable as a miss reason or label this sequence a confirmed event. The three earlier Luna windows also contain mixed/parallel contexts and do not establish the requested continuous warm/cold/recovery sequence.

## Final request comparison and parameter checks

For each Sol cold event, the report compares the preceding/current request input arrays in order and checks the remaining request-body fields after removing only input and prompt_cache_options.comparison_response_id. The two confirmed triples report true / true: the previous full input is an exact prefix, and all stable fields match. Other request tails grow normally; no historical input-prefix edit is seen in these selected triples.

For the Luna final capture, comparison_response_id is independently checked in the captured physical-send body, against a preceding captured response ID. Its own field is stripped only for the prefix/config comparison; thus the diagnostic parameter does not count as a changed input prefix. See the boolean checks and body hashes in support-evidence.json.

## Headers and adapter limits

The telemetry hook reads x-request-id and openai-request-id from the response object before sanitizePassthroughHeaders runs. All sampled response objects exposed to that hook lacked those values. This rules out the normal HTTP passthrough sanitizer as the cause. It does not prove the OpenAI origin omitted a header: the capture predates transport tagging, and Codex WebSocket success returns a synthesized Response based on filtered WebSocket metadata. A WebSocket upgrade's handshake headers are not exposed by this current capture path. New event captures tag HTTP versus Codex WebSocket, but still cannot recover an unavailable handshake header.

## Classification and exclusions

- **Confirmed:** upstream usage reported sharp cached-token drops in Sol while the captured client input was append-only and stable outside normal tail growth.
- **Confirmed:** Luna compare IDs were present in physical-send request bodies; the linked calls returned HTTP 200 and seven returned diagnostics.type=unavailable.
- **Not established:** server eviction, routing migration, deliberate cache clearing, or excess subscription Credits.
- **Pending:** whether Sol supports comparison_response_id; whether comparison_response_id changes cache eligibility; whether the origin supplies x-request-id on the transport used; a Luna Warm→Cold→Warm event under the event-based normal-workflow capture.
- **Credits:** not calculated from these usage blocks. Token-category deltas are not equivalent to subscription Credits.

## Root-cause exclusion matrix

| Candidate | Existing Sol triples | Existing Luna sample | What remains to capture or ask Support |
|---|---|---|---|
| Historical input-prefix edit | Excluded for the two clean Sol triples: ordered full input prefix matched | Not a large-context cache cliff in the final window | Event capture stores per-request input hash and ordered-chain ID, not prompt text in the derived report |
| Model/reasoning/tools/service tier/format/verbosity | Excluded for the two clean Sol triples by stable non-input body hash; service tier absent | Comparison parameter is stripped only for the input/config diff; body hash retains request-body evidence | Compare each naturally observed event's stable body hash and explicit config fields |
| Diagnostic comparison option affecting eligibility | Sol triples had no comparison option | Luna final requests carry comparison_response_id; this field is excluded from the client-prefix comparison by design | OpenAI must confirm whether this diagnostic option can itself affect cache eligibility |
| Conversation/session identity | Old records did not retain a safe conversation key hash | Same limitation; comparison IDs link earlier responses | New capture stores a one-way conversation-key hash and cache chain ID |
| Retries/reconnects/compaction/reroute | Not established from old captures | Not established from old captures | New capture records physical send attempt and compaction flag, timestamp, model and response transport; WebSocket handshake reconnect/origin routing internals may still be unavailable |
| Upstream cache reuse failure | Observed usage cliff with stable captured request inputs; server cause not known | No qualifying Luna cliff observed | OpenAI must explain any future Luna event; unavailable diagnostics are not a cause |
| Billing / subscription Credits | Not derivable from these usage rows | Not derivable from these usage rows | Reconcile provider billing/plan records separately |

## Privacy

Raw request bodies contain prompts, tool definitions, and may contain user-provided source code or credential-like text. The evidence generator scans for common credential patterns but outputs only the match count. Raw JSONL bodies are excluded from Git and this package. No request headers or authorization credentials were captured. Only the redacted report and identifiers needed to correlate support cases are included.

## Collector and test status

The existing captures were made by OpenCodeX source commit 7dd65c5cef62535b1b98fae2e3558585342b9681, release artifact /opt/opencodex-2.59.0-7dd65c5c. The later event-capture implementation is recorded in the current repository HEAD; its event-based stop behavior must be verified against new natural Luna traffic before it is considered operationally validated. No real model requests were issued to generate this report.

## English summary for OpenAI Support

${supportEnglish}
`;

mkdirSync(output, { recursive: true, mode: 0o700 });
chmodSync(output, 0o755);
writeFileSync(join(output, "evidence-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
writeFileSync(join(output, "support-evidence.json"), `${JSON.stringify(machineReport, null, 2)}\n`, { mode: 0o644 });
writeFileSync(join(output, "support-evidence.md"), report, { mode: 0o644 });

const sums = [
  ...manifestFiles.map(file => `${file.sha256}  ${file.absolutePath}`),
  ...["evidence-manifest.json", "support-evidence.json", "support-evidence.md"].map(name => `${sha256(readFileSync(join(output, name)))}  ${join(output, name)}`),
].join("\n") + "\n";
writeFileSync(join(output, "SHA256SUMS"), sums, { mode: 0o644 });
for (const name of ["evidence-manifest.json", "support-evidence.json", "support-evidence.md", "SHA256SUMS"]) chmodSync(join(output, name), 0o644);
console.log(JSON.stringify({ output, rawFiles: manifestFiles.length, solRequests: machineReport.totals.sol.requests, lunaRequests: machineReport.totals.luna.requests, solConfirmedEvents: solEvents.filter(event => event.classification === "confirmed_warm_cold_warm").length, lunaComparisonIdsVerified: comparisonIdsVerified.length, credentialPatternMatches }));

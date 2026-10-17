/** Short-lived, local-only capture of OpenAI Codex Responses request bodies. */
import { appendFileSync, chmodSync, mkdirSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { getConfigDir } from "../../config";
import { OPENAI_GPT56_MODELS, OPENAI_GPT56_PRO_MODELS, OPENAI_GPT6_MODELS } from "../../providers/registry/model-seeds";

const WINDOW_MS = 10 * 60_000;
const MAX_REQUESTS = 12;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_CONVERSATIONS = 64;
const CAPTURE_MODELS = new Set<string>([
  ...OPENAI_GPT56_MODELS,
  ...OPENAI_GPT56_PRO_MODELS,
  ...OPENAI_GPT6_MODELS,
  "gpt-6.1-sol",
]);
const COMPARISON_MODELS = new Set(["gpt-6.1-sol", "gpt-6-luna"]);

let expiresAt = 0;
let captured = 0;
let totalBytes = 0;
let captureFile: string | null = null;
const capturedLogicalIds = new Map<string, string>();
const capturedLogicalConversations = new Map<string, string>();
const capturedLogicalBodies = new Map<string, string>();
const previousResponseIds = new Map<string, string>();
let previousCompletedCapture: { responseId: string; modelId: string; body: string } | null = null;

export type SolCacheComparisonDecision =
  | "capture_inactive"
  | "model_not_validated"
  | "conversation_key_match"
  | "continued_prefix_match"
  | "no_prior_response"
  | "no_matching_prior_prefix";

export interface SolRequestCaptureStatus {
  enabled: boolean;
  expiresAt: number | null;
  captured: number;
  maxRequests: number;
  maxBodyBytes: number;
  files: string[];
  models: string[];
  comparisonModels: string[];
}

export function solRequestCaptureDir(): string {
  return join(getConfigDir(), "openai-upstream-capture");
}

export function startSolRequestCapture(now = Date.now()): SolRequestCaptureStatus {
  const dir = solRequestCaptureDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* best effort */ }
  expiresAt = now + WINDOW_MS;
  captured = 0;
  totalBytes = 0;
  capturedLogicalIds.clear();
  capturedLogicalConversations.clear();
  capturedLogicalBodies.clear();
  previousResponseIds.clear();
  previousCompletedCapture = null;
  captureFile = join(dir, `requests-${now}.jsonl`);
  return getSolRequestCaptureStatus(now);
}

/** During an explicit capture only, attach the prior completed Sol response for server diagnostics. */
export function addSolCacheComparison(
  providerName: string | undefined,
  modelId: string | undefined,
  conversationKey: string | undefined,
  body: string,
  now = Date.now(),
): { body: string; decision: SolCacheComparisonDecision; comparisonResponseId?: string } {
  if (providerName !== "openai" || !modelId || !COMPARISON_MODELS.has(modelId)) {
    return { body, decision: "model_not_validated" };
  }
  if (expiresAt <= now || captured >= MAX_REQUESTS || totalBytes >= MAX_TOTAL_BYTES) {
    return { body, decision: "capture_inactive" };
  }
  const scopedConversationKey = conversationKey ? `${modelId}\0${conversationKey}` : undefined;
  const comparisonResponseId = scopedConversationKey ? previousResponseIds.get(scopedConversationKey) : undefined;
  if (comparisonResponseId) {
    return attachComparisonResponseId(body, comparisonResponseId, "conversation_key_match");
  }
  const prior = previousCompletedCapture;
  if (prior && prior.modelId === modelId && isAppendOnlyContinuation(prior.body, body)) {
    return attachComparisonResponseId(body, prior.responseId, "continued_prefix_match");
  }
  return { body, decision: prior ? "no_matching_prior_prefix" : "no_prior_response" };
}

function attachComparisonResponseId(
  body: string,
  comparisonResponseId: string,
  decision: SolCacheComparisonDecision,
): { body: string; decision: SolCacheComparisonDecision; comparisonResponseId?: string } {
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { body, decision: "no_matching_prior_prefix" };
    const options = parsed.prompt_cache_options && typeof parsed.prompt_cache_options === "object"
      && !Array.isArray(parsed.prompt_cache_options) ? parsed.prompt_cache_options : {};
    return { body: JSON.stringify({
      ...parsed,
      prompt_cache_options: { ...options, comparison_response_id: comparisonResponseId },
    }), decision, comparisonResponseId };
  } catch {
    return { body, decision: "no_matching_prior_prefix" };
  }
}

function isAppendOnlyContinuation(previousBody: string, currentBody: string): boolean {
  try {
    const previous = JSON.parse(previousBody) as Record<string, unknown>;
    const current = JSON.parse(currentBody) as Record<string, unknown>;
    const previousInput = previous.input;
    const currentInput = current.input;
    if (!Array.isArray(previousInput) || !Array.isArray(currentInput) || currentInput.length < previousInput.length) return false;
    const stripComparison = (value: Record<string, unknown>): Record<string, unknown> => {
      const { input: _input, ...stable } = value;
      const options = stable.prompt_cache_options;
      if (options && typeof options === "object" && !Array.isArray(options)) {
        const { comparison_response_id: _comparisonResponseId, ...withoutComparison } = options as Record<string, unknown>;
        if (Object.keys(withoutComparison).length > 0) stable.prompt_cache_options = withoutComparison;
        else delete stable.prompt_cache_options;
      }
      return stable;
    };
    if (JSON.stringify(stripComparison(previous)) !== JSON.stringify(stripComparison(current))) return false;
    for (let i = 0; i < previousInput.length; i += 1) {
      if (JSON.stringify(previousInput[i]) !== JSON.stringify(currentInput[i])) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function stopSolRequestCapture(): SolRequestCaptureStatus {
  expiresAt = 0;
  return getSolRequestCaptureStatus();
}

export function getSolRequestCaptureStatus(now = Date.now()): SolRequestCaptureStatus {
  if (expiresAt > 0 && now >= expiresAt) expiresAt = 0;
  let files: string[] = [];
  try { files = readdirSync(solRequestCaptureDir()).filter(name => name.endsWith(".jsonl")).sort(); } catch { /* absent */ }
  return {
    enabled: expiresAt > now && captured < MAX_REQUESTS && totalBytes < MAX_TOTAL_BYTES,
    expiresAt: expiresAt > now ? expiresAt : null,
    captured,
    maxRequests: MAX_REQUESTS,
    maxBodyBytes: MAX_BODY_BYTES,
    files,
    models: [...CAPTURE_MODELS],
    comparisonModels: [...COMPARISON_MODELS],
  };
}

/** Called on the physical HTTP send path; intentionally stores no URL, headers, or credentials. */
export function captureSolUpstreamRequest(
  providerName: string | undefined,
  modelId: string | undefined,
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
  logicalRequestId?: string,
  clientCacheFields?: { promptCacheKey?: unknown; promptCacheOptions?: unknown; comparisonDecision?: SolCacheComparisonDecision },
  conversationKey?: string,
): void {
  const now = Date.now();
  if (providerName !== "openai" || !modelId || !CAPTURE_MODELS.has(modelId)) return;
  if (expiresAt <= now || captured >= MAX_REQUESTS || totalBytes >= MAX_TOTAL_BYTES) {
    if (expiresAt > 0 && now >= expiresAt) expiresAt = 0;
    return;
  }
  const body = init?.body ?? (input instanceof Request ? input.clone().body : null);
  if (typeof body !== "string") return;
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes === 0 || bytes > MAX_BODY_BYTES || totalBytes + bytes > MAX_TOTAL_BYTES) return;
  try {
    const parsedBody = JSON.parse(body) as Record<string, unknown>;
    const cacheOptions = parsedBody.prompt_cache_options && typeof parsedBody.prompt_cache_options === "object"
      && !Array.isArray(parsedBody.prompt_cache_options) ? parsedBody.prompt_cache_options as Record<string, unknown> : {};
    const dir = solRequestCaptureDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { chmodSync(dir, 0o700); } catch { /* best effort */ }
    const path = captureFile ?? join(dir, `requests-${now}.jsonl`);
    const endpoint = typeof input === "string" || input instanceof URL
      ? new URL(String(input)).pathname
      : new URL(input.url).pathname;
    const row = JSON.stringify({
      phase: "request", ts: now, utc: new Date(now).toISOString(), logicalRequestId,
      endpoint, provider: providerName, model: modelId,
      ...(clientCacheFields?.promptCacheKey !== undefined ? { clientPromptCacheKey: clientCacheFields.promptCacheKey } : {}),
      ...(clientCacheFields?.promptCacheOptions !== undefined ? { clientPromptCacheOptions: clientCacheFields.promptCacheOptions } : {}),
      ...(clientCacheFields?.comparisonDecision !== undefined ? { comparisonDecision: clientCacheFields.comparisonDecision } : {}),
      conversationKeyPresent: Boolean(conversationKey),
      ...(conversationKey ? { conversationKeyHash: createHash("sha256").update(conversationKey).digest("hex").slice(0, 16) } : {}),
      ...(typeof cacheOptions.comparison_response_id === "string"
        ? { comparisonResponseId: cacheOptions.comparison_response_id }
        : {}),
      bodyBytes: bytes, body,
    });
    appendFileSync(path, `${row}\n`, { encoding: "utf8", mode: 0o600 });
    try { chmodSync(path, 0o600); } catch { /* best effort */ }
    captured += 1;
    totalBytes += bytes;
    if (logicalRequestId) {
      capturedLogicalIds.set(logicalRequestId, path);
      if (conversationKey) capturedLogicalConversations.set(logicalRequestId, conversationKey);
      capturedLogicalBodies.set(logicalRequestId, body);
      while (capturedLogicalIds.size > 32) capturedLogicalIds.delete(capturedLogicalIds.keys().next().value!);
    }
  } catch {
    /* A diagnostic write must never break an inference request. */
  }
}

function appendCaptureRow(logicalRequestId: string, row: Record<string, unknown>): void {
  const path = capturedLogicalIds.get(logicalRequestId);
  if (!path) return;
  try {
    const now = Date.now();
    const serialized = `${JSON.stringify({ ts: now, utc: new Date(now).toISOString(), logicalRequestId, ...row })}\n`;
    appendFileSync(path, serialized, { encoding: "utf8", mode: 0o600 });
    try { chmodSync(path, 0o600); } catch { /* best effort */ }
  } catch { /* Diagnostics must never affect delivery. */ }
}

/** Add only the upstream request ID/status from response headers; never persist all headers. */
export function captureSolUpstreamResponseHeaders(
  providerName: string,
  modelId: string,
  logicalRequestId: string | undefined,
  response: Response,
): void {
  if (providerName !== "openai" || !CAPTURE_MODELS.has(modelId) || !logicalRequestId) return;
  appendCaptureRow(logicalRequestId, {
    phase: "response_headers",
    status: response.status,
    xRequestId: response.headers.get("x-request-id") ?? response.headers.get("openai-request-id"),
  });
}

/** Record the response id, raw token usage block, and optional cache diagnostics only. */
export function captureSolUpstreamPayload(
  providerName: string,
  modelId: string,
  logicalRequestId: string | undefined,
  payload: unknown,
): void {
  if (providerName !== "openai" || !CAPTURE_MODELS.has(modelId) || !logicalRequestId
    || !payload || typeof payload !== "object" || Array.isArray(payload)) return;
  const root = payload as Record<string, unknown>;
  const response = root.response && typeof root.response === "object" && !Array.isArray(root.response)
    ? root.response as Record<string, unknown>
    : root;
  const usage = response.usage && typeof response.usage === "object" && !Array.isArray(response.usage)
    ? response.usage as Record<string, unknown>
    : null;
  const usageBlock = usage ? {
    ...(typeof usage.input_tokens === "number" ? { input_tokens: usage.input_tokens } : {}),
    ...(typeof usage.output_tokens === "number" ? { output_tokens: usage.output_tokens } : {}),
    ...(typeof usage.total_tokens === "number" ? { total_tokens: usage.total_tokens } : {}),
    ...(usage.input_tokens_details && typeof usage.input_tokens_details === "object"
      ? { input_tokens_details: usage.input_tokens_details } : {}),
  } : undefined;
  const inputTokens = typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined;
  const inputDetails = usage?.input_tokens_details && typeof usage.input_tokens_details === "object"
    ? usage.input_tokens_details as Record<string, unknown>
    : undefined;
  const cachedTokens = typeof inputDetails?.cached_tokens === "number" ? inputDetails.cached_tokens : undefined;
  const cacheWriteTokens = typeof inputDetails?.cache_write_tokens === "number" ? inputDetails.cache_write_tokens : undefined;
  const uncachedTokens = inputTokens !== undefined && cachedTokens !== undefined
    ? Math.max(0, inputTokens - cachedTokens - (cacheWriteTokens ?? 0))
    : undefined;
  const diagnostics = response.prompt_cache_diagnostics ?? root.prompt_cache_diagnostics;
  // The Codex backend may return a completed Responses object as one JSON body
  // instead of an SSE `response.completed` event. Such bodies have an id and
  // usage block but no event `type`; treat them as completed for comparison
  // chaining so a following Luna/Sol request can reference the prior response.
  const completed = root.type === "response.completed"
    || (root.type === undefined && typeof response.id === "string" && usageBlock !== undefined);
  const terminal = completed || root.type === "response.failed" || root.type === "response.incomplete";
  if (!usageBlock && diagnostics === undefined && !(terminal && typeof response.id === "string")) return;
  const conversationKey = capturedLogicalConversations.get(logicalRequestId);
  const scopedConversationKey = conversationKey ? `${modelId}\0${conversationKey}` : undefined;
  if (completed && typeof response.id === "string" && scopedConversationKey) {
    previousResponseIds.delete(scopedConversationKey);
    previousResponseIds.set(scopedConversationKey, response.id);
    while (previousResponseIds.size > MAX_CONVERSATIONS) previousResponseIds.delete(previousResponseIds.keys().next().value!);
  }
  if (completed && typeof response.id === "string") {
    const requestBody = capturedLogicalBodies.get(logicalRequestId);
    if (requestBody) previousCompletedCapture = { responseId: response.id, modelId, body: requestBody };
  }
  appendCaptureRow(logicalRequestId, {
    phase: "response_usage",
    ...(typeof response.id === "string" ? { responseId: response.id } : {}),
    ...(typeof response.model === "string" ? { responseModel: response.model } : {}),
    ...(usageBlock ? { usage: usageBlock } : {}),
    ...(inputTokens !== undefined ? { inputTokenCategories: {
      inputTokens,
      ...(cachedTokens !== undefined ? { cachedTokens } : {}),
      ...(uncachedTokens !== undefined ? { uncachedTokens } : {}),
      ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    } } : {}),
    ...(diagnostics !== undefined ? { promptCacheDiagnostics: diagnostics } : {}),
  });
  if (terminal) {
    capturedLogicalIds.delete(logicalRequestId);
    capturedLogicalConversations.delete(logicalRequestId);
    capturedLogicalBodies.delete(logicalRequestId);
  }
}

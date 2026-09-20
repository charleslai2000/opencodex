import { comboFailureDecision } from "../../combos/failover";
import { readBoundedResponseBody } from "../../lib/bounded-body";
import { readJsonRequestBody, resolveInboundBodyLimitBytes } from "../request-decompress";
import { finishRequestAttempt, type RequestLogContext } from "../request-log";
import { linkRequestSessionLane } from "../request-log-conversation";
import type { OcxConfig } from "../../types";
import type { RouteCandidateTrace, RouteDecisionTraceV1 } from "../../routing/trace";
import { handleResponses as handleResponsesCore } from "./core";
import { requestPacingOverloadResponse } from "./pacing-overload";
import { captureExplicitOpenAiCallerAuth } from "../../providers/openai-sidecar";
import { captureCallerDirectAuth } from "../../providers/caller-authorization";
import { forgetOrderedAffinity, rememberOrderedAffinity, rememberPolicyAffinity } from "../../routing/session-affinity";
import { orderedCandidateKey } from "../../routing/ordered-route";
import { rankCandidatesByHrw } from "../../routing/replica-placement";

type CoreHandler = typeof handleResponsesCore;
type CoreOptions = Parameters<CoreHandler>[3];

export interface PolicyFallbackDeps {
  runCore?: CoreHandler;
}

function candidateKey(candidate: Pick<RouteCandidateTrace, "provider" | "model">): string {
  return `${candidate.provider}\u0000${candidate.model}`;
}

function orderedKey(candidate: RouteCandidateTrace): string {
  return candidate.stepIndex !== undefined && candidate.candidateIndex !== undefined
    ? orderedCandidateKey(candidate as RouteCandidateTrace & { stepIndex: number; candidateIndex: number })
    : candidateKey(candidate);
}

function orderedFallbackCandidates(trace: RouteDecisionTraceV1, tried: ReadonlySet<string>, placementKey?: string): RouteCandidateTrace[] {
  const ordered = trace.candidates.filter(candidate => candidate.stepIndex !== undefined && candidate.candidateIndex !== undefined);
  if (ordered.length === 0) return [];
  const steps = [...new Set(ordered.map(candidate => candidate.stepIndex!))].sort((a, b) => a - b);
  for (const stepIndex of steps) {
    const remaining = ordered
      .filter(candidate => candidate.stepIndex === stepIndex && candidate.eligible && candidate.exclusions.length === 0 && !tried.has(orderedKey(candidate)));
    if (remaining.length > 0) return placementKey ? rankCandidatesByHrw(placementKey, remaining) : remaining;
  }
  return [];
}

/**
 * Rank the remaining candidates from the ORIGINAL policy trace. The initial
 * decision stays immutable; fallback execution belongs in attempts[], not in a
 * rewritten decision trace.
 */
export function rankPolicyFallbackCandidates(
  trace: RouteDecisionTraceV1,
  tried: ReadonlySet<string>,
): RouteCandidateTrace[] {
  return trace.candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) =>
      candidate.eligible
      && candidate.exclusions.length === 0
      && !tried.has(candidateKey(candidate)))
    .sort((left, right) => {
      const scoreDelta = (right.candidate.score?.total ?? Number.NEGATIVE_INFINITY)
        - (left.candidate.score?.total ?? Number.NEGATIVE_INFINITY);
      return scoreDelta || left.index - right.index;
    })
    .map(({ candidate }) => candidate);
}

function requestWithCandidate(
  req: Request,
  rawBody: Record<string, unknown>,
  candidate: Pick<RouteCandidateTrace, "provider" | "model" | "upstreamEffort">,
): Request {
  const headers = new Headers(req.headers);
  // The next candidate owns a different physical credential domain. Typed
  // admission and any claimed Claude snapshot stay in caller-owned CoreOptions.
  headers.delete("authorization");
  headers.delete("chatgpt-account-id");
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const retryBody = { ...rawBody, model: `${candidate.provider}/${candidate.model}` } as Record<string, unknown>;
  if (candidate.upstreamEffort && retryBody.reasoning && typeof retryBody.reasoning === "object") {
    retryBody.reasoning = { ...(retryBody.reasoning as Record<string, unknown>), effort: candidate.upstreamEffort };
  }
  if (candidate.upstreamEffort && typeof retryBody.reasoning_effort === "string") retryBody.reasoning_effort = candidate.upstreamEffort;
  const retryRequest = new Request(req.url, {
    method: req.method,
    headers,
    body: JSON.stringify(retryBody),
    signal: req.signal,
  });
  // A sessionless request keeps the lane it was already allocated. Without this the second
  // candidate reaches OpenCode Go under a different x-opencode-session than the first attempt,
  // which is the same conversation split the header exists to prevent.
  linkRequestSessionLane(req, retryRequest);
  return retryRequest;
}

function errorCodeFromText(text: string): string | undefined {
  if (!text) return undefined;
  try {
    const payload = JSON.parse(text) as { error?: { code?: unknown; type?: unknown }; code?: unknown };
    const candidate = payload.error?.code ?? payload.error?.type ?? payload.code;
    return typeof candidate === "string" ? candidate : undefined;
  } catch {
    return undefined;
  }
}

async function shouldHopPolicyCandidate(response: Response, signal?: AbortSignal): Promise<boolean> {
  if (response.status < 400 || signal?.aborted) return false;
  try {
    const inspected = await readBoundedResponseBody(response.clone(), { signal });
    const text = inspected.displaySafe ? inspected.text : "";
    return comboFailureDecision(response.status, text, { code: errorCodeFromText(text) }) === "hop";
  } catch {
    return false;
  }
}

function isPolicyDecision(trace: RouteDecisionTraceV1 | undefined): trace is RouteDecisionTraceV1 {
  return trace?.routeKind === "policy" && !!trace.profile;
}

/** Finalize the failed physical attempt so the retry receives a fresh attempt row. */
function finishFailedPolicyAttempt(logCtx: RequestLogContext, status: number): void {
  const attempt = logCtx.activeAttempt;
  if (attempt) {
    const startedAt = logCtx.activeAttemptStartedAt ?? Date.now();
    finishRequestAttempt(attempt, status, Math.max(0, Date.now() - startedAt), attempt.usage ?? logCtx.usage);
  }
  delete logCtx.activeAttempt;
  delete logCtx.activeAttemptStartedAt;
  delete logCtx.usage;
  delete logCtx.usageFromBridge;
  delete logCtx.upstreamError;
  delete logCtx.terminalHttpStatus;
  delete logCtx.terminalErrorCode;
  delete logCtx.terminalIncompleteReason;
}

/**
 * Run a Responses request and, only for an explicitly selected policy profile,
 * hop to the next eligible policy candidate after a retryable pre-success
 * failure. The initial policy trace remains the canonical selection evidence;
 * physical retries continue to accumulate in the existing request attempts.
 */
export async function handleResponsesWithPolicyFallback(
  req: Request,
  config: OcxConfig,
  logCtx: RequestLogContext,
  options: CoreOptions = {},
  deps: PolicyFallbackDeps = {},
): Promise<Response> {
  const runCore = deps.runCore ?? handleResponsesCore;
  let requestBodyReadNotified = false;
  let storedPool401ReplayDispatched = false;
  const coreOptions: CoreOptions = {
    ...options,
    openAiSidecarAuth: options.openAiSidecarAuth === undefined
      ? captureExplicitOpenAiCallerAuth(req.headers, config) : options.openAiSidecarAuth,
    nativeCallerAuth: options.nativeCallerAuth === undefined
      ? captureExplicitOpenAiCallerAuth(req.headers, config) : options.nativeCallerAuth,
    callerDirectAuth: options.callerDirectAuth === undefined
      ? captureCallerDirectAuth(req.headers, config) : options.callerDirectAuth,
    ...(options.onRequestBodyRead ? {
      onRequestBodyRead: () => {
        if (requestBodyReadNotified) return;
        requestBodyReadNotified = true;
        options.onRequestBodyRead?.();
      },
    } : {}),
    onStoredPool401ReplayDispatched: () => {
      storedPool401ReplayDispatched = true;
      options.onStoredPool401ReplayDispatched?.();
    },
  };
  let rawBody: Record<string, unknown> | null = null;
  try {
    const parsed = await readJsonRequestBody(
      req.clone(),
      undefined,
      resolveInboundBodyLimitBytes(config.maxInboundBodyBytes),
    );
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) rawBody = parsed as Record<string, unknown>;
  } catch {
    // Core owns the client-facing parse/decompression error.
  }

  let response: Response;
  try {
    response = await runCore(req, config, logCtx, coreOptions);
  } catch (error) {
    const overload = requestPacingOverloadResponse(error);
    if (overload) return overload;
    throw error;
  }
  const initialTrace = logCtx.routeDecision;
  const initialRequestedModel = logCtx.requestedModel;
  if (!rawBody || !isPolicyDecision(initialTrace)) return response;
  const hasOrderedCandidates = initialTrace.candidates.some(candidate => candidate.stepIndex !== undefined && candidate.candidateIndex !== undefined);
  const initialCandidate = initialTrace.candidates[initialTrace.selected.candidateIndex];

  const orderedPlacementKey = logCtx.orderedPlacementKey;
  const tried = new Set<string>([
    hasOrderedCandidates && initialCandidate
      ? orderedKey(initialCandidate)
      : candidateKey({ provider: initialTrace.selected.provider, model: initialTrace.selected.model }),
  ]);

  while (!storedPool401ReplayDispatched && await shouldHopPolicyCandidate(response, req.signal)) {
    if (req.signal.aborted) return response;
    const next = hasOrderedCandidates
      ? orderedFallbackCandidates(initialTrace, tried, orderedPlacementKey)[0]
      : rankPolicyFallbackCandidates(initialTrace, tried)[0];
    if (!next) return response;
    if (logCtx.orderedAffinityKey) forgetOrderedAffinity(logCtx.orderedAffinityKey);
    tried.add(hasOrderedCandidates ? orderedKey(next) : candidateKey(next));
    if (logCtx.policyAffinityKey) {
      logCtx.policyAffinityTarget = { provider: next.provider, model: next.model };
    }
    if (logCtx.orderedAffinityKey && next.stepIndex !== undefined && next.candidateIndex !== undefined && next.upstreamEffort) {
      logCtx.orderedAffinityTarget = { stepIndex: next.stepIndex, candidateIndex: next.candidateIndex, provider: next.provider, model: next.model, upstreamEffort: next.upstreamEffort };
    }

    finishFailedPolicyAttempt(logCtx, response.status);
    const retryRequest = requestWithCandidate(req, rawBody, next);
    try {
      try {
        response = await runCore(retryRequest, config, logCtx, coreOptions);
        if (response.status < 400) {
          if (logCtx.policyAffinityKey && logCtx.policyAffinityTarget) rememberPolicyAffinity(logCtx.policyAffinityKey, logCtx.policyAffinityTarget);
          const occurrence = next.stepIndex !== undefined && next.candidateIndex !== undefined && next.upstreamEffort ? { stepIndex: next.stepIndex, candidateIndex: next.candidateIndex, provider: next.provider, model: next.model, upstreamEffort: next.upstreamEffort } : undefined;
          if (logCtx.orderedAffinityKey && occurrence) { logCtx.orderedAffinityTarget = occurrence; rememberOrderedAffinity(logCtx.orderedAffinityKey, occurrence); }
        }
      } catch (error) {
        const overload = requestPacingOverloadResponse(error);
        if (overload) return overload;
        throw error;
      }
    } finally {
      logCtx.requestedModel = initialRequestedModel;
      logCtx.routeDecision = initialTrace;
    }
  }

  return response;
}

export const handleResponses = handleResponsesWithPolicyFallback;

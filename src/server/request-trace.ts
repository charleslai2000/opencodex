import type { RequestTraceLog } from "./request-log";

const TRACE_ID = /^EFFORT_TRACE_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A caller-opt-in opaque correlation token for one request. It is deliberately
 * narrower than a general header logger: accepted values are test UUIDs only,
 * and the request log retains routing metadata rather than any body or header.
 */
export function requestTraceId(headers: Headers): string | undefined {
  const value = headers.get("x-ocx-trace-id")?.trim();
  return value && TRACE_ID.test(value) ? value : undefined;
}

export function requestTraceLog(traceId: string | undefined): RequestTraceLog | undefined {
  return traceId === undefined ? undefined : { traceId };
}

import { createHash } from "node:crypto";
import { readRuntimePort, type RuntimePortState } from "../config/process-state";
import {
  LOCAL_ATTESTATION_CHALLENGE_HEADER, LOCAL_ATTESTATION_PROOF_HEADER,
  createLocalAttestationChallenge, verifyLocalAttestationProof,
} from "../lib/local-management-attestation";
import {
  LOCAL_ROUTING_RELOAD_CAPABILITY_HEADER, LOCAL_ROUTING_RELOAD_CAPABILITY_TTL_MS,
  LOCAL_ROUTING_RELOAD_EXPECTED_PID_HEADER, LOCAL_ROUTING_RELOAD_EXPIRES_AT_HEADER,
  LOCAL_ROUTING_RELOAD_CONFIG_HASH_HEADER, LOCAL_ROUTING_RELOAD_METHOD,
  LOCAL_ROUTING_RELOAD_NONCE_HEADER, LOCAL_ROUTING_RELOAD_PATH,
  createLocalRoutingReloadCapability,
} from "../lib/local-routing-reload-contract";
import { directLocalHttpFetch } from "./direct-local-http";
import { findLiveProxy, isOpencodexHealthz, probeHostname, type HealthzIdentity, type LiveProxy } from "./proxy-liveness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configuredAdminToken } from "../lib/admin-secrets";

export interface RoutingReloadResult { ok: true; pid: number; configHash: string; routingFingerprint: string; routingPreset: string | null; routingProfiles: unknown; catalog: unknown }
export interface RoutingStateResult { pid: number; routingFingerprint: string; routingPreset: string | null; routingProfiles: unknown; catalog: unknown }
export interface RoutingReloadDeps { fetchImpl?: typeof fetch; readRuntime?: (pid: number) => RuntimePortState | null; readConfigBytes: () => Uint8Array; createNonce?: () => string; now?: () => number; timeoutMs?: number }

export async function requestBoundLocalRoutingReload(target: LiveProxy, deps: RoutingReloadDeps): Promise<RoutingReloadResult> {
  if (target.source !== "runtime" || target.pid === null || target.pid <= 0) throw new Error("unattested proxy process");
  const readRuntime = deps.readRuntime ?? readRuntimePort;
  const runtime = readRuntime(target.pid);
  if (!runtime?.attestationSecret || runtime.pid !== target.pid || runtime.port !== target.port) throw new Error("proxy runtime identity changed");
  const fetchImpl = deps.fetchImpl ?? directLocalHttpFetch;
  const timeoutMs = deps.timeoutMs ?? 5_000;
  const nonce = (deps.createNonce ?? createLocalAttestationChallenge)();
  const base = `http://${probeHostname(target.hostname)}:${target.port}`;
  const proofResponse = await fetchImpl(`${base}/healthz`, { headers: { [LOCAL_ATTESTATION_CHALLENGE_HEADER]: nonce }, signal: AbortSignal.timeout(timeoutMs) });
  const health = await proofResponse.json().catch(() => null) as HealthzIdentity | null;
  if (!proofResponse.ok || !isOpencodexHealthz(health) || health?.pid !== target.pid || health?.port !== target.port
    || health.routingReloadCapability !== "v1"
    || !verifyLocalAttestationProof(runtime.attestationSecret, nonce, target.pid, target.port, proofResponse.headers.get(LOCAL_ATTESTATION_PROOF_HEADER))) throw new Error("proxy attestation failed or routing reload unsupported");
  const current = readRuntime(target.pid);
  if (!current || current.pid !== runtime.pid || current.port !== runtime.port || current.attestationSecret !== runtime.attestationSecret) throw new Error("proxy runtime identity changed");
  const bytes = deps.readConfigBytes();
  const configHash = createHash("sha256").update(bytes).digest("hex");
  const expiresAt = (deps.now ?? Date.now)() + LOCAL_ROUTING_RELOAD_CAPABILITY_TTL_MS;
  const capability = createLocalRoutingReloadCapability(runtime.attestationSecret, nonce, LOCAL_ROUTING_RELOAD_METHOD, LOCAL_ROUTING_RELOAD_PATH, target.pid, target.port, expiresAt, configHash);
  if (!capability) throw new Error("routing reload capability unavailable");
  const response = await fetchImpl(`${base}${LOCAL_ROUTING_RELOAD_PATH}`, { method: LOCAL_ROUTING_RELOAD_METHOD, headers: {
    "content-length": "0", [LOCAL_ROUTING_RELOAD_EXPECTED_PID_HEADER]: String(target.pid), [LOCAL_ROUTING_RELOAD_NONCE_HEADER]: nonce,
    [LOCAL_ROUTING_RELOAD_EXPIRES_AT_HEADER]: String(expiresAt), [LOCAL_ROUTING_RELOAD_CONFIG_HASH_HEADER]: configHash,
    [LOCAL_ROUTING_RELOAD_CAPABILITY_HEADER]: capability,
  }, signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || body?.success !== true) throw new Error(typeof body?.error === "string" ? body.error : `routing reload rejected (${response.status})`);
  if (body.configHash !== configHash || typeof body.routingFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(body.routingFingerprint)) throw new Error("routing reload response identity mismatch");
  const after = readRuntime(target.pid);
  if (!after || after.pid !== runtime.pid || after.port !== runtime.port || after.attestationSecret !== runtime.attestationSecret) throw new Error("proxy runtime identity changed during routing reload");
  return { ok: true, pid: target.pid, configHash, routingFingerprint: body.routingFingerprint, routingPreset: typeof body.routingPreset === "string" ? body.routingPreset : null, routingProfiles: body.routingProfiles, catalog: body.catalog };
}

export async function requestBoundLocalRoutingState(target: LiveProxy, deps: Omit<RoutingReloadDeps, "readConfigBytes">): Promise<RoutingStateResult> {
  if (target.source !== "runtime" || target.pid === null) throw new Error("unattested proxy process");
  const runtime = (deps.readRuntime ?? readRuntimePort)(target.pid);
  if (!runtime?.attestationSecret || runtime.pid !== target.pid || runtime.port !== target.port) throw new Error("proxy runtime identity changed");
  const fetchImpl = deps.fetchImpl ?? directLocalHttpFetch;
  const nonce = (deps.createNonce ?? createLocalAttestationChallenge)();
  const base = `http://${probeHostname(target.hostname)}:${target.port}`;
  const proof = await fetchImpl(`${base}/healthz`, { headers: { [LOCAL_ATTESTATION_CHALLENGE_HEADER]: nonce }, signal: AbortSignal.timeout(deps.timeoutMs ?? 5000) });
  const health = await proof.json().catch(() => null) as HealthzIdentity | null;
  if (!proof.ok || !isOpencodexHealthz(health) || health?.pid !== target.pid || health?.port !== target.port || health?.routingReloadCapability !== "v1" || !verifyLocalAttestationProof(runtime.attestationSecret, nonce, target.pid, target.port, proof.headers.get(LOCAL_ATTESTATION_PROOF_HEADER))) throw new Error("proxy attestation failed");
  const expiry = (deps.now ?? Date.now)() + LOCAL_ROUTING_RELOAD_CAPABILITY_TTL_MS;
  const hash = "0".repeat(64);
  const capability = createLocalRoutingReloadCapability(runtime.attestationSecret, nonce, "GET", "/api/routing/reload/state", target.pid, target.port, expiry, hash)!;
  let token = configuredAdminToken();
  if (!token) {
    const home = process.env.OPENCODEX_HOME ?? join(process.env.HOME ?? "/root", ".config", "opencodex");
    try { token = readFileSync(join(home, "admin-api-token"), "utf8").trim(); } catch { /* no file credential */ }
  }
  if (!token) throw new Error("management credential unavailable");
  const response = await fetchImpl(`${base}/api/routing/reload/state`, { headers: {
    authorization: `Bearer ${token}`,
    [LOCAL_ROUTING_RELOAD_EXPECTED_PID_HEADER]: String(target.pid), [LOCAL_ROUTING_RELOAD_NONCE_HEADER]: nonce,
    [LOCAL_ROUTING_RELOAD_EXPIRES_AT_HEADER]: String(expiry), [LOCAL_ROUTING_RELOAD_CONFIG_HASH_HEADER]: hash,
    [LOCAL_ROUTING_RELOAD_CAPABILITY_HEADER]: capability,
  }, signal: AbortSignal.timeout(deps.timeoutMs ?? 5000) });
  const body = await response.json().catch(() => null) as RoutingStateResult | null;
  if (!response.ok || !body || body.pid !== target.pid) throw new Error("runtime routing state unavailable");
  const recheck = (deps.readRuntime ?? readRuntimePort)(target.pid);
  if (!recheck || recheck.pid !== runtime.pid || recheck.port !== runtime.port || recheck.attestationSecret !== runtime.attestationSecret) throw new Error("proxy runtime identity changed");
  return body;
}

export async function requestLocalRoutingReload(readConfigBytes: () => Uint8Array): Promise<RoutingReloadResult> {
  const target = await findLiveProxy();
  if (!target) throw new Error("no attested OpenCodeX process is running");
  return requestBoundLocalRoutingReload(target, { readConfigBytes });
}

export async function requestLocalRoutingState(): Promise<RoutingStateResult> {
  const target = await findLiveProxy();
  if (!target) throw new Error("no attested OpenCodeX process is running");
  return requestBoundLocalRoutingState(target, {});
}

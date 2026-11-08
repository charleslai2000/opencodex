#!/usr/bin/env bun
/**
 * V1.1 preset switcher. The preset matrix lives in src/routing/presets.ts; this
 * command only persists complete routing profiles and never mutates legacy combos.
 */
import { createHash } from "node:crypto";
import { chownSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { applyRoutingPreset, logicalModelCatalogRows, type RoutingPresetName } from "../src/routing/presets";
import { buildRoutingRuntimeSnapshot } from "../src/routing/runtime-snapshot";
import type { OcxConfig } from "../src/types";
import { findLiveProxy } from "../src/server/proxy-liveness";
import { requestBoundLocalRoutingReload, requestBoundLocalRoutingState } from "../src/server/local-routing-reload-client";

const roles = ["lead", "bot", "worker", "expert"] as const;
const efforts = ["low", "medium", "high"] as const;
type Role = typeof roles[number];
const home = process.env.OPENCODEX_HOME ?? join(process.env.HOME ?? "/root", ".config", "opencodex");
const configPath = process.env.OCX_SWITCH_CONFIG ?? join(home, "config.json");
const snapshotDir = process.env.OCX_SWITCH_SNAPSHOT_DIR ?? join(home, "switch-snapshots");
const baseUrl = (process.env.OCX_SWITCH_BASE_URL ?? "http://127.0.0.1:3456").replace(/\/$/, "");
const dryRun = process.env.OCX_SWITCH_DRY_RUN === "1";
const PROXY_DISCOVERY = { timeoutMs: 5_000, attempts: 3 } as const;
const MANAGEMENT_TIMEOUT_MS = 20_000;
const repositoryRoot = dirname(import.meta.dir).replaceAll("\\", "/").replace(/\/$/, "");

const PATH_TOKEN = /((?:[A-Za-z]:[\\/]|\/)(?:[^\\/\s"'`<>()[\],;:]+[\\/])*[^\\/\s"'`<>()[\],;:]+)(:\d+(?::\d+)?)?/g;
const SECRET_ASSIGNMENT = /((?:authorization|proxy-authorization|(?:x-)?api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|id[-_ ]?token|password|passwd|secret|credential|cookie|set-cookie)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:bearer|basic)\s+[^\s,;]+|[^\s,;]+)/gi;
const BEARER_CREDENTIAL = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const TOKEN_LIKE_CREDENTIAL = /\b(?:sk|rk|pk|ghp|glpat|sess)-[A-Za-z0-9_-]{12,}\b/gi;
const REQUEST_DATA = /\b((?:(?:request|response)\s+)?(?:body|payload|metadata|headers))\s*[:=]\s*.*$/i;
const URL_QUERY = /([?&][^\s"'<>]*?=)[^\s"'<>]+/g;

function redactPath(_match: string, path: string, suffix = ""): string {
  const normalized = path.replaceAll("\\", "/");
  if (normalized === repositoryRoot || normalized.startsWith(`${repositoryRoot}/`)) {
    return `${normalized.slice(repositoryRoot.length + 1)}${suffix}`;
  }
  return `<private-path>${suffix}`;
}

function redactDiagnosticText(value: string): string {
  let safe = value.replace(REQUEST_DATA, "$1=<redacted>");
  safe = safe.replace(URL_QUERY, "$1<redacted>");
  safe = safe.replace(SECRET_ASSIGNMENT, "$1<redacted>");
  safe = safe.replace(BEARER_CREDENTIAL, match => match.split(/\s+/, 1)[0]! + " <redacted>");
  safe = safe.replace(TOKEN_LIKE_CREDENTIAL, "<redacted>");
  return safe.replace(PATH_TOKEN, redactPath);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string {
  if (!(error instanceof Error)) return redactDiagnosticText(String(error));
  return `${redactDiagnosticText(error.name || "Error")}: ${redactDiagnosticText(error.message)}\n${(error.stack?.split("\n").slice(1) ?? []).map(redactDiagnosticText).join("\n")}`;
}

export class SwitchApplyError extends Error {
  constructor(
    readonly operationError: unknown,
    readonly rollbackError?: unknown,
  ) {
    super(
      rollbackError === undefined
        ? `apply failed; snapshot restored: ${errorMessage(operationError)}`
        : `apply failed: ${errorMessage(operationError)}; snapshot restored, but runtime rollback could not be verified: ${errorMessage(rollbackError)}`,
      { cause: operationError },
    );
    this.name = "SwitchApplyError";
  }
}

/** Format CLI failures without Bun's uncaught-exception wrapper or lost causes. */
export function formatSwitchError(error: unknown): string {
  const debug = process.env.OCX_SWITCH_DEBUG === "1";
  if (error instanceof SwitchApplyError) {
    const message = `switch-codex failed: ${error.message}`;
    if (error.rollbackError === undefined) return message;
    return `${message}${debug ? `\n${errorStack(error.operationError)}\n${errorStack(error.rollbackError)}` : ""}`;
  }
  const reason = errorMessage(error);
  return `switch-codex failed: ${reason}${debug ? `\n${errorStack(error)}` : ""}`;
}

function sha256(bytes: Uint8Array | string): string { return createHash("sha256").update(bytes).digest("hex"); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function readConfig(): { config: OcxConfig; bytes: Buffer } {
  const bytes = readFileSync(configPath);
  return { config: JSON.parse(bytes.toString()) as OcxConfig, bytes };
}
function writeAtomic(bytes: Uint8Array): void {
  mkdirSync(dirname(configPath), { recursive: true });
  const existing = existsSync(configPath) ? statSync(configPath) : undefined;
  const mode = existing ? existing.mode & 0o777 : 0o600;
  const temp = `${configPath}.switch-${process.pid}-${Date.now()}.tmp`;
  writeFileSync(temp, bytes, { mode });
  chmodSync(temp, mode);
  if (existing && process.platform !== "win32") chownSync(temp, existing.uid, existing.gid);
  renameSync(temp, configPath);
}
function profileState(config: OcxConfig): Record<string, unknown> {
  const profiles = config.routingProfiles ?? {};
  return Object.fromEntries(roles.map(role => [role, profiles[role] ?? null]));
}
function validatePreset(config: OcxConfig, name: RoutingPresetName): void {
  const profiles = config.routingProfiles ?? {};
  for (const role of roles) {
    const profile = profiles[role] as any;
    if (!profile || typeof profile !== "object" || !profile.routes) throw new Error(`preset ${name}: missing routes profile ${role}`);
    if (profile.advertisedContextWindow !== 400_000 || profile.advertisedMaxOutputTokens !== 128_000) throw new Error(`preset ${name}: invalid policy limits for ${role}`);
    for (const effort of efforts) {
      const candidates = profile.routes[effort]?.[0]?.candidates;
      if (!Array.isArray(candidates) || candidates.length === 0) throw new Error(`preset ${name}: missing ${role}/${effort}`);
      for (const candidate of candidates) {
        if (candidate.provider === "deepseek-worker" || candidate.provider === "deepseek-control" || candidate.provider === "deepseek-expert") throw new Error(`preset ${name}: legacy provider in ${role}/${effort}`);
      }
    }
  }
}
export function canonicalPresetConfig(config: OcxConfig, name: RoutingPresetName): OcxConfig {
  const next = applyRoutingPreset(structuredClone(config), name) as OcxConfig;
  if (next.providerContextCaps?.openai !== undefined) { next.providerContextCaps = { ...next.providerContextCaps }; delete next.providerContextCaps.openai; if (Object.keys(next.providerContextCaps).length === 0) delete next.providerContextCaps; }
  const compiled = buildRoutingRuntimeSnapshot(next);
  next.routingProfiles = structuredClone(compiled.routingProfiles) as Record<string, OcxRoutingProfileConfig>;
  const projection = compiled.openrouterRoutingMetadata;
  if (next.providers.openrouter && projection) {
    const prior = next.providers.openrouter;
    next.providers.openrouter = {
      ...prior,
      models: [...new Set([...(prior.models ?? []), ...(projection.models ?? [])])],
      ...(projection.modelReasoningEfforts ? { modelReasoningEfforts: { ...(prior.modelReasoningEfforts ?? {}), ...projection.modelReasoningEfforts } } : {}),
      ...(projection.modelReasoningEffortMap ? { modelReasoningEffortMap: { ...(prior.modelReasoningEffortMap ?? {}), ...projection.modelReasoningEffortMap } } : {}),
    };
  }
  validatePreset(next, name);
  return next;
}
function token(): string | undefined {
  const explicit = process.env.OCX_SWITCH_ADMIN_TOKEN; if (explicit) return explicit;
  const path = process.env.OCX_SWITCH_ADMIN_TOKEN_FILE ?? join(home, "admin-api-token");
  return existsSync(path) ? readFileSync(path, "utf8").trim() : undefined;
}
async function get(path: string): Promise<{ response: Response; body: unknown }> {
  const headers: Record<string, string> = {};
  if (path === "/v1/models") {
    const apiKey = readConfig().config.apiKeys?.[0]?.key;
    if (apiKey) { headers.authorization = `Bearer ${apiKey}`; headers["x-opencodex-api-key"] = apiKey; }
  } else {
    const t = token(); if (t) headers.authorization = `Bearer ${t}`;
  }
  const response = await fetch(`${baseUrl}${path}`, { headers, signal: AbortSignal.timeout(MANAGEMENT_TIMEOUT_MS) });
  const text = await response.text(); let body: unknown; try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { response, body };
}
async function verify(expectedConfigHash?: string, expectedSnapshot?: ReturnType<typeof buildRoutingRuntimeSnapshot>, runtimeState?: { routingFingerprint: string; routingPreset: string | null; routingProfiles: unknown; catalog: unknown; pid: number; expectedPid: number }): Promise<{ configHash: string; catalogHash: string; profileHash: string; routingFingerprint: string }> {
  const health = await get("/healthz"); if (!health.response.ok) throw new Error(`healthz ${health.response.status}`);
  const ready = await get("/readyz"); if (!ready.response.ok) throw new Error(`readyz ${ready.response.status}`);
  const profiles = await get("/api/routing-profiles"); if (!profiles.response.ok) throw new Error(`routing profiles ${profiles.response.status}`);
  const listed = (profiles.body as any)?.profiles; if (!Array.isArray(listed)) throw new Error("routing profiles response malformed");
  for (const role of roles) if (!listed.some((p: any) => p.id === role)) throw new Error(`catalog missing profile ${role}`);
  // Preset switching is verified against the authenticated runtime routing snapshot below.
  // /v1/models also resolves Codex OAuth entitlements and may fail for unrelated account-token
  // refresh reasons; coupling preset application to that endpoint can reject a valid route switch.
  const configHash = sha256(readFileSync(configPath)); if (expectedConfigHash && configHash !== expectedConfigHash) throw new Error("config hash mismatch");
  if (expectedSnapshot && runtimeState) {
    if (runtimeState.routingFingerprint !== expectedSnapshot.routingFingerprint
      || runtimeState.routingPreset !== expectedSnapshot.routingPreset
      || stable(runtimeState.routingProfiles) !== stable(expectedSnapshot.routingProfiles)
      || stable(runtimeState.catalog) !== stable(expectedSnapshot.logicalCatalog)) throw new Error("runtime routing snapshot mismatch");
    if (runtimeState.pid !== runtimeState.expectedPid) throw new Error("runtime PID changed");
  }
  return { configHash, catalogHash: sha256(stable(expectedSnapshot?.logicalCatalog ?? [])), profileHash: sha256(stable(listed.filter((p: any) => roles.includes(p.id)))), routingFingerprint: runtimeState?.routingFingerprint ?? "" };
}
function snapshot(bytes: Buffer, oldPreset: unknown): string { mkdirSync(snapshotDir, { recursive: true, mode: 0o700 }); const path = join(snapshotDir, `config-${Date.now()}-${String(oldPreset ?? "unknown")}.json`); writeFileSync(path, bytes, { mode: 0o600 }); chmodSync(path, 0o600); return path; }
function describePreset(config: OcxConfig, name: RoutingPresetName): string[] {
  const profiles = config.routingProfiles ?? {};
  const lines: string[] = [];
  for (const role of roles) {
    const routes = profiles[role]?.routes;
    const targets = new Set<string>();
    for (const effort of efforts) {
      for (const step of routes?.[effort] ?? []) {
        for (const candidate of step.candidates) targets.add(`${candidate.provider}/${candidate.model}`);
      }
    }
    lines.push(`  ${role.padEnd(7)} ${[...targets].join(" → ") || "(no route)"}`);
  }
  return lines;
}
function printApplySuccess(name: RoutingPresetName, config: OcxConfig, snapshotPath: string): void {
  console.log(`OpenCodeX preset switched to ${name}.`);
  console.log("Logical routes:");
  for (const line of describePreset(config, name)) console.log(line);
  console.log(`Verified: health, readiness, and runtime routing snapshot.`);
  console.log(`Rollback snapshot saved: ${snapshotPath.split(/[\\/]/).at(-1)}`);
}
function printRollbackSuccess(name: string, config: OcxConfig): void {
  console.log(`OpenCodeX preset restored from snapshot ${name}.`);
  console.log("Logical routes:");
  for (const line of describePreset(config, (config.routingPreset ?? "openai") as RoutingPresetName)) console.log(line);
  console.log("Verified: health, readiness, and runtime routing snapshot.");
}
async function apply(name: RoutingPresetName): Promise<void> {
  const disk = readConfig();
  const priorPreset = disk.config.routingPreset;
  const currentConfig = priorPreset === "openai" || priorPreset === "openai-api" || priorPreset === "deepseek"
    ? canonicalPresetConfig(disk.config, priorPreset)
    : disk.config;
  const currentBytes = Buffer.from(`${JSON.stringify(currentConfig, null, 2)}\n`);
  const current = { config: currentConfig, bytes: currentBytes };
  const next = canonicalPresetConfig(current.config, name);
  const nextBytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`);
  if (dryRun) {
    console.log(`Dry run: OpenCodeX preset would switch to ${name}.`);
    console.log("Logical routes:");
    for (const line of describePreset(next, name)) console.log(line);
    return;
  }
  const snap = snapshot(disk.bytes, disk.config.routingPreset);
  const target = await findLiveProxy(PROXY_DISCOVERY);
  if (!target) throw new Error("could not attest the running OpenCodeX process after three bounded health probes; configuration was not changed");
  try {
    writeAtomic(nextBytes);
    const diskAfterWrite = readFileSync(configPath);
    const diskJson = JSON.parse(diskAfterWrite.toString()) as OcxConfig;
    const diskSnapshot = buildRoutingRuntimeSnapshot(diskJson);
    await requestBoundLocalRoutingReload(target, { readConfigBytes: () => readFileSync(configPath), timeoutMs: MANAGEMENT_TIMEOUT_MS });
    const runtime = await requestBoundLocalRoutingState(target, { timeoutMs: MANAGEMENT_TIMEOUT_MS });
    const expected = buildRoutingRuntimeSnapshot(next);
    if (sha256(diskAfterWrite) !== sha256(nextBytes)) throw new Error("disk bytes differ from normalized target bytes");
    if (stable(diskJson) !== stable(next)) throw new Error("disk JSON differs from normalized target config");
    if (diskSnapshot.routingFingerprint !== expected.routingFingerprint) throw new Error("disk snapshot differs from normalized target snapshot");
    try { await verify(sha256(diskAfterWrite), diskSnapshot, { ...runtime, expectedPid: target.pid! }); }
    catch (verifyError) {
      const expectedProfiles = diskSnapshot.routingProfiles as Record<string, unknown>;
      const actualProfiles = runtime.routingProfiles as Record<string, unknown>;
      const mismatch = roles.find(role => stable(expectedProfiles[role]) !== stable(actualProfiles?.[role]));
      if (mismatch) throw new Error(`disk/runtime first mismatch at ${mismatch}: disk=${stable(expectedProfiles[mismatch])} runtime=${stable(actualProfiles?.[mismatch])}`);
      throw new Error(`disk/runtime snapshot mismatch: preset disk=${diskSnapshot.routingPreset} runtime=${runtime.routingPreset}; fingerprint disk=${diskSnapshot.routingFingerprint} runtime=${runtime.routingFingerprint}; ${errorMessage(verifyError)}`);
    }
    printApplySuccess(name, next, snap);
  }
  catch (error) {
    // Restore the complete prior config, canonicalized for its prior preset so the running
    // runtime can validate and load that schema while preserving every unrelated field.
    writeAtomic(current.bytes);
    try {
      const target = await findLiveProxy(PROXY_DISCOVERY);
      if (!target) throw new Error("could not attest the running OpenCodeX process after three probes while restoring the previous runtime route");
      await requestBoundLocalRoutingReload(target, { readConfigBytes: () => readFileSync(configPath), timeoutMs: MANAGEMENT_TIMEOUT_MS });
      const runtime = await requestBoundLocalRoutingState(target, { timeoutMs: MANAGEMENT_TIMEOUT_MS });
      const priorPreset = current.config.routingPreset;
      const expected = priorPreset === "openai" || priorPreset === "openai-api" || priorPreset === "deepseek"
        ? buildRoutingRuntimeSnapshot(canonicalPresetConfig(current.config, priorPreset))
        : buildRoutingRuntimeSnapshot(current.config);
      await verify(sha256(current.bytes), expected, { ...runtime, expectedPid: target.pid! });
      if (runtime.routingPreset !== priorPreset) throw new Error("restored runtime preset mismatch");
    }
    catch (rollbackError) { throw new SwitchApplyError(error, rollbackError); }
    throw new SwitchApplyError(error);
  }
}
async function rollback(): Promise<void> {
  const entries = (await import("node:fs/promises")).readdir(snapshotDir).then(xs => xs.filter(x => x.startsWith("config-") && x.endsWith(".json")).sort()).catch(() => [] as string[]);
  const names = await entries; const name = names.at(-1); if (!name) throw new Error("no preset snapshot available");
  const target = await findLiveProxy(PROXY_DISCOVERY); if (!target) throw new Error("could not attest the running OpenCodeX process after three probes; rollback was not applied");
  const bytes = readFileSync(join(snapshotDir, name));
  const restored = JSON.parse(bytes.toString()) as OcxConfig;
  const priorPreset = restored.routingPreset;
  const effective = priorPreset === "openai" || priorPreset === "openai-api" || priorPreset === "deepseek"
    ? canonicalPresetConfig(restored, priorPreset)
    : restored;
  const effectiveBytes = priorPreset === "openai" || priorPreset === "openai-api" || priorPreset === "deepseek"
    ? Buffer.from(`${JSON.stringify(effective, null, 2)}\n`)
    : bytes;
  const expected = buildRoutingRuntimeSnapshot(effective);
  writeAtomic(effectiveBytes);
  await requestBoundLocalRoutingReload(target, { readConfigBytes: () => readFileSync(configPath), timeoutMs: MANAGEMENT_TIMEOUT_MS });
  const runtime = await requestBoundLocalRoutingState(target, { timeoutMs: MANAGEMENT_TIMEOUT_MS });
  await verify(sha256(effectiveBytes), expected, { ...runtime, expectedPid: target.pid! });
  if (runtime.routingPreset !== priorPreset) throw new Error("restored runtime preset mismatch");
  printRollbackSuccess(name, restored);
}
async function status(): Promise<void> {
  const current = readConfig();
  const runtime = process.env.OCX_SWITCH_RUNTIME ?? process.env.OPENCODEX_ARTIFACT ?? "unknown";
  const health = await get("/healthz").catch(error => ({ response: { ok: false, status: 0 }, body: String(error) }));
  const ready = await get("/readyz").catch(error => ({ response: { ok: false, status: 0 }, body: String(error) }));
  let checks: any = {};
  try { checks = await verify(); } catch (error) { checks.error = errorMessage(error); }
  const activePreset = current.config.routingPreset;
  console.log(`OpenCodeX status: ${health.response.ok && ready.response.ok ? "healthy and ready" : "not healthy/ready"}`);
  console.log(`Active preset: ${activePreset ?? "custom / unset"}`);
  console.log(`Runtime: ${runtime}`);
  if (checks.error) console.log(`Verification issue: ${checks.error}`);
  else console.log("Verified: health, readiness, and persisted logical routing configuration.");
  console.log("Logical routes:");
  for (const line of describePreset(current.config, (activePreset ?? "openai") as RoutingPresetName)) console.log(line);
}
export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const command = args[0];
  if (command === "openai" || command === "openai-api" || command === "deepseek") await apply(command);
  else if (command === "status") await status();
  else if (command === "rollback") await rollback();
  else { console.error("usage: switch-codex openai|openai-api|deepseek|status|rollback"); return 2; }
  return 0;
}

if (import.meta.main) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(formatSwitchError(error)); process.exitCode = 1; }
}

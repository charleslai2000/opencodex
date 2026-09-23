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
        : `apply failed; rollback verification failed: ${errorMessage(rollbackError)}`,
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
    return `${message}\nrollback failed: ${errorMessage(error.rollbackError)}${debug ? `\n${errorStack(error.operationError)}\n${errorStack(error.rollbackError)}` : ""}`;
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
  const response = await fetch(`${baseUrl}${path}`, { headers, signal: AbortSignal.timeout(5_000) });
  const text = await response.text(); let body: unknown; try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { response, body };
}
async function verify(expectedConfigHash?: string, expectedSnapshot?: ReturnType<typeof buildRoutingRuntimeSnapshot>, runtimeState?: { routingFingerprint: string; routingPreset: string | null; routingProfiles: unknown; catalog: unknown; pid: number; expectedPid: number }): Promise<{ configHash: string; catalogHash: string; profileHash: string; routingFingerprint: string }> {
  const health = await get("/healthz"); if (!health.response.ok) throw new Error(`healthz ${health.response.status}`);
  const ready = await get("/readyz"); if (!ready.response.ok) throw new Error(`readyz ${ready.response.status}`);
  const profiles = await get("/api/routing-profiles"); if (!profiles.response.ok) throw new Error(`routing profiles ${profiles.response.status}`);
  const listed = (profiles.body as any)?.profiles; if (!Array.isArray(listed)) throw new Error("routing profiles response malformed");
  for (const role of roles) if (!listed.some((p: any) => p.id === role)) throw new Error(`catalog missing profile ${role}`);
  const models = await get("/v1/models"); if (!models.response.ok) throw new Error(`models ${models.response.status}`);
  const rows = (models.body as any)?.data; if (!Array.isArray(rows)) throw new Error("models response malformed");
  for (const role of roles) {
    const row = rows.find((item: any) => item.id === role);
    if (!row || row.context_window !== 400_000 || row.max_output_tokens !== 128_000 || JSON.stringify(row.opencodex_logical_efforts) !== JSON.stringify(["low", "medium", "high"])) throw new Error(`catalog policy mismatch for ${role}`);
  }
  const configHash = sha256(readFileSync(configPath)); if (expectedConfigHash && configHash !== expectedConfigHash) throw new Error("config hash mismatch");
  if (expectedSnapshot && runtimeState) {
    if (runtimeState.routingFingerprint !== expectedSnapshot.routingFingerprint
      || runtimeState.routingPreset !== expectedSnapshot.routingPreset
      || stable(runtimeState.routingProfiles) !== stable(expectedSnapshot.routingProfiles)
      || stable(runtimeState.catalog) !== stable(expectedSnapshot.logicalCatalog)) throw new Error("runtime routing snapshot mismatch");
    if (runtimeState.pid !== runtimeState.expectedPid) throw new Error("runtime PID changed");
  }
  return { configHash, catalogHash: sha256(JSON.stringify(models.body)), profileHash: sha256(stable(listed.filter((p: any) => roles.includes(p.id)))), routingFingerprint: runtimeState?.routingFingerprint ?? "" };
}
function snapshot(bytes: Buffer, oldPreset: unknown): string { mkdirSync(snapshotDir, { recursive: true, mode: 0o700 }); const path = join(snapshotDir, `config-${Date.now()}-${String(oldPreset ?? "unknown")}.json`); writeFileSync(path, bytes, { mode: 0o600 }); chmodSync(path, 0o600); return path; }
async function apply(name: RoutingPresetName): Promise<void> {
  const current = readConfig();
  const next = applyRoutingPreset(structuredClone(current.config), name) as OcxConfig;
  if (next.providerContextCaps?.openai !== undefined) { next.providerContextCaps = { ...next.providerContextCaps }; delete next.providerContextCaps.openai; if (Object.keys(next.providerContextCaps).length === 0) delete next.providerContextCaps; }
  validatePreset(next, name);
  const nextBytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`);
  if (dryRun) { console.log(JSON.stringify({ dryRun: true, preset: name, configHash: sha256(nextBytes), profileHash: sha256(stable(profileState(next))) })); return; }
  const snap = snapshot(current.bytes, current.config.routingPreset);
  try { writeAtomic(nextBytes); const target = await findLiveProxy(); if (!target) throw new Error("no attested OpenCodeX process is running"); const reloaded = await requestBoundLocalRoutingReload(target, { readConfigBytes: () => readFileSync(configPath) }); const runtime = await requestBoundLocalRoutingState(target, {}); const expected = buildRoutingRuntimeSnapshot(next); const verified = await verify(sha256(nextBytes), expected, { ...runtime, expectedPid: target.pid! }); console.log(JSON.stringify({ preset: name, snapshot: snap, ...verified })); }
  catch (error) {
    writeAtomic(current.bytes);
    try { const target = await findLiveProxy(); if (!target) throw new Error("no attested OpenCodeX process is running"); await requestBoundLocalRoutingReload(target, { readConfigBytes: () => readFileSync(configPath) }); const runtime = await requestBoundLocalRoutingState(target, {}); const expected = buildRoutingRuntimeSnapshot(current.config); await verify(sha256(current.bytes), expected, { ...runtime, expectedPid: target.pid! }); }
    catch (rollbackError) { throw new SwitchApplyError(error, rollbackError); }
    throw new SwitchApplyError(error);
  }
}
async function rollback(): Promise<void> {
  const entries = (await import("node:fs/promises")).readdir(snapshotDir).then(xs => xs.filter(x => x.startsWith("config-") && x.endsWith(".json")).sort()).catch(() => [] as string[]);
  const names = await entries; const name = names.at(-1); if (!name) throw new Error("no preset snapshot available");
  const bytes = readFileSync(join(snapshotDir, name)); const restored = JSON.parse(bytes.toString()) as OcxConfig; writeAtomic(bytes); const target = await findLiveProxy(); if (!target) throw new Error("no attested OpenCodeX process is running"); await requestBoundLocalRoutingReload(target, { readConfigBytes: () => readFileSync(configPath) }); const runtime = await requestBoundLocalRoutingState(target, {}); const expected = buildRoutingRuntimeSnapshot(restored); const verified = await verify(sha256(bytes), expected, { ...runtime, expectedPid: target.pid! }); console.log(JSON.stringify({ rollback: name, ...verified }));
}
async function status(): Promise<void> {
  const current = readConfig();
  const runtime = process.env.OCX_SWITCH_RUNTIME ?? process.env.OPENCODEX_ARTIFACT ?? "unknown";
  const health = await get("/healthz").catch(error => ({ response: { ok: false, status: 0 }, body: String(error) }));
  const ready = await get("/readyz").catch(error => ({ response: { ok: false, status: 0 }, body: String(error) }));
  let checks: any = {};
  try { checks = await verify(); } catch (error) { checks.error = String(error); }
  console.log(JSON.stringify({
    activePreset: current.config.routingPreset ?? null,
    runtime,
    configHash: sha256(current.bytes),
    profilePresence: Object.fromEntries(roles.map(role => [role, Boolean((current.config.routingProfiles as any)?.[role]?.routes)])),
    health: { ok: health.response.ok, status: health.response.status },
    readiness: { ok: ready.response.ok, status: ready.response.status },
    ...checks,
  }));
}
export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const command = args[0];
  if (command === "openai" || command === "deepseek") await apply(command);
  else if (command === "status") await status();
  else if (command === "rollback") await rollback();
  else { console.error("usage: switch-codex openai|deepseek|status|rollback"); return 2; }
  return 0;
}

if (import.meta.main) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(formatSwitchError(error)); process.exitCode = 1; }
}

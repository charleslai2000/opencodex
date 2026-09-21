#!/usr/bin/env bun
/**
 * V1.1 preset switcher. The preset matrix lives in src/routing/presets.ts; this
 * command only persists complete routing profiles and never mutates legacy combos.
 */
import { createHash } from "node:crypto";
import { chownSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { applyRoutingPreset, type RoutingPresetName } from "../src/routing/presets";
import type { OcxConfig } from "../src/types";

const roles = ["lead", "bot", "worker", "expert"] as const;
const efforts = ["low", "medium", "high"] as const;
type Role = typeof roles[number];
const home = process.env.OPENCODEX_HOME ?? join(process.env.HOME ?? "/root", ".config", "opencodex");
const configPath = process.env.OCX_SWITCH_CONFIG ?? join(home, "config.json");
const snapshotDir = process.env.OCX_SWITCH_SNAPSHOT_DIR ?? join(home, "switch-snapshots");
const baseUrl = (process.env.OCX_SWITCH_BASE_URL ?? "http://127.0.0.1:3456").replace(/\/$/, "");
const service = process.env.OCX_SWITCH_SERVICE ?? "opencodex.service";
const dryRun = process.env.OCX_SWITCH_DRY_RUN === "1";

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
  const headers: Record<string, string> = {}; const t = token(); if (t) headers.authorization = `Bearer ${t}`;
  const response = await fetch(`${baseUrl}${path}`, { headers, signal: AbortSignal.timeout(5_000) });
  const text = await response.text(); let body: unknown; try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { response, body };
}
async function waitForReady(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const health = await get("/healthz");
      const ready = await get("/readyz");
      if (health.response.ok && ready.response.ok) return;
    } catch { /* service is still restarting */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("service did not become ready after restart");
}

async function verify(expectedConfigHash?: string): Promise<{ configHash: string; catalogHash: string; profileHash: string }> {
  const health = await get("/healthz"); if (!health.response.ok) throw new Error(`healthz ${health.response.status}`);
  const ready = await get("/readyz"); if (!ready.response.ok) throw new Error(`readyz ${ready.response.status}`);
  const profiles = await get("/api/routing-profiles"); if (!profiles.response.ok) throw new Error(`routing profiles ${profiles.response.status}`);
  const listed = (profiles.body as any)?.profiles; if (!Array.isArray(listed)) throw new Error("routing profiles response malformed");
  for (const role of roles) if (!listed.some((p: any) => p.id === role && p.advertisedContextWindow === 400_000 && p.advertisedMaxOutputTokens === 128_000)) throw new Error(`catalog missing profile ${role}`);
  const models = await get("/v1/models"); if (!models.response.ok) throw new Error(`models ${models.response.status}`);
  const configHash = sha256(readFileSync(configPath)); if (expectedConfigHash && configHash !== expectedConfigHash) throw new Error("config hash mismatch");
  return { configHash, catalogHash: sha256(JSON.stringify(models.body)), profileHash: sha256(stable(listed.filter((p: any) => roles.includes(p.id)).map((p: any) => ({ id: p.id, advertisedContextWindow: p.advertisedContextWindow, advertisedMaxOutputTokens: p.advertisedMaxOutputTokens, routes: p.routes })))), };
}
function restart(): void { if (dryRun) return; const result = Bun.spawnSync(["systemctl", "restart", service], { stdout: "ignore", stderr: "pipe" }); if (result.exitCode !== 0) throw new Error(`restart failed (${result.exitCode})`); }
function snapshot(bytes: Buffer, oldPreset: unknown): string { mkdirSync(snapshotDir, { recursive: true, mode: 0o700 }); const path = join(snapshotDir, `config-${Date.now()}-${String(oldPreset ?? "unknown")}.json`); writeFileSync(path, bytes, { mode: 0o600 }); chmodSync(path, 0o600); return path; }
async function apply(name: RoutingPresetName): Promise<void> {
  const current = readConfig();
  const next = applyRoutingPreset(structuredClone(current.config), name) as OcxConfig;
  if (next.providerContextCaps?.openai !== undefined) { next.providerContextCaps = { ...next.providerContextCaps }; delete next.providerContextCaps.openai; if (Object.keys(next.providerContextCaps).length === 0) delete next.providerContextCaps; }
  validatePreset(next, name);
  const nextBytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`);
  if (dryRun) { console.log(JSON.stringify({ dryRun: true, preset: name, configHash: sha256(nextBytes), profileHash: sha256(stable(profileState(next))) })); return; }
  const snap = snapshot(current.bytes, current.config.routingPreset);
  try { writeAtomic(nextBytes); restart(); await waitForReady(); const verified = await verify(sha256(nextBytes)); console.log(JSON.stringify({ preset: name, snapshot: snap, ...verified })); }
  catch (error) { writeAtomic(current.bytes); try { restart(); await waitForReady(); await verify(sha256(current.bytes)); } catch (rollbackError) { throw new Error(`apply failed; rollback verification failed: ${String(rollbackError)}`); } throw new Error(`apply failed; snapshot restored: ${String(error)}`); }
}
async function rollback(): Promise<void> {
  const entries = (await import("node:fs/promises")).readdir(snapshotDir).then(xs => xs.filter(x => x.startsWith("config-") && x.endsWith(".json")).sort()).catch(() => [] as string[]);
  const names = await entries; const name = names.at(-1); if (!name) throw new Error("no preset snapshot available");
  const bytes = readFileSync(join(snapshotDir, name)); JSON.parse(bytes.toString()); writeAtomic(bytes); restart(); await waitForReady(); const verified = await verify(sha256(bytes)); console.log(JSON.stringify({ rollback: name, ...verified }));
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
const command = process.argv[2];
if (command === "openai" || command === "deepseek") await apply(command);
else if (command === "status") await status();
else if (command === "rollback") await rollback();
else { console.error("usage: switch-codex openai|deepseek|status|rollback"); process.exit(2); }

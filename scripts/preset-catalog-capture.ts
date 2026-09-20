#!/usr/bin/env bun
/** Capture the server-level logical catalog for openai/deepseek/openai in isolation. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { applyRoutingPreset, logicalModelCapabilityEvidence, type RoutingPresetName } from "../src/routing/presets";
import type { OcxConfig } from "../src/types";

const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const port = Number(process.env.OPENCODEX_PRESET_CATALOG_PORT ?? "18488");
const temp = await mkdtemp(join(tmpdir(), "opencodex-preset-catalog-"));
const home = join(temp, "ocx"); const codex = join(temp, "codex");
await mkdir(home); await mkdir(codex);
const key = `catalog_${crypto.randomUUID().replaceAll("-", "")}`;
const provider = (adapter: "openai-responses" | "openai-chat", baseUrl: string, models: string[]) => ({ adapter, baseUrl, apiKey: "$CATALOG_UPSTREAM_KEY", models, liveModels: false, contextWindow: 1_000_000, maxOutputTokens: 256_000, reasoningEfforts: ["low", "medium", "high"], modelReasoningEfforts: Object.fromEntries(models.map(model => [model, ["low", "medium", "high"]])) });
const base = { port, hostname: "127.0.0.1", defaultProvider: "deepseek", providers: {
  openai: provider("openai-responses", "https://chatgpt.com/backend-api/codex", ["gpt-5.6-luna", "gpt-5.6-terra"]),
  deepseek: provider("openai-chat", "https://api.deepseek.com/v1", ["deepseek-flash"]),
  "deepseek-worker": provider("openai-chat", "https://api.deepseek.com/v1", ["deepseek-flash"]),
  openrouter: provider("openai-chat", "https://openrouter.ai/api/v1", ["@preset/lstack-ling-3-0-flash"]),
}, apiKeys: [{ id: "catalog", name: "catalog", key, createdAt: new Date().toISOString() }], clientIntegrations: { codex: false } } as unknown as OcxConfig;
let server: ChildProcessWithoutNullStreams | undefined;
async function stop() { if (!server || server.exitCode !== null) return; server.kill("SIGTERM"); await new Promise<void>(resolve => server?.once("close", () => resolve())); server = undefined; }
async function start(preset: RoutingPresetName) { await writeFile(join(home, "config.json"), `${JSON.stringify(applyRoutingPreset(base, preset), null, 2)}\n`, { mode: 0o600 }); server = spawn(process.execPath, ["run", "src/cli/index.ts", "start", "--port", String(port)], { cwd: root, env: { ...process.env, OPENCODEX_HOME: home, CODEX_HOME: codex, CATALOG_UPSTREAM_KEY: "catalog" }, stdio: ["ignore", "pipe", "pipe"] }); server.stderr.on("data", chunk => process.stderr.write(chunk)); for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return; } catch {} await Bun.sleep(100); } throw new Error(`catalog server startup timeout: ${preset}`); }
const ids = ["lead", "bot", "worker", "expert"];
try {
  const captures: Array<{ preset: RoutingPresetName; rows: unknown[] }> = [];
  for (const preset of ["openai", "deepseek", "openai"] as const) { await start(preset); const body = await (await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { "x-opencodex-api-key": key } })).json() as { data?: Array<Record<string, unknown>> }; const rows = (body.data ?? []).filter(row => ids.includes(String(row.id))); if (rows.map(row => row.id).join(",") !== ids.join(",")) throw new Error(`${preset} logical IDs mismatch: ${JSON.stringify(rows)}`); captures.push({ preset, rows }); await stop(); }
  const first = JSON.stringify(captures[0]?.rows); const third = JSON.stringify(captures[2]?.rows); if (first !== third) throw new Error("openai catalog is not stable across restart/rewrite");
  const evidence = ["openai", "deepseek"].flatMap(preset => logicalModelCapabilityEvidence(applyRoutingPreset(base, preset as RoutingPresetName), { lead: 1_000_000, bot: 1_000_000, worker: 1_000_000, expert: 1_000_000 }));
  if (!evidence.every(item => item.catalogContextWindow === item.advertisedContextWindow && item.catalogMaxOutputTokens === item.advertisedMaxOutputTokens)) throw new Error("catalog policy metadata differs from advertised profile metadata");
  console.log(JSON.stringify({ captures, canonicalFields: ["id", "reasoning", "context_window", "max_output_tokens", "opencodex_logical_efforts"], compatibilityOnly: ["reasoning_efforts"], physicalVsAdvertised: evidence, acceptance: "PASS" }, null, 2));
} finally { await stop().catch(() => {}); await rm(temp, { recursive: true, force: true }); const health = await fetch("http://127.0.0.1:3456/healthz").catch(() => undefined); if (!health?.ok) throw new Error("formal service health failed"); }

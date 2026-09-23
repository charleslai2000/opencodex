#!/usr/bin/env bun
/** Isolated authenticated runtime qualification for the frozen OpenAI/DeepSeek presets. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { applyRoutingPreset, logicalModelCapabilityEvidence, logicalModelCatalogRows, type RoutingPresetName } from "../src/routing/presets";
import type { OcxConfig } from "../src/types";

const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const port = Number(process.env.OPENCODEX_PRESET_QUALIFICATION_PORT ?? "18288");
const mockPort = Number(process.env.OPENCODEX_PRESET_MOCK_PORT ?? "18289");
const temp = await mkdtemp(join(tmpdir(), "opencodex-preset-qualification-"));
const home = join(temp, "ocx"); const codex = join(temp, "codex");
await mkdir(home); await mkdir(codex);
process.env.OPENCODEX_HOME = home;
const apiKey = `preset_qualification_${crypto.randomUUID().replaceAll("-", "")}`;
const calls: Array<{ provider: string; model: string; wireEffort: string | null; seq: number; session?: string }> = [];
let sequence = 0;
const failed = new Set<string>();

function response(model: string): Response {
  const id = `resp_${crypto.randomUUID().replaceAll("-", "")}`;
  const payload = { id, object: "response", created_at: Math.floor(Date.now() / 1000), model, output: [{ type: "message", id: `msg_${id}`, role: "assistant", content: [{ type: "output_text", text: "ROUTE_OK", annotations: [] }] }], status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  const events = [`response.created`, `response.completed`].map(type => `event: ${type}\ndata: ${JSON.stringify({ type, response: type === "response.created" ? { ...payload, output: [] } : payload })}\n\n`).join("");
  return new Response(`${events}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}
const mock = Bun.serve({ hostname: "127.0.0.1", port: mockPort, async fetch(req) {
  const url = new URL(req.url);
  if (url.pathname === "/control/fail") { const body = await req.json() as { targets?: string[] }; failed.clear(); for (const target of body.targets ?? []) failed.add(target); return Response.json({ ok: true }); }
  if (req.method !== "POST" || !url.pathname.endsWith("/responses")) return Response.json({ error: "not found" }, { status: 404 });
  const body = await req.json() as Record<string, unknown>;
  const parts = url.pathname.split("/").filter(Boolean); const provider = parts[0] ?? "unknown";
  const model = String(body.model ?? "");
  const wireEffort = typeof (body.reasoning as Record<string, unknown> | undefined)?.effort === "string" ? String((body.reasoning as Record<string, unknown>).effort) : null;
  calls.push({ provider, model, wireEffort, seq: ++sequence, session: typeof body.previous_response_id === "string" ? body.previous_response_id : undefined });
  if (failed.has(`${provider}/${model}`)) return Response.json({ error: { type: "server_error", message: "qualification hard failure" } }, { status: 503 });
  return response(model);
} });

const provider = (id: string, models: string[]) => ({ adapter: "openai-responses", baseUrl: `http://127.0.0.1:${mockPort}/${id}/v1`, allowPrivateNetwork: true, authMode: "forward", apiKey: "$MOCK_UPSTREAM_API_KEY", models, liveModels: false, contextWindow: id === "openrouter" ? 1_000_000 : 1_000_000, maxOutputTokens: 256_000, reasoningEfforts: ["low", "medium", "high"], modelReasoningEfforts: Object.fromEntries(models.map(model => [model, ["low", "medium", "high"]])) });
const providers = {
  openai: { ...provider("openai", ["gpt-6-luna", "gpt-6-terra", "gpt-6-sol"]), authMode: "key", apiKey: "$MOCK_UPSTREAM_API_KEY" },
  openrouter: provider("openrouter", ["@preset/lstack-ling-3-0-flash"]),
  deepseek: provider("deepseek", ["deepseek-flash"]),
  "deepseek-worker": provider("deepseek-worker", ["deepseek-flash"]),
};
const baseConfig = { port, hostname: "127.0.0.1", defaultProvider: "openai", providers, apiKeys: [{ id: "qualification", name: "qualification", key: apiKey, createdAt: new Date().toISOString() }], clientIntegrations: { codex: false } } as unknown as OcxConfig;
let server: ChildProcessWithoutNullStreams | undefined;
async function writeConfig(preset: RoutingPresetName) { await writeFile(join(home, "config.json"), `${JSON.stringify(applyRoutingPreset(baseConfig, preset), null, 2)}\n`, { mode: 0o600 }); }
async function start(preset: RoutingPresetName) { await writeConfig(preset); server = spawn(process.execPath, ["run", "src/cli/index.ts", "start", "--port", String(port)], { cwd: root, env: { ...process.env, OPENCODEX_HOME: home, CODEX_HOME: codex, MOCK_UPSTREAM_API_KEY: "mock" }, stdio: ["ignore", "pipe", "pipe"] }); server.stderr.on("data", chunk => process.stderr.write(chunk)); for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return; } catch {} await Bun.sleep(100); } throw new Error(`isolated server startup timeout for ${preset}`); }
async function stop() { if (!server || server.exitCode !== null) return; server.kill("SIGTERM"); await new Promise<void>(resolve => server?.once("close", () => resolve())); server = undefined; }
async function control(targets: string[]) { await fetch(`http://127.0.0.1:${mockPort}/control/fail`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targets }) }); }
async function request(model: string, effort: string) { const before = calls.length; const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "x-opencodex-session-id": "preset-qualification-session" }, body: JSON.stringify({ model: model.startsWith("policy/") ? model : `policy/${model}`, input: "Reply exactly ROUTE_OK", reasoning: { effort }, stream: true }) }); if (!response.ok) throw new Error(`${model}/${effort}: HTTP ${response.status} ${await response.text()}`); await response.text(); const call = calls.slice(before).at(-1); if (!call) throw new Error(`no mock call for ${model}/${effort}`); return call; }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const matrix: Record<RoutingPresetName, Record<string, Record<string, [string, string, string]>>> = {
  openai: { lead: { low: ["openai", "gpt-6-luna", "low"], medium: ["openai", "gpt-6-luna", "medium"], high: ["openai", "gpt-6-luna", "high"] }, worker: { low: ["openai", "gpt-6-luna", "low"], medium: ["openai", "gpt-6-luna", "medium"], high: ["openai", "gpt-6-luna", "high"] }, expert: { low: ["openai", "gpt-6-luna", "high"], medium: ["openai", "gpt-5.6-terra", "medium"], high: ["openai", "gpt-5.6-terra", "high"] }, bot: { low: ["openrouter", "@preset/lstack-ling-3-0-flash", "low"], medium: ["openrouter", "@preset/lstack-ling-3-0-flash", "medium"], high: ["openrouter", "@preset/lstack-ling-3-0-flash", "high"] } },
  deepseek: { lead: { low: ["deepseek", "deepseek-flash", "low"], medium: ["deepseek", "deepseek-flash", "high"], high: ["deepseek", "deepseek-flash", "max"] }, worker: { low: ["deepseek", "deepseek-flash", "low"], medium: ["deepseek", "deepseek-flash", "low"], high: ["deepseek", "deepseek-flash", "high"] }, expert: { low: ["deepseek", "deepseek-flash", "high"], medium: ["deepseek", "deepseek-flash", "high"], high: ["deepseek", "deepseek-flash", "high"] }, bot: { low: ["openrouter", "@preset/lstack-ling-3-0-flash", "low"], medium: ["openrouter", "@preset/lstack-ling-3-0-flash", "medium"], high: ["openrouter", "@preset/lstack-ling-3-0-flash", "high"] } },
};
const results: unknown[] = [];
try {
  for (const preset of ["openai", "deepseek"] as const) {
    await start(preset);
    for (const [logical, efforts] of Object.entries(matrix[preset])) for (const effort of ["low", "medium", "high"]) { const [providerName, model, wireEffort] = efforts[effort]!; const call = await request(logical, effort); assert(call.provider === providerName && call.model === model && call.wireEffort === wireEffort, `${preset}/${logical}/${effort} mismatch: ${JSON.stringify({ expected: [providerName, model, wireEffort], call })}`); results.push({ preset, logical, effort, routeStep: 0, provider: call.provider, model: call.model, upstreamEffort: wireEffort, wireEffort: call.wireEffort, selection: "primary", result: "PASS" }); }
    const rows = (await (await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { authorization: `Bearer ${apiKey}` } })).json() as { data: Array<Record<string, unknown>> }).data.filter(row => ["lead", "bot", "worker", "expert"].includes(String(row.id)));
    assert(rows.map(row => row.id).join(",") === "lead,bot,worker,expert", `${preset} catalog IDs changed: ${JSON.stringify(rows)}`);
    const expectedRows = logicalModelCatalogRows(applyRoutingPreset(baseConfig, preset)); assert(rows.every(row => row.context_window === 400000 && row.max_output_tokens === 128000 && Array.isArray(row.opencodex_logical_efforts)), `${preset} catalog policy mismatch`);
    const evidence = logicalModelCapabilityEvidence(applyRoutingPreset(baseConfig, preset), { lead: 1_000_000, bot: 1_000_000, worker: 1_000_000, expert: 1_000_000 }); assert(evidence.every(item => item.catalogContextWindow <= item.primaryPhysicalContextWindow && item.catalogContextWindow === 400000), `${preset} physical/policy separation failed`); await stop();
  }
  await start("openai"); await control(["openrouter/@preset/lstack-ling-3-0-flash"]); for (const effort of ["low", "medium", "high"]) { const call = await request("bot", effort); const expected = effort === "low" ? "low" : "high"; assert(call.provider === "deepseek" && call.model === "deepseek-flash" && call.wireEffort === expected, `bot fallback ${effort} failed: ${JSON.stringify(call)}`); }
  await control([]); const sticky = await request("bot", "medium"); assert(sticky.provider === "deepseek", `bot fallback affinity did not remain bound: ${JSON.stringify(sticky)}`); const low = await request("bot", "low"); assert(low.provider === "deepseek", `low effort binding missing: ${JSON.stringify(low)}`);
  console.log(JSON.stringify({ acceptance: "PASS", matrix: results, botFallback: "PASS", botStickyAffinity: "PASS", catalogIds: ["lead", "bot", "worker", "expert"], physicalVsAdvertised: "PASS", note: "mock-only runtime qualification; real smoke remains separate" }, null, 2));
} finally { await stop().catch(() => {}); mock.stop(true); await rm(temp, { recursive: true, force: true }); const health = await fetch("http://127.0.0.1:3456/healthz").catch(() => undefined); if (!health?.ok) throw new Error("formal service health failed"); }

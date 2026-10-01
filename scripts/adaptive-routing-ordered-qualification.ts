#!/usr/bin/env bun
/** Real Pi + isolated OpenCodex qualification for ordered routes V1.1. */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const ocxPort = Number(process.env.OPENCODEX_ORDERED_PORT ?? "18188");
const clientPort = Number(process.env.OPENCODEX_ORDERED_CLIENT_PORT ?? "18187");
const mockPort = Number(process.env.OPENCODEX_ORDERED_MOCK_PORT ?? "18189");
const formalPort = 3456;
const hostIp = process.env.OPENCODEX_ORDERED_HOST ?? "192.168.1.203";
const key = `ocx_ordered_${crypto.randomUUID().replaceAll("-", "")}`;
const temp = await mkdtemp(join(tmpdir(), "opencodex-ordered-qualification-"));
const ocxHome = join(temp, "ocx"); const codexHome = join(temp, "codex");
const piHome = join(temp, "pi"); const sessions = join(temp, "sessions");
await Promise.all([mkdir(ocxHome), mkdir(codexHome), mkdir(piHome), mkdir(sessions)]);

type Call = { provider: string; model: string; effort: string | null; seq: number };
const calls: Call[] = []; let seq = 0; const failed = new Set<string>(); let failAll = false;
const response = (model: string) => {
  const id = `resp_${crypto.randomUUID().replaceAll("-", "")}`;
  const msg = { type: "message", id: `msg_${id}`, role: "assistant", content: [{ type: "output_text", text: "ROUTE_OK", annotations: [] }] };
  const payload = { id, object: "response", created_at: Math.floor(Date.now() / 1000), model, output: [msg], status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  const events = [
    ["response.created", { type: "response.created", response: { ...payload, output: [] } }],
    ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { type: "message", id: msg.id, role: "assistant", content: [] } }],
    ["response.content_part.added", { type: "response.content_part.added", output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } }],
    ["response.output_text.delta", { type: "response.output_text.delta", item_id: msg.id, output_index: 0, content_index: 0, delta: "ROUTE_OK" }],
    ["response.output_text.done", { type: "response.output_text.done", item_id: msg.id, output_index: 0, content_index: 0, text: "ROUTE_OK" }],
    ["response.content_part.done", { type: "response.content_part.done", output_index: 0, content_index: 0, part: msg.content[0] }],
    ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item: msg }],
    ["response.completed", { type: "response.completed", response: payload }],
  ].map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(`${events}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
};
const clientProxy = Bun.serve({ hostname: "0.0.0.0", port: clientPort, async fetch(req) { const headers = new Headers(req.headers); headers.set("x-opencodex-api-key", key); return fetch(`http://${hostIp}:${ocxPort}${new URL(req.url).pathname}`, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer() }); } });
const mock = Bun.serve({ hostname: "127.0.0.1", port: mockPort, async fetch(req) {
  const url = new URL(req.url);
  if (url.pathname === "/healthz") return Response.json({ status: "ok" });
  if (url.pathname === "/control/fail") { const x = await req.json() as { targets?: string[]; all?: boolean }; failed.clear(); for (const t of x.targets ?? []) failed.add(t); failAll = x.all === true; return Response.json({ ok: true }); }
  if (req.method !== "POST" || !url.pathname.endsWith("/responses")) return Response.json({ error: "not found" }, { status: 404 });
  const body = await req.json() as Record<string, any>; const provider = url.pathname.split("/").filter(Boolean)[0] ?? "unknown";
  const effort = typeof body.reasoning?.effort === "string" ? body.reasoning.effort : null;
  const model = String(body.model ?? ""); calls.push({ provider, model, effort, seq: ++seq });
  if (failAll || failed.has(`${provider}/${model}`)) return Response.json({ error: { type: "server_error", message: "qualification hard failure" } }, { status: 503 });
  return response(model);
} });
const provider = (id: string, models: string[]) => ({ adapter: "openai-responses", baseUrl: `http://127.0.0.1:${mockPort}/${id}/v1`, allowPrivateNetwork: true, apiKey: "$MOCK_KEY", models, liveModels: false, contextWindow: 400000, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"], modelReasoningEfforts: Object.fromEntries(models.map(m => [m, ["low", "medium", "high", "xhigh", "max"]])) });
const q9 = ["q9-0", "q9-1"], q27 = ["q27-0", "q27-1", "q27-2", "q27-3"], luna = ["luna-0", "luna-1"];

const backendProviders = Object.fromEntries([...q9, ...q27, ...luna].map(id => [id, provider(id, [id.startsWith("q9") ? "qwen3.5-9b" : id.startsWith("q27") ? "qwen3.8-27b" : "gpt-5.6-luna"])]));
const config = { port: ocxPort, hostname: "0.0.0.0", defaultProvider: q9[0], providers: { ...backendProviders, worker: provider("worker", ["worker-model"]), expert: provider("expert", ["expert-model"]) }, apiKeys: [{ id: "qualification", name: "qualification", key, createdAt: new Date().toISOString() }], clientIntegrations: { codex: false }, routingProfiles: {
  lead: { routes: { low: [{ candidates: q9.map(provider => ({ provider, model: "qwen3.5-9b", upstreamEffort: "low" })) }], medium: [{ candidates: q27.map(provider => ({ provider, model: "qwen3.8-27b", upstreamEffort: "high" })) }, { candidates: luna.map(provider => ({ provider, model: "gpt-5.6-luna", upstreamEffort: "medium" })) }], high: [{ candidates: luna.map(provider => ({ provider, model: "gpt-5.6-luna", upstreamEffort: "high" })) }] } },
  worker: { routes: { medium: [{ candidates: [{ provider: "worker", model: "worker-model", upstreamEffort: "medium" }] }] } },
  expert: { routes: { high: [{ candidates: [{ provider: "expert", model: "expert-model", upstreamEffort: "high" }] }] } },
} };
await writeFile(join(ocxHome, "config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
await writeFile(join(piHome, "models.json"), `${JSON.stringify({ providers: { opencodex: { baseUrl: `http://${hostIp}:${clientPort}/v1`, api: "openai-responses", apiKey: key, models: ["lead", "worker", "expert"].map(id => ({ id: `policy/${id}`, name: id, reasoning: true, contextWindow: 400000, thinkingLevelMap: { low: "low", medium: "medium", high: "high" }, compat: { sessionAffinityFormat: "openai" } })) } } }, null, 2)}\n`, { mode: 0o600 });
function assert(ok: unknown, msg: string): asserts ok { if (!ok) throw new Error(msg); }
function startPi(args: string[]): ChildProcessWithoutNullStreams { const child = spawn("pi", ["--mode", "rpc", "--no-tools", "--no-extensions", "--session-dir", sessions, "--provider", "opencodex", "--model", "policy/lead", ...args], { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: piHome, CODEX_HOME: codexHome, OPENCODEX_API_KEY: key }, stdio: ["pipe", "pipe", "pipe"] }); child.stderr.on("data", chunk => process.stderr.write(chunk)); return child; }
function rpc(child: ChildProcessWithoutNullStreams, command: Record<string, unknown>): Promise<any> { return new Promise((resolve, reject) => { const id = crypto.randomUUID(); let buf = ""; const on = (chunk: Buffer) => { buf += chunk.toString(); for (;;) { const i = buf.indexOf("\n"); if (i < 0) return; const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const x = JSON.parse(line); if (x.type === "response" && x.id === id) { child.stdout.off("data", on); resolve(x); return; } } catch {} } }; child.stdout.on("data", on); child.stdin.write(`${JSON.stringify({ ...command, id })}\n`); setTimeout(() => { child.stdout.off("data", on); reject(new Error(`RPC timeout ${String(command.type)}`)); }, 90000); }); }
async function prompt(child: ChildProcessWithoutNullStreams, text: string) { await rpc(child, { type: "prompt", message: text }); await new Promise<void>((resolve, reject) => { const on = (chunk: Buffer) => { if (chunk.toString().split("\n").some(line => { try { return JSON.parse(line).type === "agent_end"; } catch { return false; } })) { child.stdout.off("data", on); resolve(); } }; child.stdout.on("data", on); setTimeout(() => { child.stdout.off("data", on); reject(new Error("agent end timeout")); }, 90000); }); }
async function ask(child: ChildProcessWithoutNullStreams, profile: string, effort: string) { const a = await rpc(child, { type: "set_model", provider: "opencodex", modelId: `policy/${profile}` }); assert(a.success, `model ${profile}: ${JSON.stringify(a)}`); const b = await rpc(child, { type: "set_thinking_level", level: effort }); assert(b.success, `effort ${effort}: ${JSON.stringify(b)}`); const before = calls.length; await prompt(child, `Reply exactly ROUTE_OK ${profile}/${effort}`); assert(calls.length > before, `Pi request produced no mock call for ${profile}/${effort}`); }
async function closePi(child: ChildProcessWithoutNullStreams) { child.stdin.end(); await new Promise<void>(resolve => child.once("close", () => resolve())); }
async function startOcx(): Promise<ChildProcessWithoutNullStreams> { const p = spawn(process.execPath, ["run", "src/cli/index.ts", "start", "--port", String(ocxPort)], { cwd: root, env: { ...process.env, OPENCODEX_HOME: ocxHome, CODEX_HOME: codexHome, MOCK_KEY: "mock" }, stdio: ["ignore", "pipe", "pipe"] }); p.stderr.on("data", chunk => process.stderr.write(chunk)); for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${ocxPort}/healthz`)).ok) return p; } catch {} await Bun.sleep(100); } throw new Error("isolated OpenCodex startup timeout"); }
async function fail(targets: string[] = [], all = false) { await fetch(`http://127.0.0.1:${mockPort}/control/fail`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targets, all }) }); }
let ocx: ChildProcessWithoutNullStreams | undefined, pi: ChildProcessWithoutNullStreams | undefined;
try {
  ocx = await startOcx(); const session = "ordered-qualification-session"; pi = startPi(["--session-id", session]); await Bun.sleep(800);
  await ask(pi, "lead", "low"); const low = calls.at(-1)!; await ask(pi, "lead", "medium"); const medium = calls.at(-1)!; await ask(pi, "lead", "high"); const high = calls.at(-1)!;
  assert(low.effort === "low" && q9.includes(low.provider), `low route/wire mismatch ${JSON.stringify({ low, calls })}`); assert(medium.effort === "high" && medium.provider.startsWith("q27-"), `medium primary/wire mismatch ${JSON.stringify({ medium, calls })}`); assert(high.effort === "high" && high.provider.startsWith("luna-"), `high route/wire mismatch ${JSON.stringify({ high, calls })}`);
  await ask(pi, "lead", "medium"); const mediumHit = calls.at(-1)!; assert(mediumHit.provider === medium.provider && mediumHit.model === medium.model, "medium affinity miss");
  await fail([`${medium.provider}/${medium.model}`]); await ask(pi, "lead", "medium"); const mediumRebind = calls.at(-1)!; assert(mediumRebind.provider.startsWith("q27-") && mediumRebind.provider !== medium.provider && mediumRebind.effort === "high", `same-step rebind failed ${JSON.stringify({ medium, mediumRebind })}`); await fail([]); await ask(pi, "lead", "medium"); const mediumRebindHit = calls.at(-1)!; assert(mediumRebindHit.model === mediumRebind.model, "rebind affinity miss");
  await fail(q27.map(provider => `${provider}/qwen3.8-27b`)); await ask(pi, "lead", "medium"); const lunaFallback = calls.at(-1)!; assert(lunaFallback.provider.startsWith("luna-") && lunaFallback.effort === "medium", `cross-step Luna fallback failed ${JSON.stringify(lunaFallback)}`); await fail([]); await ask(pi, "lead", "medium"); const lunaHit = calls.at(-1)!; assert(lunaHit.provider === lunaFallback.provider && lunaHit.model === lunaFallback.model, `sticky Luna fallback failed ${JSON.stringify({ lunaFallback, lunaHit, calls })}`);
  await ask(pi, "lead", "high"); const highAfter = calls.at(-1)!; assert(highAfter.provider.startsWith("luna-") && highAfter.effort === "high", `high binding contaminated ${JSON.stringify(highAfter)}`); await ask(pi, "lead", "medium"); const mediumAfter = calls.at(-1)!; assert(mediumAfter.provider === lunaFallback.provider && mediumAfter.model === lunaFallback.model, "medium/high affinity isolation failed");
  await closePi(pi); pi = undefined; const files = (await readdir(sessions)).filter(x => x.endsWith(".jsonl")); assert(files.length === 1, "persistent session file missing"); const resumed = startPi(["--session", session]); await Bun.sleep(700); await ask(resumed, "lead", "low"); const lowResume = calls.at(-1)!; await ask(resumed, "lead", "medium"); const mediumResume = calls.at(-1)!; assert(lowResume.provider === low.provider && mediumResume.provider === lunaFallback.provider, "Pi resume affinity mismatch"); await closePi(resumed);
  if (ocx.exitCode === null) { ocx.kill("SIGTERM"); await new Promise<void>(resolve => ocx?.once("close", () => resolve())); } ocx = await startOcx(); const restarted = startPi(["--session", session]); await Bun.sleep(700); await ask(restarted, "lead", "medium"); const restartMedium = calls.at(-1)!; assert(restartMedium.provider.startsWith("q27-"), `restart did not rebuild primary medium HRW ${JSON.stringify(restartMedium)}`); await closePi(restarted);
  console.log(JSON.stringify({ session, initial: { low, medium, high }, mediumHit, mediumRebind, mediumRebindHit, lunaFallback, lunaHit, highAfter, mediumAfter, lowResume, mediumResume, restartMedium, acceptance: "PASS" }, null, 2));
} finally { if (pi) await closePi(pi).catch(() => {}); if (ocx && ocx.exitCode === null) { ocx.kill("SIGTERM"); await new Promise<void>(resolve => ocx?.once("close", () => resolve())); } mock.stop(true); clientProxy.stop(true); await rm(temp, { recursive: true, force: true }); const health = await fetch(`http://127.0.0.1:${formalPort}/healthz`).catch(() => undefined); if (!health?.ok) throw new Error("formal instance health failed"); }

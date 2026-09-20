#!/usr/bin/env bun
/** Real Pi persistent-session resume qualification for Adaptive Routing V1. */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const ocxPort = 18088;
const mockPort = 18089;
const formalPort = 3456;
const clientKey = `ocx_resume_${crypto.randomUUID().replaceAll("-", "")}`;
const temp = await mkdtemp(join(tmpdir(), "opencodex-pi-resume-"));
const ocxHome = join(temp, "ocx"); const codexHome = join(temp, "codex");
const piDir = join(temp, "pi-agent"); const sessionDir = join(temp, "pi-sessions");
await Promise.all([mkdir(ocxHome), mkdir(codexHome), mkdir(piDir), mkdir(sessionDir)]);

interface Call { provider: string; model: string; effort: string | null; sequence: number; }
const calls: Call[] = []; let seq = 0;
const responseSse = (model: string) => {
  const id = `resp_${crypto.randomUUID().replaceAll("-", "")}`;
  const msg = { type: "message", id: `msg_${id}`, role: "assistant", content: [{ type: "output_text", text: "ROUTE_OK", annotations: [] }] };
  const response = { id, object: "response", created_at: Math.floor(Date.now() / 1000), model, output: [msg], status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  const events = [
    ["response.created", { type: "response.created", response: { ...response, output: [] } }],
    ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { type: "message", id: msg.id, role: "assistant", content: [] } }],
    ["response.content_part.added", { type: "response.content_part.added", output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } }],
    ["response.output_text.delta", { type: "response.output_text.delta", item_id: msg.id, output_index: 0, content_index: 0, delta: "ROUTE_OK" }],
    ["response.output_text.done", { type: "response.output_text.done", item_id: msg.id, output_index: 0, content_index: 0, text: "ROUTE_OK" }],
    ["response.content_part.done", { type: "response.content_part.done", output_index: 0, content_index: 0, part: msg.content[0] }],
    ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item: msg }],
    ["response.completed", { type: "response.completed", response }],
  ].map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(`${events}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
};
const mock = Bun.serve({ hostname: "127.0.0.1", port: mockPort, async fetch(req) {
  const url = new URL(req.url); if (url.pathname === "/healthz") return Response.json({ status: "ok" });
  if (req.method !== "POST") return Response.json({ error: "not found" }, { status: 404 });
  const body = await req.json() as Record<string, any>; const provider = url.pathname.split("/").filter(Boolean)[0] ?? "unknown";
  calls.push({ provider, model: String(body.model), effort: typeof body.reasoning?.effort === "string" ? body.reasoning.effort : null, sequence: ++seq });
  return responseSse(String(body.model));
} });

const provider = (id: string, models: string[]) => ({ adapter: "openai-responses", baseUrl: `http://127.0.0.1:${mockPort}/${id}/v1`, allowPrivateNetwork: true, apiKey: "$MOCK_KEY", models, liveModels: false, contextWindow: 400000, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"], modelReasoningEfforts: Object.fromEntries(models.map(m => [m, ["low", "medium", "high", "xhigh", "max"]])) });
const config = { port: ocxPort, hostname: "0.0.0.0", defaultProvider: "local", providers: {
  local: provider("local", ["c0", "c1", "c2", "c3"]), deep: provider("deep", ["r0", "r1"]), general: provider("general", ["g0"]),
}, apiKeys: [{ id: "resume", name: "resume", key: clientKey, createdAt: new Date().toISOString() }], clientIntegrations: { codex: false }, routingProfiles: {
  coder: { candidates: [0, 1, 2, 3].map(i => ({ provider: "local", model: `c${i}`, efforts: ["low"], replicaGroup: "coder" })) },
  reasoner: { candidates: [{ provider: "deep", model: "r0", efforts: ["medium"], replicaGroup: "reasoner" }, { provider: "deep", model: "r1", efforts: ["medium"], replicaGroup: "reasoner" }] },
  general: { candidates: [{ provider: "general", model: "g0", efforts: ["high"] }] },
} };
await writeFile(join(ocxHome, "config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
await writeFile(join(piDir, "models.json"), `${JSON.stringify({ providers: { opencodex: { baseUrl: `http://127.0.0.1:${ocxPort}/v1`, api: "openai-responses", apiKey: clientKey, models: ["policy/coder", "policy/reasoner", "policy/general"].map(id => ({ id, name: id, reasoning: true, contextWindow: 400000, thinkingLevelMap: { low: "low", medium: "medium", high: "high" }, compat: { sessionAffinityFormat: "openai" } })) } } }, null, 2)}\n`, { mode: 0o600 });

function assert(ok: unknown, msg: string): asserts ok { if (!ok) throw new Error(msg); }
function startPi(args: string[]): ChildProcessWithoutNullStreams {
  return spawn("pi", ["--mode", "rpc", "--no-tools", "--no-extensions", "--session-dir", sessionDir, "--provider", "opencodex", "--model", "policy/coder", ...args], { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: piDir, OPENCODEX_API_KEY: clientKey, CODEX_HOME: codexHome }, stdio: ["pipe", "pipe", "pipe"] });
}
function rpcRequest(child: ChildProcessWithoutNullStreams, command: Record<string, unknown>): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const id = `q_${crypto.randomUUID()}`; let buf = "";
    const onData = (chunk: Buffer) => { buf += chunk.toString(); for (;;) { const i = buf.indexOf("\n"); if (i < 0) return; const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; let value: any; try { value = JSON.parse(line); } catch { continue; } if (value.type === "response" && value.id === id) { child.stdout.off("data", onData); resolve(value); return; } } };
    child.stdout.on("data", onData); child.stdin.write(`${JSON.stringify({ ...command, id })}\n`); setTimeout(() => { child.stdout.off("data", onData); reject(new Error(`RPC timeout: ${command.type}`)); }, 90000);
  });
}
async function prompt(child: ChildProcessWithoutNullStreams, text: string): Promise<void> {
  await rpcRequest(child, { type: "prompt", message: text });
  await new Promise<void>((resolve, reject) => { const on = (chunk: Buffer) => { for (const line of chunk.toString().split("\n")) { try { const v = JSON.parse(line); if (v.type === "agent_end") { child.stdout.off("data", on); resolve(); return; } } catch {} } }; child.stdout.on("data", on); setTimeout(() => { child.stdout.off("data", on); reject(new Error("agent_end timeout")); }, 90000); });
}
async function select(child: ChildProcessWithoutNullStreams, profile: string, effort: string): Promise<void> {
  const m = await rpcRequest(child, { type: "set_model", provider: "opencodex", modelId: `policy/${profile}` }); assert(m.success, `set_model ${profile} failed`);
  const t = await rpcRequest(child, { type: "set_thinking_level", level: effort }); assert(t.success, `set_thinking ${effort} failed`);
  await prompt(child, `Reply with exactly ROUTE_OK for ${profile}/${effort}`);
}
async function closePi(child: ChildProcessWithoutNullStreams): Promise<void> { child.stdin.end(); await new Promise<void>(resolve => child.once("close", () => resolve())); }
async function waitOcx(): Promise<ChildProcessWithoutNullStreams> { const p = spawn(process.execPath, ["run", "src/cli/index.ts", "start", "--port", String(ocxPort)], { cwd: root, env: { ...process.env, OPENCODEX_HOME: ocxHome, CODEX_HOME: codexHome, MOCK_KEY: "mock-upstream-key" }, stdio: ["ignore", "pipe", "pipe"] }); for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${ocxPort}/healthz`)).ok) return p; } catch {} await Bun.sleep(100); } throw new Error("isolated OpenCodex did not start"); }
let ocx: ChildProcessWithoutNullStreams | undefined; let p1: ChildProcessWithoutNullStreams | undefined; let p2: ChildProcessWithoutNullStreams | undefined;
try {
  ocx = await waitOcx(); const S = "persistent-resume-session";
  p1 = startPi(["--session-id", S]); await Bun.sleep(1000);
  await select(p1, "coder", "low"); const c1 = calls.at(-1)!;
  await select(p1, "reasoner", "medium"); const r1 = calls.at(-1)!;
  await select(p1, "general", "high"); const g1 = calls.at(-1)!;
  await select(p1, "coder", "low"); const cHit = calls.at(-1)!;
  await closePi(p1); p1 = undefined;
  const files1 = (await readdir(sessionDir)).filter(f => f.endsWith(".jsonl")); assert(files1.length === 1, `expected one persisted session, found ${files1.length}`);
  const header = JSON.parse((await readFile(join(sessionDir, files1[0]!), "utf8")).split("\n")[0]); assert(header.id === S, `persisted header id mismatch: ${header.id}`);
  p2 = startPi(["--session", S]); await Bun.sleep(1000);
  const state = await rpcRequest(p2, { type: "get_state" }); assert(state.success && state.data?.sessionId === S, `resume opened wrong session: ${JSON.stringify(state.data)}`);
  await select(p2, "reasoner", "medium"); const r2 = calls.at(-1)!;
  await select(p2, "coder", "low"); const c2 = calls.at(-1)!;
  await select(p2, "general", "high"); const g2 = calls.at(-1)!;
  await select(p2, "coder", "low"); const c2Hit = calls.at(-1)!;
  await closePi(p2); p2 = undefined;
  const firstTargets = [c1, r1, g1, cHit]; const resumedTargets = [r2, c2, g2, c2Hit];
  assert(r2.model === r1.model && c2.model === c1.model && g2.model === g1.model && c2Hit.model === c1.model, "Pi-only resume changed backend target");
  await (ocx as any).kill("SIGTERM"); await new Promise<void>(resolve => ocx?.once("close", () => resolve())); ocx = await waitOcx();
  p2 = startPi(["--session", S]); await Bun.sleep(1000); await select(p2, "coder", "low"); const c3 = calls.at(-1)!; await select(p2, "reasoner", "medium"); const r3 = calls.at(-1)!; await select(p2, "general", "high"); const g3 = calls.at(-1)!;
  assert(c3.model === c1.model && r3.model === r1.model && g3.model === g1.model, "Pi+OpenCodex restart changed HRW target");
  await closePi(p2); p2 = undefined;
  const t = startPi(["--session-id", "persistent-resume-session-T"]); await Bun.sleep(1000); await select(t, "coder", "low"); const tCall = calls.at(-1)!; await closePi(t);
  console.log(JSON.stringify({ sessionId: S, persistedFile: files1[0], first: { coder: c1, reasoner: r1, general: g1, coderHit: cHit }, piOnlyResume: { reasoner: r2, coder: c2, general: g2, coderHit: c2Hit }, combinedRestart: { coder: c3, reasoner: r3, general: g3 }, secondSession: { id: "persistent-resume-session-T", coder: tCall }, acceptance: "PASS" }, null, 2));
} finally { if (p1) await closePi(p1).catch(() => {}); if (p2) await closePi(p2).catch(() => {}); if (ocx && ocx.exitCode === null) { ocx.kill("SIGTERM"); await new Promise<void>(resolve => ocx?.once("close", () => resolve())); } mock.stop(true); await rm(temp, { recursive: true, force: true }); const f = await fetch(`http://127.0.0.1:${formalPort}/healthz`).catch(() => undefined); if (!f?.ok) throw new Error("formal instance health failed"); }

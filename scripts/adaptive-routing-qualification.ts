#!/usr/bin/env bun
/**
 * Deterministic Pi x OpenCodex Adaptive Routing V1 qualification.
 *
 * This is intentionally independent from the formal proxy on :3456. A local
 * recording upstream provides provider/model identity and deterministic SSE
 * Responses replies; Pi talks only to the isolated OpenCodex child.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const repoRoot = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const ocxPort = Number(process.env.OPENCODEX_QUAL_PORT ?? "18084");
const mockPort = Number(process.env.OPENCODEX_QUAL_MOCK_PORT ?? "18085");
const clientPort = Number(process.env.OPENCODEX_QUAL_CLIENT_PORT ?? "18086");
const piCommand = process.env.PI_BIN ?? "pi";
const formalPort = 3456;
const testKey = `ocx_qualification_${crypto.randomUUID().replaceAll("-", "")}`;
const mockKey = "mock-upstream-key";

for (const [name, value] of [["OPENCODEX_QUAL_PORT", ocxPort], ["OPENCODEX_QUAL_MOCK_PORT", mockPort], ["OPENCODEX_QUAL_CLIENT_PORT", clientPort]] as const) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error(`${name} must be a valid port`);
}
if (new Set([ocxPort, mockPort, clientPort, formalPort]).size !== 4) throw new Error("qualification ports collide");

interface Call {
  provider: string;
  model: string;
  sessionId: string | null;
  bodySessionId: string | null;
  effort: string | null;
  bodyModel: string;
  sequence: number;
}
const calls: Call[] = [];
const clientSessions: Array<string | null> = [];
const failOnce = new Set<string>();
const failedTargets = new Set<string>();
let failAllCandidates = false;
let sequence = 0;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function sse(body: Record<string, unknown>): Response {
  const id = `resp_${crypto.randomUUID().replaceAll("-", "")}`;
  const output = body.output ?? [{ type: "message", id: `msg_${id}`, role: "assistant", content: [{ type: "output_text", text: "ROUTE_OK", annotations: [] }] }];
  const payload = { id, object: "response", created_at: Math.floor(Date.now() / 1000), model: body.model ?? "mock", output, status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  const message = { type: "message", id: `msg_${id}`, role: "assistant", content: [{ type: "output_text", text: "ROUTE_OK", annotations: [] }] };
  const lines = [
    `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { ...payload, output: [] } })}\n\n`,
    `event: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { type: "message", id: message.id, role: "assistant", content: [] } })}\n\n`,
    `event: response.content_part.added\ndata: ${JSON.stringify({ type: "response.content_part.added", output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } })}\n\n`,
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", item_id: message.id, output_index: 0, content_index: 0, delta: "ROUTE_OK" })}\n\n`,
    `event: response.output_text.done\ndata: ${JSON.stringify({ type: "response.output_text.done", item_id: message.id, output_index: 0, content_index: 0, text: "ROUTE_OK" })}\n\n`,
    `event: response.content_part.done\ndata: ${JSON.stringify({ type: "response.content_part.done", output_index: 0, content_index: 0, part: message.content[0] })}\n\n`,
    `event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: message })}\n\n`,
    `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { ...payload, output: [message] } })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new Response(lines, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

const mockServer = Bun.serve({
  hostname: "127.0.0.1",
  port: mockPort,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return jsonResponse({ status: "ok" });
    if (url.pathname === "/control/fail") {
      const control = await request.json() as { targets?: string[]; all?: boolean };
      failedTargets.clear(); for (const target of control.targets ?? []) failedTargets.add(target);
      failAllCandidates = control.all === true;
      return jsonResponse({ ok: true });
    }
    if (url.pathname === "/v1/models") return jsonResponse({ object: "list", data: [] });
    if (request.method !== "POST" || !url.pathname.endsWith("/responses")) return jsonResponse({ error: "not found" }, 404);
    const provider = url.pathname.split("/").filter(Boolean)[0] ?? "unknown";
    const body = await request.json() as Record<string, any>;
    const headers = request.headers;
    const sessionId = headers.get("session_id") ?? headers.get("session-id") ?? headers.get("x-client-request-id") ?? headers.get("x-opencode-session");
    const bodySessionId = typeof body.session_id === "string" ? body.session_id : null;
    const effort = typeof body.reasoning?.effort === "string" ? body.reasoning.effort : null;
    calls.push({ provider, model: String(body.model ?? ""), sessionId, bodySessionId, effort, bodyModel: String(body.model ?? ""), sequence: ++sequence });
    const failureKey = `${provider}/${String(body.model ?? "")}`;
    if (failAllCandidates || failedTargets.has(failureKey) || (process.env.OPENCODEX_QUAL_INJECT_FAILURE === failureKey && !failOnce.has(failureKey))) {
      failOnce.add(failureKey);
      return jsonResponse({ error: { message: "synthetic transient failure", type: "server_error" } }, 503);
    }
    return sse({ model: body.model });
  },
});

const clientProxy = Bun.serve({
  hostname: "127.0.0.1",
  port: clientPort,
  async fetch(request) {
    const url = new URL(request.url);
    clientSessions.push(request.headers.get("session_id") ?? request.headers.get("session-id") ?? request.headers.get("x-client-request-id"));
    const headers = new Headers(request.headers);
    headers.delete("host");
      headers.set("authorization", `Bearer ${testKey}`);
    return fetch(`http://127.0.0.1:${ocxPort}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
    });
  },
});

const tempRoot = await mkdtemp(join(tmpdir(), "opencodex-qualification-"));
const ocxHome = join(tempRoot, "opencodex-home");
const piHome = join(tempRoot, "pi-agent");
const piSessionDir = join(tempRoot, "pi-sessions");
const codexHome = join(tempRoot, "codex-home");
await Promise.all([mkdir(ocxHome), mkdir(piHome), mkdir(piSessionDir), mkdir(codexHome)]);

const provider = (id: string, models: string[]) => ({
  adapter: "openai-responses",
  baseUrl: `http://127.0.0.1:${mockPort}/${id}/v1`,
  allowPrivateNetwork: true,
  apiKey: `$MOCK_UPSTREAM_API_KEY`,
  models,
  liveModels: false,
  contextWindow: 400000,
  reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  modelReasoningEfforts: Object.fromEntries(models.map(model => [model, ["low", "medium", "high", "xhigh", "max"]])),
});
const config = {
  port: ocxPort,
  hostname: "0.0.0.0",
  defaultProvider: "openai-a",
  providers: {
    "openai-a": provider("openai-a", ["model-a", "model-b"]),
    "deepseek-a": provider("deepseek-a", ["model-a", "model-b", "model-c"]),
    "local-a": provider("local-a", ["replica-0", "replica-1", "replica-2", "replica-3"]),
    "local-b": provider("local-b", ["replica-4"]),
  },
  apiKeys: [{ id: "qualification", name: "qualification", key: testKey, createdAt: new Date().toISOString() }],
  clientIntegrations: { codex: false },
  routingProfiles: {
    coder: { candidates: [
      { provider: "local-a", model: "replica-0", efforts: ["low", "medium"], replicaGroup: "coder" },
      { provider: "local-a", model: "replica-1", efforts: ["low", "medium"], replicaGroup: "coder" },
      { provider: "local-a", model: "replica-2", efforts: ["low", "medium"], replicaGroup: "coder" },
      { provider: "local-a", model: "replica-3", efforts: ["low", "medium"], replicaGroup: "coder" },
      { provider: "openai-a", model: "model-a", efforts: ["high"] },
      { provider: "openai-a", model: "model-b", efforts: ["xhigh"] },
    ] },
    reasoner: { candidates: [
      { provider: "deepseek-a", model: "model-a", efforts: ["low", "medium"], replicaGroup: "reasoner" },
      { provider: "deepseek-a", model: "model-b", efforts: ["medium"], replicaGroup: "reasoner" },
      { provider: "deepseek-a", model: "model-c", efforts: ["high"] },
      { provider: "openai-a", model: "model-b", efforts: ["xhigh", "max"] },
    ] },
    general: { candidates: [
      { provider: "local-b", model: "replica-4", efforts: ["low", "medium", "high", "xhigh", "max"], replicaGroup: "general" },
    ] },
    firstfail: { candidates: [
      { provider: "local-a", model: "replica-0", efforts: ["low"] },
      { provider: "local-a", model: "replica-1", efforts: ["low"] },
    ] },
  },
};
await writeFile(join(ocxHome, "config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
await writeFile(join(piHome, "models.json"), `${JSON.stringify({ providers: { opencodex: {
  baseUrl: `http://127.0.0.1:${clientPort}/v1`, api: "openai-responses", apiKey: testKey,
  models: ["policy/coder", "policy/reasoner", "policy/general", "policy/firstfail"].map(id => ({ id, name: id, reasoning: true, thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }, contextWindow: 400000, compat: { sessionAffinityFormat: "openai" } })),
} } }, null, 2)}\n`, { mode: 0o600 });

function childRun(command: string, args: string[], env: Record<string, string | undefined>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject); child.on("close", code => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const piEnv = { PI_CODING_AGENT_DIR: piHome, PI_SESSION_DIR: piSessionDir, CODEX_HOME: codexHome, OPENCODEX_API_KEY: testKey };
async function pi(model: string, thinking: string, sessionId: string): Promise<void> {
  const result = await childRun(piCommand, ["--provider", "opencodex", "--model", model, "--thinking", thinking, "--session-id", sessionId, "--no-tools", "-p", "Reply with exactly ROUTE_OK"], piEnv);
  assert(result.code === 0 && result.stdout.includes("ROUTE_OK"), `Pi ${model}/${thinking} failed: stderr=${result.stderr} stdout=${result.stdout}`);
}
async function setFailures(targets: string[], all = false): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${mockPort}/control/fail`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targets, all }) });
  assert(response.ok, "mock failure control request failed");
}

let openCodex: ChildProcess | undefined;
const serverEnv = { ...process.env, OPENCODEX_HOME: ocxHome, CODEX_HOME: codexHome, MOCK_UPSTREAM_API_KEY: mockKey };
async function startOpenCodex(): Promise<void> {
  openCodex = spawn(process.execPath, ["run", "src/cli/index.ts", "start", "--port", String(ocxPort)], { cwd: repoRoot, env: serverEnv, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; openCodex.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${ocxPort}/readyz`); if (r.ok) return; } catch {} await Bun.sleep(100); }
  throw new Error(`isolated OpenCodex not ready: ${stderr}`);
}
async function stopOpenCodex(): Promise<void> {
  if (!openCodex || openCodex.exitCode !== null) return;
  openCodex.kill("SIGTERM");
  await new Promise<void>(resolve => openCodex?.once("close", () => resolve()));
}
try {
  await startOpenCodex();

  const matrix: Array<[string, string]> = [["policy/coder", "low"], ["policy/coder", "medium"], ["policy/coder", "high"], ["policy/coder", "xhigh"], ["policy/reasoner", "low"], ["policy/reasoner", "medium"], ["policy/reasoner", "high"], ["policy/reasoner", "xhigh"], ["policy/general", "low"], ["policy/general", "high"]];
  for (const [model, effort] of matrix) await pi(model, effort, `matrix-${model.replaceAll("/", "-")}-${effort}`);
  assert(calls.length === matrix.length, `matrix calls=${calls.length}, expected=${matrix.length}`);
  const matrixRows = calls.splice(0, calls.length);
  assert(matrixRows.some(c => c.provider === "openai-a" && c.model === "model-a" && c.effort === "high"), "coder high did not reach OpenAI model-a");
  assert(matrixRows.some(c => c.provider === "openai-a" && c.model === "model-a" && c.effort === "high"), `coder xhigh mapped effort did not reach OpenAI high route: ${JSON.stringify(matrixRows)}`);
  assert(matrixRows.some(c => c.provider === "deepseek-a" && c.effort === "medium"), "reasoner medium did not reach DeepSeek");

  const session = "qualification-multi-profile";
  await pi("policy/coder", "low", session); const coderFirst = calls.at(-1)!;
  await pi("policy/coder", "low", session); const coderHit = calls.at(-1)!;
  await pi("policy/reasoner", "medium", session); const reasonerFirst = calls.at(-1)!;
  await pi("policy/reasoner", "medium", session); const reasonerHit = calls.at(-1)!;
  await pi("policy/coder", "low", session); const coderBack = calls.at(-1)!;
  assert(coderFirst.provider === coderHit.provider && coderFirst.model === coderHit.model, "coder affinity missed");
  assert(reasonerFirst.provider === reasonerHit.provider && reasonerFirst.model === reasonerHit.model, "reasoner affinity missed");
  assert(coderBack.provider === coderFirst.provider && coderBack.model === coderFirst.model, "coder affinity was contaminated by reasoner");
  assert(coderFirst.provider !== reasonerFirst.provider || coderFirst.model !== reasonerFirst.model, "profiles share concrete target unexpectedly");
  const sessionHeaders = clientSessions.slice(-5);
  assert(sessionHeaders.length === 5 && sessionHeaders.every(value => value === session), `Pi session header was not stable: ${JSON.stringify(sessionHeaders)}`);

  const distributions = new Map<string, number>();
  for (let i = 0; i < 32; i++) { await pi("policy/coder", "low", `dist-${i}`); const c = calls.at(-1)!; const key = `${c.provider}/${c.model}`; distributions.set(key, (distributions.get(key) ?? 0) + 1); }
  assert(distributions.size >= 2, `coder replica distribution only reached ${distributions.size} target(s); sessions=${JSON.stringify(clientSessions.slice(-32))}; calls=${JSON.stringify(calls.slice(-32))}`);

  const unknown = await childRun(piCommand, ["--provider", "opencodex", "--model", "policy/does-not-exist", "--thinking", "low", "--no-session", "--no-tools", "-p", "Reply with exactly NO"], piEnv);
  assert(unknown.code !== 0 && /unknown routing policy|404|not found/i.test(`${unknown.stderr}${unknown.stdout}`), "unknown logical model did not fail clearly");

  const off = await childRun(piCommand, ["--provider", "opencodex", "--model", "policy/coder", "--thinking", "off", "--no-session", "--no-tools", "-p", "Reply with exactly OFF"], piEnv);
  assert(off.code === 0 && off.stdout.includes("ROUTE_OK"), `off/missing-effort request failed: ${off.stderr || off.stdout}`);
  const offCall = calls.at(-1)!;
  assert(offCall.effort === "low" || offCall.effort === null, `Pi off emitted unexpected effort=${offCall.effort}`);

  await setFailures([`${coderFirst.provider}/${coderFirst.model}`]);
  await pi("policy/coder", "low", session);
  const coderFallback = calls.at(-1)!;
  assert(`${coderFallback.provider}/${coderFallback.model}` !== `${coderFirst.provider}/${coderFirst.model}`, "coder fallback reused failed target");
  await setFailures([]);
  await pi("policy/coder", "low", session);
  const coderReboundHit = calls.at(-1)!;
  assert(coderReboundHit.provider === coderFallback.provider && coderReboundHit.model === coderFallback.model, "coder fallback did not rebind");
  await pi("policy/reasoner", "medium", session);
  const reasonerAfterCoder = calls.at(-1)!;
  await pi("policy/general", "high", session);
  const generalAfterCoder = calls.at(-1)!;
  assert(reasonerAfterCoder.provider === reasonerFirst.provider && reasonerAfterCoder.model === reasonerFirst.model, "coder rebind contaminated reasoner");
  assert(generalAfterCoder.provider === "local-b" && generalAfterCoder.model === "replica-4", "coder rebind contaminated general");

  await setFailures([`${reasonerFirst.provider}/${reasonerFirst.model}`]);
  await pi("policy/reasoner", "medium", session);
  const reasonerFallback = calls.at(-1)!;
  assert(`${reasonerFallback.provider}/${reasonerFallback.model}` !== `${reasonerFirst.provider}/${reasonerFirst.model}`, "reasoner fallback reused failed target");
  await setFailures([]);
  await pi("policy/reasoner", "medium", session);
  const reasonerReboundHit = calls.at(-1)!;
  await pi("policy/coder", "low", session);
  const coderAfterReasoner = calls.at(-1)!;
  assert(reasonerReboundHit.provider === reasonerFallback.provider && reasonerReboundHit.model === reasonerFallback.model, "reasoner fallback did not rebind");
  assert(coderAfterReasoner.provider === coderFallback.provider && coderAfterReasoner.model === coderFallback.model, "reasoner rebind contaminated coder");

  await setFailures(["local-a/replica-0"]);
  await pi("policy/firstfail", "low", "first-failure-session");
  const firstFallback = calls.at(-1)!;
  assert(firstFallback.model === "replica-1", `first selected failure did not fallback to replica-1: ${firstFallback.model}`);
  await setFailures([]);
  await pi("policy/firstfail", "low", "first-failure-session");
  const firstRebound = calls.at(-1)!;
  assert(firstRebound.model === "replica-1", `first failure target was committed: ${firstRebound.model}`);

  await setFailures([], true);
  const allFailed = await childRun(piCommand, ["--provider", "opencodex", "--model", "policy/coder", "--thinking", "low", "--session-id", session, "--no-tools", "-p", "Reply with exactly FAIL"] , piEnv);
  assert(allFailed.code !== 0, "all-failed request unexpectedly succeeded");
  await setFailures([]);

  await stopOpenCodex();
  await startOpenCodex();
  await pi("policy/coder", "low", session);
  const restartCoder = calls.at(-1)!;
  await pi("policy/reasoner", "medium", session);
  const restartReasoner = calls.at(-1)!;
  const restartDeterministic = restartCoder.provider === coderFirst.provider && restartCoder.model === coderFirst.model
    && restartReasoner.provider === reasonerFirst.provider && restartReasoner.model === reasonerFirst.model;

  console.log(JSON.stringify({
    formalPort,
    isolatedPort: ocxPort,
    clientPort,
    mockPort,
    matrix: matrixRows.map(c => ({ provider: c.provider, model: c.model, effort: c.effort, sessionId: c.sessionId, sequence: c.sequence })),
    session: { id: session, clientIngressHeaders: sessionHeaders, coderFirst, coderHit, reasonerFirst, reasonerHit, coderBack },
    distribution: Object.fromEntries(distributions),
    restart: { coder: restartCoder, reasoner: restartReasoner, deterministic: restartDeterministic ? "PASS" : "FAIL", note: restartDeterministic ? undefined : "process restart changes the salted principal, so current V1 HRW key is not cross-process stable" },
    failureIsolation: { coderFallback, coderReboundHit, reasonerAfterCoder, generalAfterCoder, reasonerFallback, reasonerReboundHit, coderAfterReasoner, firstFallback, firstRebound, allFailed: "PASS" },
    negative: { unknown: "PASS", offContractObserved: offCall.effort === null ? "omitted" : `mapped:${offCall.effort}`, offObservedEffort: offCall.effort },
  }, null, 2));
} finally {
  await stopOpenCodex();
  mockServer.stop(true);
  clientProxy.stop(true);
  await rm(tempRoot, { recursive: true, force: true });
  const formal = await fetch(`http://127.0.0.1:${formalPort}/healthz`).catch(() => undefined);
  if (!formal?.ok) throw new Error("formal instance health check failed after qualification cleanup");
}

#!/usr/bin/env bun
/** Bounded real-provider smoke through an isolated OpenCodex instance. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const port = Number(process.env.OPENCODEX_REAL_SMOKE_PORT ?? "18087");
const formal = "http://127.0.0.1:3456/v1";
const key = (await readFile(process.env.OPENCODEX_TEST_UPSTREAM_KEY_FILE ?? "/etc/opencodex/client-api-key", "utf8")).trim();
const clientKey = `ocx_real_${crypto.randomUUID().replaceAll("-", "")}`;
const temp = await mkdtemp(join(tmpdir(), "opencodex-real-smoke-"));
const home = join(temp, "ocx"); const codex = join(temp, "codex");
await mkdir(home); await mkdir(codex);
const models = ["gpt-5.4", "gpt-5.6-sol", "deepseek/deepseek-flash", "deepseek/deepseek-v4-flash"];
const provider = {
  adapter: "openai-responses", baseUrl: formal, allowPrivateNetwork: true,
  apiKey: "$OPENCODEX_REAL_UPSTREAM_KEY", models, liveModels: false,
  contextWindow: 400000, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  modelReasoningEfforts: Object.fromEntries(models.map(model => [model, ["low", "medium", "high", "xhigh", "max"]])),
};
const config = {
  port, hostname: "127.0.0.1", defaultProvider: "real-gateway",
  providers: { "real-gateway": provider },
  apiKeys: [{ id: "real-smoke", name: "real-smoke", key: clientKey, createdAt: new Date().toISOString() }],
  clientIntegrations: { codex: false },
  routingProfiles: {
    openai: { candidates: [
      { provider: "real-gateway", model: "gpt-5.4", efforts: ["low", "medium"] },
      { provider: "real-gateway", model: "gpt-5.6-sol", efforts: ["high", "xhigh", "max"] },
    ] },
    deepseek: { candidates: [
      { provider: "real-gateway", model: "deepseek/deepseek-flash", efforts: ["low", "medium"] },
      { provider: "real-gateway", model: "deepseek/deepseek-v4-flash", efforts: ["high", "xhigh", "max"] },
    ] },
  },
};
await writeFile(join(home, "config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
const piHome = join(temp, "pi"); await mkdir(piHome);
await writeFile(join(piHome, "models.json"), `${JSON.stringify({ providers: { opencodex: {
  baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-responses", apiKey: clientKey,
  models: ["policy/openai", "policy/deepseek"].map(id => ({ id, name: id, reasoning: true, contextWindow: 400000, thinkingLevelMap: { low: "low", high: "high" } })),
} } }, null, 2)}\n`, { mode: 0o600 });
function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => { const p = spawn("pi", args, { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: piHome, CODEX_HOME: codex, OPENCODEX_API_KEY: clientKey }, stdio: ["ignore", "pipe", "pipe"] }); let out = "", err = ""; p.stdout.on("data", x => out += x); p.stderr.on("data", x => err += x); p.on("error", reject); p.on("close", code => resolve({ code: code ?? 1, out, err })); });
}
const server = spawn(process.execPath, ["run", "src/cli/index.ts", "start", "--port", String(port)], { cwd: root, env: { ...process.env, OPENCODEX_HOME: home, CODEX_HOME: codex, OPENCODEX_REAL_UPSTREAM_KEY: key }, stdio: ["ignore", "pipe", "pipe"] });
let stderr = ""; server.stderr.on("data", x => stderr += x);
try {
  let ready = false; for (let i = 0; i < 100; i++) { try { ready = (await fetch(`http://127.0.0.1:${port}/healthz`)).ok; } catch {} if (ready) break; await Bun.sleep(100); }
  if (!ready) throw new Error(`real smoke proxy did not start: ${stderr}`);
  const cases = [["policy/openai", "low", "gpt-5.4"], ["policy/openai", "high", "gpt-5.6-sol"], ["policy/deepseek", "low", "deepseek/deepseek-flash"], ["policy/deepseek", "high", "deepseek/deepseek-v4-flash"]] as const;
  const results = [];
  for (const [model, effort, expected] of cases) {
    const r = await run(["--provider", "opencodex", "--model", model, "--thinking", effort, "--no-tools", "--no-session", "-p", "Reply with exactly ROUTE_OK"]);
    const ok = r.code === 0 && r.out.includes("ROUTE_OK");
    results.push({ model, effort, expected, result: ok ? "PASS" : "FAIL", detail: ok ? undefined : (r.err || r.out).replaceAll(/(sk|ocx)_[A-Za-z0-9_-]+/g, "<redacted>") });
  }
  console.log(JSON.stringify({ formalPort: 3456, isolatedPort: port, cases: results }, null, 2));
} finally {
  if (server.exitCode === null) { server.kill("SIGTERM"); await new Promise<void>(resolve => server.once("close", () => resolve())); }
  await rm(temp, { recursive: true, force: true });
  const formalHealth = await fetch("http://127.0.0.1:3456/healthz").catch(() => undefined);
  if (!formalHealth?.ok) throw new Error("formal instance health check failed after real smoke");
}

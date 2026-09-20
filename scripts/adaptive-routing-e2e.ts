#!/usr/bin/env bun
/**
 * Isolated adaptive-routing deployment smoke test.
 *
 * Starts the checkout on a dedicated loopback port and asks the local Pi CLI to
 * send Responses requests through policy/coder. No persistent user config is
 * read or modified; all generated state is temporary and removed on exit.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const port = Number(process.env.OPENCODEX_TEST_PORT ?? "18083");
const upstreamUrl = process.env.OPENCODEX_TEST_UPSTREAM_URL ?? "http://127.0.0.1:3456/v1";
const upstreamKeyFile = process.env.OPENCODEX_TEST_UPSTREAM_KEY_FILE ?? "/etc/opencodex/client-api-key";
const piCommand = process.env.PI_BIN ?? "pi";
const localApiKey = `ocx_test_${crypto.randomUUID().replaceAll("-", "")}`;

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error(`OPENCODEX_TEST_PORT must be an integer from 1024 to 65535 (got ${port})`);
}

const upstreamKey = (await readFile(upstreamKeyFile, "utf8")).trim();
if (!upstreamKey) throw new Error(`Upstream key file is empty: ${upstreamKeyFile}`);

const tempRoot = await mkdtemp(join(tmpdir(), "opencodex-adaptive-e2e-"));
const ocxHome = join(tempRoot, "opencodex-home");
const piHome = join(tempRoot, "pi-agent");
const piSessionDir = join(tempRoot, "pi-sessions");
const codexHome = join(tempRoot, "codex-home");
await mkdir(ocxHome);
await mkdir(piHome);
await mkdir(piSessionDir);
await mkdir(codexHome);

const config = {
  port,
  hostname: "127.0.0.1",
  defaultProvider: "formal-proxy",
  providers: {
    "formal-proxy": {
      adapter: "openai-responses",
      baseUrl: upstreamUrl,
      allowPrivateNetwork: true,
      apiKey: "$OPENCODEX_TEST_UPSTREAM_API_KEY",
      models: ["public", "worker", "control", "expert", "frontier"],
      liveModels: false,
      contextWindow: 400000,
      reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      modelReasoningEfforts: {
        public: ["low", "medium"],
        worker: ["high"],
        control: ["high"],
        expert: ["xhigh"],
        frontier: ["max"],
      },
    },
  },
  apiKeys: [{ id: "adaptive-e2e", name: "adaptive-e2e", key: localApiKey, createdAt: new Date().toISOString() }],
  clientIntegrations: { codex: false },
  routingProfiles: {
    coder: {
      candidates: [
        { provider: "formal-proxy", model: "public", efforts: ["low", "medium"], replicaGroup: "public" },
        { provider: "formal-proxy", model: "worker", efforts: ["high"], replicaGroup: "worker" },
        { provider: "formal-proxy", model: "control", efforts: ["high"], replicaGroup: "control" },
        { provider: "formal-proxy", model: "expert", efforts: ["xhigh"], replicaGroup: "expert" },
        { provider: "formal-proxy", model: "frontier", efforts: ["max"], replicaGroup: "frontier" },
      ],
    },
  },
};
await writeFile(join(ocxHome, "config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
await writeFile(join(piHome, "models.json"), `${JSON.stringify({
  providers: {
    opencodex: {
      baseUrl: `http://127.0.0.1:${port}/v1`,
      api: "openai-responses",
      apiKey: localApiKey,
      models: [{
        id: "policy/coder",
        name: "OpenCodex adaptive test",
        reasoning: true,
        contextWindow: 400000,
        compat: { sessionAffinityFormat: "openai" },
      }],
    },
  },
}, null, 2)}\n`, { mode: 0o600 });

function run(command: string, args: string[], env: Record<string, string | undefined>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const server = spawn(process.execPath, ["run", "src/cli/index.ts", "start", "--port", String(port)], {
  cwd: repoRoot,
  env: {
    ...process.env,
    OPENCODEX_HOME: ocxHome,
    CODEX_HOME: codexHome,
    OPENCODEX_TEST_UPSTREAM_API_KEY: upstreamKey,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverStdout = "";
let serverStderr = "";
server.stdout.on("data", (chunk: Buffer) => { serverStdout += chunk.toString(); });
server.stderr.on("data", (chunk: Buffer) => { serverStderr += chunk.toString(); });

async function stopServer(): Promise<void> {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await new Promise<void>((resolve) => server.once("close", () => resolve()));
}

try {
  let health: Response | undefined;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      health = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (health.ok) break;
    } catch {
      // Startup is asynchronous; retry within the bounded deadline.
    }
    await Bun.sleep(250);
  }
  if (!health?.ok) throw new Error(`test proxy did not become healthy${serverStderr ? `: ${serverStderr.trim()}` : ""}`);

  let ready: Response | undefined;
  let readyBody = "";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    ready = await fetch(`http://127.0.0.1:${port}/readyz`);
    readyBody = await ready.text();
    if (ready.ok) break;
    await Bun.sleep(250);
  }
  if (!ready?.ok) {
    throw new Error(`test proxy is not ready: HTTP ${ready?.status ?? "unknown"}; body=${readyBody}; stderr=${serverStderr.trim()}`);
  }

  const piEnv = {
    PI_CODING_AGENT_DIR: piHome,
    PI_SESSION_DIR: piSessionDir,
    OPENCODEX_API_KEY: localApiKey,
    CODEX_HOME: codexHome,
  };
  const low = await run(piCommand, ["--provider", "opencodex", "--model", "policy/coder", "--thinking", "low", "--no-tools", "--no-session", "-p", "Reply with exactly LOW_OK"], piEnv);
  if (low.code !== 0 || !low.stdout.includes("LOW_OK")) {
    throw new Error(`Pi low-effort E2E failed (exit ${low.code}): ${low.stderr.trim() || low.stdout.trim()}; server=${serverStdout.trim()} ${serverStderr.trim()}`);
  }

  const high = await run(piCommand, ["--provider", "opencodex", "--model", "policy/coder", "--thinking", "high", "--no-tools", "--no-session", "-p", "Reply with exactly HIGH_OK"], piEnv);
  if (high.code !== 0 || !high.stdout.includes("HIGH_OK")) {
    throw new Error(`Pi high-effort E2E failed (exit ${high.code}): ${high.stderr.trim() || high.stdout.trim()}; server=${serverStdout.trim()} ${serverStderr.trim()}`);
  }

  console.log(`adaptive routing E2E passed: isolated proxy on 127.0.0.1:${port}; Pi low/high Responses requests completed`);
} finally {
  await stopServer();
  await rm(tempRoot, { recursive: true, force: true });
}

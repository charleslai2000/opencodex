import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../../src/server";
import { saveConfig } from "../../src/config";
import { saveCodexAccountCredential } from "../../src/codex/account-store";
import { fakeChatGptJwt } from "../helpers/fake-chatgpt-jwt";
import { applyRoutingPreset } from "../../src/routing/presets";
import { buildRoutingRuntimeSnapshot } from "../../src/routing/runtime-snapshot";
import { createLocalAttestationSecret, createLocalAttestationChallenge, LOCAL_ATTESTATION_CHALLENGE_HEADER } from "../../src/lib/local-management-attestation";
import { createLocalRoutingReloadCapability, LOCAL_ROUTING_RELOAD_CAPABILITY_HEADER, LOCAL_ROUTING_RELOAD_CONFIG_HASH_HEADER, LOCAL_ROUTING_RELOAD_EXPECTED_PID_HEADER, LOCAL_ROUTING_RELOAD_EXPIRES_AT_HEADER, LOCAL_ROUTING_RELOAD_METHOD, LOCAL_ROUTING_RELOAD_NONCE_HEADER, LOCAL_ROUTING_RELOAD_PATH } from "../../src/lib/local-routing-reload-contract";
import { writeRuntimePort } from "../../src/config/process-state";
import { requestBoundLocalRoutingState } from "../../src/server/local-routing-reload-client";
import type { LiveProxy } from "../../src/server/proxy-liveness";
import type { OcxConfig } from "../../src/types";

function fixture(): OcxConfig {
  return {
    port: 0, defaultProvider: "openai", apiKeys: [{ key: "fixture-key", id: "fixture", name: "fixture", createdAt: "2026-01-01T00:00:00.000Z" }], combos: {},
    providers: {
      openai: { adapter: "openai-responses", baseUrl: "https://chatgpt.com/backend-api/codex", authMode: "forward", codexAccountMode: "pool", models: ["gpt-6-luna", "gpt-5.6-terra", "gpt-6-sol"], liveModels: false, contextWindow: 1_000_000, reasoningEfforts: ["low", "medium", "high"], modelReasoningEfforts: { "gpt-6-luna": ["low", "medium", "high"], "gpt-5.6-terra": ["low", "medium", "high"] } },
      openrouter: { adapter: "openai-chat", baseUrl: "https://openrouter.ai/api/v1", apiKey: "fixture-key", models: ["@preset/lstack-ling-3-0-flash"], liveModels: false },
      deepseek: { adapter: "openai-chat", baseUrl: "https://api.deepseek.com", apiKey: "fixture-key", models: ["deepseek-flash"], liveModels: false },
    },
    codexAccounts: [{ id: "main", email: "main@example.test", isMain: true }, { id: "pool-a", email: "pool-a@example.test", isMain: false, chatgptAccountId: "acct-pool-a" }], activeCodexAccountId: "pool-a",
    clientIntegrations: { codex: false },
  } as OcxConfig;
}

describe("routing reload in-flight HTTP Responses E2E", () => {
  test("pending lead turn retains generation across reload and rollback", async () => {
    const home = mkdtempSync(join("/tmp", "ocx-routing-inflight-"));
    writeFileSync(join(home, "admin-api-token"), "ocx_admin_" + "A".repeat(43));
    const previousHome = process.env.OPENCODEX_HOME; const previousToken = process.env.OPENCODEX_API_AUTH_TOKEN;
    process.env.OPENCODEX_HOME = home; process.env.OPENCODEX_API_AUTH_TOKEN = "fixture-key";
    const secret = createLocalAttestationSecret();
    const initial = applyRoutingPreset(fixture(), "openai");
    saveConfig(initial);
    const requests: Array<{ body: any; release: () => void; entered: Promise<void> }> = [];
    const upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      let release!: () => void; let entered!: () => void;
      const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      requests.push({ body, release, entered: enteredPromise }); entered(); await gate;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `resp-${requests.length}`, object: "response", status: "completed", model: body.model, output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }], usage: { input_tokens: 1, output_tokens: 1 } }));
    });
    await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
    const port = (upstream.address() as any).port;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
      if (url.startsWith("https://chatgpt.com/backend-api/codex") || url.startsWith("https://api.deepseek.com")) return originalFetch(`http://127.0.0.1:${port}${new URL(url).pathname.replace("/backend-api/codex", "")}`, init);
      return originalFetch(input, init);
    }) as typeof fetch;
    const runtimeConfig = structuredClone(initial);
    saveCodexAccountCredential("pool-a", { accessToken: "fixture-access-token", refreshToken: "fixture-refresh-token", expiresAt: Date.now() + 600_000, chatgptAccountId: "acct-pool-a" });
    saveConfig(runtimeConfig);
    const server = startServer(0, { localAttestationSecret: secret, skipStartupCatalogSync: true } as never);
    const pid = process.pid; writeRuntimePort({ pid, port: server.port, hostname: "127.0.0.1", attestationSecret: secret });
    const target: LiveProxy = { source: "runtime", pid, port: server.port, hostname: "127.0.0.1" } as LiveProxy;
    const initialSnapshot = buildRoutingRuntimeSnapshot(initial);
    const call = () => fetch(`http://127.0.0.1:${server.port}/v1/responses`, { method: "POST", headers: { authorization: "Bearer fixture-key", "content-type": "application/json" }, body: JSON.stringify({ model: "policy/lead", input: "hello", reasoning: { effort: "low" }, stream: false }) });
    const writeRouting = (config: OcxConfig) => { saveConfig(config); };
    const reload = async () => {
      const bytes = readFileSync(join(home, "config.json")); const hash = createHash("sha256").update(bytes).digest("hex");
      const nonce = createLocalAttestationChallenge(); const expires = Date.now() + 5000;
      const cap = createLocalRoutingReloadCapability(secret, nonce, LOCAL_ROUTING_RELOAD_METHOD, LOCAL_ROUTING_RELOAD_PATH, pid, server.port, expires, hash)!;
      const response = await fetch(`http://127.0.0.1:${server.port}${LOCAL_ROUTING_RELOAD_PATH}`, { method: "POST", headers: { "content-length": "0", [LOCAL_ROUTING_RELOAD_EXPECTED_PID_HEADER]: String(pid), [LOCAL_ROUTING_RELOAD_NONCE_HEADER]: nonce, [LOCAL_ROUTING_RELOAD_EXPIRES_AT_HEADER]: String(expires), [LOCAL_ROUTING_RELOAD_CONFIG_HASH_HEADER]: hash, [LOCAL_ROUTING_RELOAD_CAPABILITY_HEADER]: cap } });
      expect(response.status).toBe(200); return response.json() as Promise<any>;
    };
    const state = () => requestBoundLocalRoutingState(target, { readRuntime: () => ({ pid, port: server.port, hostname: "127.0.0.1", attestationSecret: secret }) });
    const waitRequest = async (index: number) => { for (let i = 0; i < 200 && requests.length <= index; i++) await Bun.sleep(10); expect(requests.length).toBeGreaterThan(index); await requests[index]!.entered; };
    try {
      const proof = await fetch(`http://127.0.0.1:${server.port}/healthz`, { headers: { [LOCAL_ATTESTATION_CHALLENGE_HEADER]: "A".repeat(43) } }); expect(proof.status).toBe(200);
      const a = call();
      const admitted = await Promise.race([a.then(async r => ({ response: r, body: await r.clone().text() })), Bun.sleep(1500).then(() => null)]);
      if (admitted) throw new Error(`lead turn rejected before upstream (${admitted.response.status}): ${admitted.body}`);
      await waitRequest(0);
      expect(requests[0]!.body.model).toBe("gpt-6-luna");
      const next = applyRoutingPreset(structuredClone(initial), "deepseek"); writeRouting(next);
      const adopted = await reload(); const observed = await state();
      expect(observed.pid).toBe(pid); expect(observed.routingPreset).toBe("deepseek"); expect(observed.routingFingerprint).toBe(adopted.routingFingerprint);
      expect(observed.routingFingerprint).toBe(buildRoutingRuntimeSnapshot(next).routingFingerprint);
      const b = call(); const bOutcome = await Promise.race([b.then(async r => ({ response: r, body: await r.clone().text() })), Bun.sleep(1500).then(() => null)]); if (bOutcome) throw new Error(`turn B rejected before upstream (${bOutcome.response.status}): ${bOutcome.body}`); await waitRequest(1); expect(requests[1]!.body.model).toBe("deepseek-flash");
      requests[0]!.release(); const ar = await a; expect(ar.status).toBe(200); await ar.arrayBuffer();
      requests[1]!.release(); const br = await b; expect(br.status).toBe(200); await br.arrayBuffer();
      writeRouting(initial); const rollback = await reload(); expect(rollback.routingFingerprint).toBe(initialSnapshot.routingFingerprint);
      const restored = await state(); expect(restored.pid).toBe(pid); expect(restored.routingFingerprint).toBe(initialSnapshot.routingFingerprint); expect(restored.routingPreset).toBe("openai");
      const c = call(); await waitRequest(2); expect(requests[2]!.body.model).toBe("gpt-6-luna"); requests[2]!.release(); const cr = await c; expect(cr.status).toBe(200); await cr.arrayBuffer();
      expect((await (await fetch(`http://127.0.0.1:${server.port}/healthz`)).json() as any).pid).toBe(pid);
    } finally {
      requests.forEach(row => row.release()); globalThis.fetch = originalFetch; await server.stop(true); await new Promise<void>(resolve => upstream.close(() => resolve())); rmSync(home, { recursive: true, force: true });
      if (previousHome === undefined) delete process.env.OPENCODEX_HOME; else process.env.OPENCODEX_HOME = previousHome;
      if (previousToken === undefined) delete process.env.OPENCODEX_API_AUTH_TOKEN; else process.env.OPENCODEX_API_AUTH_TOKEN = previousToken;
    }
  });
});

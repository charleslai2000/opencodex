import { describe, expect, test } from "bun:test";
import { createServer as createHttpServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../../src/server";
import { saveConfig } from "../../src/config";
import { applyRoutingPreset } from "../../src/routing/presets";
import { createLocalAttestationSecret, createLocalAttestationChallenge, LOCAL_ATTESTATION_CHALLENGE_HEADER } from "../../src/lib/local-management-attestation";
import { createLocalRoutingReloadCapability, LOCAL_ROUTING_RELOAD_CAPABILITY_HEADER, LOCAL_ROUTING_RELOAD_CONFIG_HASH_HEADER, LOCAL_ROUTING_RELOAD_EXPECTED_PID_HEADER, LOCAL_ROUTING_RELOAD_EXPIRES_AT_HEADER, LOCAL_ROUTING_RELOAD_METHOD, LOCAL_ROUTING_RELOAD_NONCE_HEADER, LOCAL_ROUTING_RELOAD_PATH } from "../../src/lib/local-routing-reload-contract";
import { writeRuntimePort } from "../../src/config/process-state";
import { requestBoundLocalRoutingState } from "../../src/server/local-routing-reload-client";
import type { LiveProxy } from "../../src/server/proxy-liveness";
import type { OcxConfig } from "../../src/types";

function fixture(): OcxConfig {
  return {
    port: 0, defaultProvider: "openai", apiKeys: [{ key: "test-data-key", id: "fixture", name: "fixture", createdAt: "2026-01-01T00:00:00.000Z" }], combos: {},
    providers: {
      openai: { adapter: "openai-responses", baseUrl: "https://chatgpt.com/backend-api/codex", models: ["gpt-6-luna", "gpt-6-terra", "gpt-6-sol"], authMode: "forward", codexAccountMode: "direct", liveModels: false, contextWindow: 1_000_000, reasoningEfforts: ["low", "medium", "high"], modelReasoningEfforts: { "gpt-6-luna": ["low", "medium", "high"], "gpt-6-terra": ["low", "medium", "high"] } },
      openrouter: { adapter: "openai-chat", baseUrl: "https://openrouter.ai/api/v1", apiKey: "fixture", models: ["@preset/lstack-ling-3-0-flash"], liveModels: false },
      deepseek: { adapter: "openai-chat", baseUrl: "https://api.deepseek.com", apiKey: "fixture", models: ["deepseek-flash"], liveModels: false },
    },
    clientIntegrations: { codex: false },
  } as OcxConfig;
}

describe("routing-only reload staging", () => {
  test("reload adopts one generation with exact PID, rejects invalid candidate without mutation", async () => {
    const home = mkdtempSync(join("/tmp", "ocx-routing-reload-"));
    process.env.OPENCODEX_HOME = home;
    const secret = createLocalAttestationSecret();
    const cfg = applyRoutingPreset(fixture(), "openai");
    saveConfig(cfg);
    const server = startServer(0, { localAttestationSecret: secret, skipStartupCatalogSync: true } as never);
    try {
      const pid = process.pid;
      writeRuntimePort({ pid, port: server.port, hostname: "127.0.0.1", attestationSecret: secret });
      const before = await (await fetch(`http://127.0.0.1:${server.port}/healthz`)).json() as any;
      const deepseek = applyRoutingPreset(structuredClone(cfg), "deepseek");
      saveConfig(deepseek);
      const bytes = readFileSync(join(home, "config.json"));
      const hash = createHash("sha256").update(bytes).digest("hex");
      const nonce = createLocalAttestationChallenge();
      const expires = Date.now() + 5000;
      const capability = createLocalRoutingReloadCapability(secret, nonce, LOCAL_ROUTING_RELOAD_METHOD, LOCAL_ROUTING_RELOAD_PATH, pid, server.port, expires, hash)!;
      const denied = await fetch(`http://127.0.0.1:${server.port}${LOCAL_ROUTING_RELOAD_PATH}`, { method: "POST", headers: { "content-length": "0", [LOCAL_ROUTING_RELOAD_EXPECTED_PID_HEADER]: String(pid) } });
      expect(denied.status).toBe(401);
      const response = await fetch(`http://127.0.0.1:${server.port}${LOCAL_ROUTING_RELOAD_PATH}`, { method: "POST", headers: {
        "content-length": "0", [LOCAL_ROUTING_RELOAD_EXPECTED_PID_HEADER]: String(pid), [LOCAL_ROUTING_RELOAD_NONCE_HEADER]: nonce,
        [LOCAL_ROUTING_RELOAD_EXPIRES_AT_HEADER]: String(expires), [LOCAL_ROUTING_RELOAD_CONFIG_HASH_HEADER]: hash, [LOCAL_ROUTING_RELOAD_CAPABILITY_HEADER]: capability,
      } });
      expect(response.status).toBe(200);
      const adopted = await response.json() as any;
      expect(adopted.routingPreset).toBe("deepseek");
      expect(adopted.routingFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(adopted.catalog.map((row: any) => row.id)).toEqual(["lead", "bot", "worker", "expert"]);
      expect((await (await fetch(`http://127.0.0.1:${server.port}/healthz`)).json() as any).pid).toBe(before.pid);

      const invalid = structuredClone(deepseek) as any;
      invalid.routingProfiles.lead.routes.high[0].candidates[0].upstreamEffort = "impossible";
      writeFileSync(join(home, "config.json"), JSON.stringify(invalid));
      const badBytes = readFileSync(join(home, "config.json"));
      const badHash = createHash("sha256").update(badBytes).digest("hex");
      const n2 = createLocalAttestationChallenge(); const e2 = Date.now() + 5000;
      const c2 = createLocalRoutingReloadCapability(secret, n2, LOCAL_ROUTING_RELOAD_METHOD, LOCAL_ROUTING_RELOAD_PATH, pid, server.port, e2, badHash)!;
      const rejected = await fetch(`http://127.0.0.1:${server.port}${LOCAL_ROUTING_RELOAD_PATH}`, { method: "POST", headers: {
        "content-length": "0", [LOCAL_ROUTING_RELOAD_EXPECTED_PID_HEADER]: String(pid), [LOCAL_ROUTING_RELOAD_NONCE_HEADER]: n2,
        [LOCAL_ROUTING_RELOAD_EXPIRES_AT_HEADER]: String(e2), [LOCAL_ROUTING_RELOAD_CONFIG_HASH_HEADER]: badHash, [LOCAL_ROUTING_RELOAD_CAPABILITY_HEADER]: c2,
      } });
      expect(rejected.status).toBe(409);
      const still = await rejected.json() as any;
      expect(still.routingFingerprint).toBeUndefined();
      const runtimeTarget: LiveProxy = { source: "runtime", pid, port: server.port, hostname: "127.0.0.1" } as LiveProxy;
      const afterBad = await requestBoundLocalRoutingState(runtimeTarget, {
        readRuntime: () => ({ pid, port: server.port, hostname: "127.0.0.1", attestationSecret: secret }),
      });
      expect(afterBad.routingPreset).toBe("deepseek");
      expect(afterBad.routingFingerprint).toBe(adopted.routingFingerprint);
      expect((await (await fetch(`http://127.0.0.1:${server.port}/v1/models`, { headers: { authorization: "Bearer test-data-key" } })).json() as any).data.filter((row: any) => ["lead", "bot", "worker", "expert"].includes(row.id)).length).toBe(4);
      expect((await (await fetch(`http://127.0.0.1:${server.port}/healthz`)).json() as any).pid).toBe(pid);
    } finally {
      await server.stop(true);
      rmSync(home, { recursive: true, force: true });
      delete process.env.OPENCODEX_HOME;
    }
  });
});

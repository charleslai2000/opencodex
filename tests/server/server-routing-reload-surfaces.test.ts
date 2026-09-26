import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../../src/server";
import { saveConfig } from "../../src/config";
import { saveCodexAccountCredential } from "../../src/codex/account-store";
import { applyRoutingPreset } from "../../src/routing/presets";
import { createLocalAttestationSecret, createLocalAttestationChallenge } from "../../src/lib/local-management-attestation";
import { createLocalRoutingReloadCapability, LOCAL_ROUTING_RELOAD_CAPABILITY_HEADER, LOCAL_ROUTING_RELOAD_CONFIG_HASH_HEADER, LOCAL_ROUTING_RELOAD_EXPECTED_PID_HEADER, LOCAL_ROUTING_RELOAD_EXPIRES_AT_HEADER, LOCAL_ROUTING_RELOAD_METHOD, LOCAL_ROUTING_RELOAD_NONCE_HEADER, LOCAL_ROUTING_RELOAD_PATH } from "../../src/lib/local-routing-reload-contract";
import { writeRuntimePort } from "../../src/config/process-state";
import { encodeCompactionSummary } from "../../src/responses/compaction";
import type { OcxConfig } from "../../src/types";

/**
 * A preset switch is a routing-only reload: the running process adopts
 * `routingPreset`/`routingProfiles` without a restart, so every admitted turn has
 * to resolve models against the generation it was admitted under rather than the
 * config the process booted with.
 *
 * `server-routing-inflight-e2e.test.ts` covers `/v1/responses`. An operator
 * hot-switching `openai` -> `deepseek` on the formal service kept recording the
 * PREVIOUS preset's profile revision in the usage ledger for
 * `/v1/chat/completions` (Pi) until the service was restarted, so the remaining
 * client surfaces are pinned here: the assertion is the model the route actually
 * sent upstream, because a stale generation is otherwise invisible — the switch
 * verifies its own snapshot and reports success while live traffic keeps routing
 * on the old preset.
 */

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

/** One request shape per client surface; each carries the effort the preset matrix requires. */
const surfaces = [
  { surface: "chat completions (Pi)", path: "/v1/chat/completions", body: { model: "policy/lead", messages: [{ role: "user", content: "hi" }], stream: false, reasoning_effort: "low" } },
  { surface: "messages (Claude Code)", path: "/v1/messages", body: { model: "policy/lead", max_tokens: 16, messages: [{ role: "user", content: "hi" }], stream: false, thinking: { type: "enabled", budget_tokens: 1024 } } },
  { surface: "responses/compact", path: "/v1/responses/compact", body: { model: "policy/lead", input: "hi", reasoning: { effort: "low" } } },
] as const;

describe("a preset reload reaches every admitted client surface", () => {
  test("chat, messages, and compact route with the adopted preset without a restart", async () => {
    const home = mkdtempSync(join("/tmp", "ocx-routing-surfaces-"));
    writeFileSync(join(home, "admin-api-token"), "ocx_admin_" + "A".repeat(43));
    const previousHome = process.env.OPENCODEX_HOME; const previousToken = process.env.OPENCODEX_API_AUTH_TOKEN;
    process.env.OPENCODEX_HOME = home; process.env.OPENCODEX_API_AUTH_TOKEN = "fixture-key";
    const secret = createLocalAttestationSecret();
    const initial = applyRoutingPreset(fixture(), "openai");
    saveConfig(initial);
    const calls: Array<{ path: string; model: string }> = [];
    const upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>; } catch { /* a body without JSON carries no model */ }
      const path = new URL(req.url ?? "/", "http://upstream").pathname;
      calls.push({ path, model: typeof body.model === "string" ? body.model : "" });
      const json = (payload: unknown, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      // Force the routed compaction fallback: the native compact endpoint is not under test.
      if (path.endsWith("/responses/compact")) return json({ error: { message: "no native compact here" } }, 404);
      if (path.endsWith("/chat/completions")) {
        return json({ id: "chatcmpl-fixture", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      }
      const envelope = {
        id: "resp-fixture", object: "response", status: "completed", model: body.model,
        // Routed compaction needs exactly one compaction item; the other surfaces ignore it.
        output: [{ type: "compaction", encrypted_content: encodeCompactionSummary("fixture summary") }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      };
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(`event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: envelope })}\n\n`);
        return;
      }
      return json(envelope);
    });
    await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as any).port;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
      if (url.startsWith("https://chatgpt.com/backend-api/codex") || url.startsWith("https://api.deepseek.com")) {
        return originalFetch(`http://127.0.0.1:${upstreamPort}${new URL(url).pathname.replace("/backend-api/codex", "")}`, init);
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    saveCodexAccountCredential("pool-a", { accessToken: "fixture-access-token", refreshToken: "fixture-refresh-token", expiresAt: Date.now() + 600_000, chatgptAccountId: "acct-pool-a" });
    saveConfig(structuredClone(initial));
    const server = startServer(0, { localAttestationSecret: secret, skipStartupCatalogSync: true } as never);
    const pid = process.pid;
    writeRuntimePort({ pid, port: server.port, hostname: "127.0.0.1", attestationSecret: secret });
    /** Models the fake provider saw for routed turns, oldest first. */
    const models = () => calls.filter(call => call.path.endsWith("/chat/completions") || call.path.endsWith("/responses")).map(call => call.model);
    try {
      const call = (path: string, body: unknown) => fetch(`http://127.0.0.1:${server.port}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-opencodex-api-key": "fixture-key" },
        body: JSON.stringify(body),
      });
      /** Persist and adopt one routing generation, exactly as `switch-codex` does. */
      const reloadTo = async (config: OcxConfig) => {
        saveConfig(config);
        const bytes = readFileSync(join(home, "config.json"));
        const hash = createHash("sha256").update(bytes).digest("hex");
        const nonce = createLocalAttestationChallenge(); const expires = Date.now() + 5000;
        const capability = createLocalRoutingReloadCapability(secret, nonce, LOCAL_ROUTING_RELOAD_METHOD, LOCAL_ROUTING_RELOAD_PATH, pid, server.port, expires, hash)!;
        const reload = await fetch(`http://127.0.0.1:${server.port}${LOCAL_ROUTING_RELOAD_PATH}`, { method: "POST", headers: {
          "content-length": "0", [LOCAL_ROUTING_RELOAD_EXPECTED_PID_HEADER]: String(pid), [LOCAL_ROUTING_RELOAD_NONCE_HEADER]: nonce,
          [LOCAL_ROUTING_RELOAD_EXPIRES_AT_HEADER]: String(expires), [LOCAL_ROUTING_RELOAD_CONFIG_HASH_HEADER]: hash, [LOCAL_ROUTING_RELOAD_CAPABILITY_HEADER]: capability,
        } });
        expect(reload.status).toBe(200);
        return ((await reload.json()) as { routingPreset: string | null }).routingPreset;
      };
      for (const { surface, path, body } of surfaces) {
        // Start every surface from a known generation; a previous iteration left deepseek running.
        expect(await reloadTo(structuredClone(initial))).toBe("openai");
        calls.length = 0;
        await call(path, body);
        expect({ surface, models: models() }).toEqual({ surface, models: ["gpt-6-luna"] });

        expect(await reloadTo(applyRoutingPreset(structuredClone(initial), "deepseek"))).toBe("deepseek");
        calls.length = 0;
        await call(path, body);
        expect({ surface, models: models() }).toEqual({ surface, models: ["deepseek-flash"] });
      }
    } finally {
      globalThis.fetch = originalFetch;
      await server.stop(true);
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      rmSync(home, { recursive: true, force: true });
      if (previousHome === undefined) delete process.env.OPENCODEX_HOME; else process.env.OPENCODEX_HOME = previousHome;
      if (previousToken === undefined) delete process.env.OPENCODEX_API_AUTH_TOKEN; else process.env.OPENCODEX_API_AUTH_TOKEN = previousToken;
    }
  }, 30_000);
});

import { afterEach, describe, expect, test } from "bun:test";
import { applyRoutingPreset } from "../../src/routing/presets";
import { handleResponses } from "../../src/server/responses/policy-fallback";
import type { OcxConfig, OcxProviderConfig } from "../../src/types";
import { clearPolicyAffinity } from "../../src/routing/session-affinity";

const originalFetch = globalThis.fetch;

type Call = { provider: string; model: string; effort: string | undefined; sequence: number };
let calls: Call[];
let sequence: number;
let failed: Set<string>;

function response(model: string): Response {
  return Response.json({
    id: "preset-e2e-response",
    object: "response",
    model,
    status: "completed",
    output: [{ type: "message", id: "preset-e2e-message", role: "assistant", content: [{ type: "output_text", text: "ROUTE_OK", annotations: [] }] }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  });
}

function transport(provider: string): typeof fetch {
  return (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { model?: string; reasoning?: { effort?: string } };
    const model = String(body.model ?? "");
    const effort = body.reasoning?.effort ?? (typeof (body as Record<string, unknown>).reasoning_effort === "string" ? String((body as Record<string, unknown>).reasoning_effort) : undefined);
    calls.push({ provider, model, effort, sequence: ++sequence });
    if (failed.has(`${provider}/${model}`)) return Response.json({ error: { type: "rate_limit_error", code: "rate_limit_exceeded", message: "qualification hard failure" } }, { status: 429, headers: { "retry-after": "0" } });
    return response(model);
  }) as typeof fetch;
}

function provider(provider: string, models: string[]): OcxProviderConfig {
  return {
    adapter: "openai-responses",
    baseUrl: `https://${provider}.qualification.invalid/v1`,
    apiKey: "fixture",
    models,
    liveModels: false,
    contextWindow: 1_000_000,
    maxOutputTokens: 256_000,
    reasoningEfforts: provider.startsWith("deepseek") ? ["low", "high", "max"] : ["low", "medium", "high"],
    modelReasoningEfforts: Object.fromEntries(models.map(model => [model, provider.startsWith("deepseek") ? ["low", "high", "max"] : ["low", "medium", "high"]])),
    fetch: transport(provider),
  };
}

function config(): OcxConfig {
  return {
    port: 0,
    defaultProvider: "deepseek",
    providers: {
      openai: provider("openai", ["gpt-5.6-luna", "gpt-5.6-terra"]),
      deepseek: provider("deepseek", ["deepseek-flash"]),
      "deepseek-worker": provider("deepseek-worker", ["deepseek-flash"]),
      openrouter: provider("openrouter", ["@preset/lstack-ling-3-0-flash"]),
    },
    apiKeys: [{ id: "qualification", name: "qualification", key: "qualification", createdAt: new Date().toISOString() }],
    clientIntegrations: { codex: false },
  };
}

async function request(cfg: OcxConfig, logical: string, effort: string): Promise<Call> {
  const before = calls.length;
  const result = await handleResponses(new Request("http://localhost/v1/responses", {
    method: "POST",
    headers: { authorization: "Bearer qualification", "x-opencodex-api-key": "qualification", "content-type": "application/json", "session-id": "provider-fetch-session" },
    body: JSON.stringify({ model: `policy/${logical}`, input: "Return exactly ROUTE_OK", reasoning: { effort }, stream: false }),
  }), cfg, { model: "", provider: "" }, { admission: { kind: "configured", keyId: "qualification", source: "dedicated", contextPrincipalId: "qualification-principal", routingPlacementPrincipalId: "qualification-placement" } });
  expect(result.status, await result.clone().text()).toBe(200);
  const call = calls.slice(before).at(-1);
  expect(call).toBeDefined();
  return call!;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  calls = [];
  sequence = 0;
  failed = new Set();
  clearPolicyAffinity();
});

describe("canonical provider-id preset FULL_E2E through provider.fetch", () => {
  test("DeepSeek 9 cells preserve exact provider/model/upstream and wire effort", async () => {
    calls = []; sequence = 0; failed = new Set(); clearPolicyAffinity();
    const cfg = applyRoutingPreset(config(), "deepseek");
    const expected: Record<string, Record<string, [string, string, string]>> = {
      lead: { low: ["deepseek", "deepseek-flash", "low"], medium: ["deepseek", "deepseek-flash", "high"], high: ["deepseek", "deepseek-flash", "max"] },
      worker: { low: ["deepseek", "deepseek-flash", "low"], medium: ["deepseek", "deepseek-flash", "low"], high: ["deepseek", "deepseek-flash", "high"] },
      expert: { low: ["deepseek", "deepseek-flash", "high"], medium: ["deepseek", "deepseek-flash", "high"], high: ["deepseek", "deepseek-flash", "high"] },
    };
    for (const [logical, efforts] of Object.entries(expected)) for (const effort of ["low", "medium", "high"]) {
      const call = await request(cfg, logical, effort);
      expect(call).toMatchObject({ provider: efforts[effort]![0], model: efforts[effort]![1], effort: efforts[effort]![2] });
    }
    expect(calls).toHaveLength(9);
  });

  test("bot primary is Ling, then ordered fallback is DeepSeek with effort mapping", async () => {
    calls = []; sequence = 0; failed = new Set(); clearPolicyAffinity();
    const cfg = applyRoutingPreset(config(), "deepseek");
    for (const effort of ["low", "medium", "high"]) {
      const call = await request(cfg, "bot", effort);
      expect(call).toMatchObject({ provider: "openrouter", model: "@preset/lstack-ling-3-0-flash", effort });
    }
    expect(calls.map(call => call.provider)).toEqual(["openrouter", "openrouter", "openrouter"]);

    failed = new Set(["openrouter/@preset/lstack-ling-3-0-flash"]);
    for (const effort of ["low", "medium", "high"]) {
      const before = calls.length;
      const call = await request(cfg, "bot", effort);
      const attempts = calls.slice(before);
      expect(attempts[0]).toMatchObject({ provider: "openrouter", model: "@preset/lstack-ling-3-0-flash" });
      expect(call).toMatchObject({ provider: "deepseek", model: "deepseek-flash", effort: effort === "low" ? "low" : "high" });
      expect(attempts.at(-1)).toEqual(call);
    }
  });

  test("bot fallback commits affinity and remains effort-scoped after Ling recovers", async () => {
    calls = []; sequence = 0; failed = new Set(["openrouter/@preset/lstack-ling-3-0-flash"]); clearPolicyAffinity();
    const cfg = applyRoutingPreset(config(), "deepseek");
    const first = await request(cfg, "bot", "medium");
    expect(first).toMatchObject({ provider: "deepseek", model: "deepseek-flash", effort: "high" });
    failed = new Set();
    const mediumHit = await request(cfg, "bot", "medium");
    expect(mediumHit).toMatchObject({ provider: first.provider, model: first.model, effort: first.effort });
    const mediumAttempts = calls.slice(2);
    expect(mediumAttempts).toHaveLength(1);
    const low = await request(cfg, "bot", "low");
    expect(low).toMatchObject({ provider: "openrouter", model: "@preset/lstack-ling-3-0-flash", effort: "low" });
  });
});

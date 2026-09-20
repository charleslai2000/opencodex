import { afterEach, describe, expect, test } from "bun:test";
import { applyRoutingPreset } from "../../src/routing/presets";
import { handleResponses } from "../../src/server/responses/core";
import type { OcxConfig } from "../../src/types";
import { fakeChatGptJwt } from "../helpers/fake-chatgpt-jwt";

const originalFetch = globalThis.fetch;
const canonicalUrl = "https://chatgpt.com/backend-api/codex";

function baseConfig(): OcxConfig {
  return {
    port: 0,
    defaultProvider: "openai",
    providers: {
      openai: {
        adapter: "openai-responses",
        baseUrl: canonicalUrl,
        authMode: "forward",
        codexAccountMode: "direct",
        models: ["gpt-5.6-luna", "gpt-5.6-terra"],
        liveModels: false,
        contextWindow: 1_000_000,
        reasoningEfforts: ["low", "medium", "high"],
        modelReasoningEfforts: {
          "gpt-5.6-luna": ["low", "medium", "high"],
          "gpt-5.6-terra": ["low", "medium", "high"],
        },
      },
      deepseek: { adapter: "openai-chat", baseUrl: "https://deepseek.test/v1", apiKey: "fixture" },
      "deepseek-worker": { adapter: "openai-chat", baseUrl: "https://deepseek-worker.test/v1", apiKey: "fixture" },
      openrouter: { adapter: "openai-chat", baseUrl: "https://openrouter.test/v1", apiKey: "fixture" },
    },
    clientIntegrations: { codex: false },
  };
}

function response(model: string): Response {
  return Response.json({
    id: "route-preauth-response",
    object: "response",
    model,
    status: "completed",
    output: [{ type: "message", id: "message", role: "assistant", content: [{ type: "output_text", text: "ROUTE_OK", annotations: [] }] }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  });
}

type Capture = { model: string; effort: string | undefined; authorization: string | null };

async function request(config: OcxConfig, logical: string, effort: string): Promise<Capture> {
  let capture: Capture | undefined;
  globalThis.fetch = (async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(canonicalUrl)) throw new Error(`unexpected route-preauth destination: ${url}`);
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body)) as { model?: string; reasoning?: { effort?: string } };
    capture = { model: String(body.model), effort: body.reasoning?.effort, authorization: headers.get("authorization") };
    return response(String(body.model));
  }) as typeof fetch;
  const result = await handleResponses(new Request("http://localhost/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${fakeChatGptJwt({ chatgpt_account_id: "synthetic-account", email: "route-test@example.test" })}`, "chatgpt-account-id": "synthetic-account", "content-type": "application/json" },
    body: JSON.stringify({ model: `policy/${logical}`, input: "Return exactly ROUTE_OK", reasoning: { effort }, stream: false }),
  }), config, { model: "", provider: "" });
  expect(result.status, await result.clone().text()).toBe(200);
  expect(capture).toBeDefined();
  return capture!;
}

afterEach(() => { globalThis.fetch = originalFetch; });

describe("frozen OpenAI preset route-preauth qualification", () => {
  const expected: Record<string, Record<string, [string, string]>> = {
    lead: { low: ["gpt-5.6-luna", "low"], medium: ["gpt-5.6-luna", "medium"], high: ["gpt-5.6-luna", "high"] },
    worker: { low: ["gpt-5.6-luna", "low"], medium: ["gpt-5.6-luna", "medium"], high: ["gpt-5.6-luna", "high"] },
    expert: { low: ["gpt-5.6-luna", "high"], medium: ["gpt-5.6-terra", "medium"], high: ["gpt-5.6-terra", "high"] },
    bot: { low: ["gpt-5.6-luna", "low"], medium: ["gpt-5.6-luna", "medium"], high: ["gpt-5.6-luna", "high"] },
  };

  for (const logical of ["lead", "worker", "expert"]) for (const effort of ["low", "medium", "high"]) {
    test(`${logical}/${effort} is canonical openai ROUTE_PREAUTH`, async () => {
      const result = await request(applyRoutingPreset(baseConfig(), "openai"), logical, effort);
      const [model, wireEffort] = expected[logical]![effort]!;
      expect(result).toMatchObject({ model, effort: wireEffort, authorization: `Bearer ${fakeChatGptJwt({ chatgpt_account_id: "synthetic-account", email: "route-test@example.test" })}` });
    });
  }
});

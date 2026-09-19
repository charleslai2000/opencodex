import { afterEach, describe, expect, test } from "bun:test";
import { evidenceFromBody } from "../../src/routing/request-evidence";
import { getOrAllocateRequestSessionLane, normalizeLogConversationId } from "../../src/server/request-log-conversation";
import { clearPolicyAffinity, policyAffinityKey, rememberPolicyAffinity, lookupPolicyAffinity } from "../../src/routing/session-affinity";
import { routeModel } from "../../src/router";
import type { OcxConfig } from "../../src/types";

function piConfig(): OcxConfig {
  const providers = Object.fromEntries(["v100-0", "v100-1", "v100-2", "v100-3"].map(provider => [provider, {
    adapter: "openai-chat",
    baseUrl: `https://${provider}.example/v1`,
    apiKey: provider,
    models: ["qwen"],
    reasoningEfforts: ["low", "medium"],
    modelContextWindows: { qwen: 128_000 },
    modelInputModalities: { qwen: ["text", "image"] },
  }]));
  return {
    port: 10100,
    defaultProvider: "v100-0",
    providers,
    routingProfiles: {
      coder: {
        candidates: ["v100-0", "v100-1", "v100-2", "v100-3"].map(provider => ({
          provider, model: "qwen", efforts: ["low", "medium"], replicaGroup: "v100-qwen",
        })),
        unknownEvidence: { capability: "allow", health: "allow", quota: "allow", cost: "allow" },
      },
    },
  } as OcxConfig;
}

afterEach(() => clearPolicyAffinity());

describe("Pi -> OpenCodex Responses compatibility gate", () => {
  test("Pi openai Responses request exposes policy model and reasoning effort", () => {
    const body = {
      model: "policy/coder",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
      reasoning: { effort: "medium" },
      prompt_cache_key: "pi-session-abc",
    };
    const evidence = evidenceFromBody(body, body.reasoning.effort);
    expect(body.model).toBe("policy/coder");
    expect(evidence.reasoningEffort).toBe("medium");
  });

  test.each(["session_id", "session-id"] as const)("Pi %s header is an OpenCodex session lane", headerName => {
    const req = new Request("http://localhost/v1/responses", {
      headers: { [headerName]: "pi-session-abc" },
    });
    expect(getOrAllocateRequestSessionLane(req)).toBe(normalizeLogConversationId("pi-session-abc"));
  });

  test("minimal must be mapped or exposed explicitly; it is not implicitly low", () => {
    const config = piConfig();
    expect(() => routeModel(config, "policy/coder", { reasoningEffort: "minimal" }, {
      principal: "pi-principal",
      sessionLane: "minimal-session",
    })).toThrow();
  });

  test("same Pi session and profile reuses the committed concrete target", () => {
    const config = piConfig();
    const firstReq = new Request("http://localhost/v1/responses", { headers: { "session-id": "pi-session-abc" } });
    const lane = getOrAllocateRequestSessionLane(firstReq);
    const first = routeModel(config, "policy/coder", { reasoningEffort: "medium" }, {
      principal: "pi-principal",
      sessionLane: lane,
    });
    const key = policyAffinityKey("pi-principal", "coder", lane)!;
    rememberPolicyAffinity(key, { provider: first.providerName, model: first.modelId });

    const secondReq = new Request("http://localhost/v1/responses", { headers: { session_id: "pi-session-abc" } });
    const second = routeModel(config, "policy/coder", { reasoningEffort: "medium" }, {
      principal: "pi-principal",
      sessionLane: getOrAllocateRequestSessionLane(secondReq),
    });
    expect(lookupPolicyAffinity(key)).toEqual({ provider: first.providerName, model: first.modelId });
    expect(second.providerName).toBe(first.providerName);
    expect(second.modelId).toBe(first.modelId);
    expect(second.routeReason).toBe("affinity-hit");
  });
});

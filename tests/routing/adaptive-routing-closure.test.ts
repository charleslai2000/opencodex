import { afterEach, describe, expect, test } from "bun:test";
import { evaluatePolicyProfile, type PolicyCandidateEvidence } from "../../src/routing/evaluator";
import { evidenceFromBody } from "../../src/routing/request-evidence";
import { clearPolicyAffinity, lookupPolicyAffinity, policyAffinityKey, rememberPolicyAffinity } from "../../src/routing/session-affinity";
import { getRoutingProfile } from "../../src/routing/profile";
import { routeModel } from "../../src/router";
import type { OcxConfig } from "../../src/types";

const replicaNames = ["v100-0", "v100-1", "v100-2", "v100-3"] as const;

type CandidateSpec = { provider: string; model: string; efforts: string[]; replicaGroup?: string };

function coderConfig(overrides: { disabled?: string; removed?: string } = {}): OcxConfig {
  const candidates: CandidateSpec[] = [
    ...replicaNames
      .filter(provider => provider !== overrides.removed)
      .map(provider => ({ provider, model: "qwen", efforts: ["low", "medium"], replicaGroup: "v100-qwen" })),
    { provider: "strong-local", model: "strong-model", efforts: ["high"] },
    { provider: "frontier", model: "frontier-model", efforts: ["xhigh"] },
  ];
  const providers = Object.fromEntries([
    ...replicaNames.map(provider => [provider, {
      adapter: "openai-chat",
      baseUrl: `https://${provider}.example/v1`,
      apiKey: provider,
      models: ["qwen"],
      reasoningEfforts: ["low", "medium", "high", "xhigh"],
      modelContextWindows: { qwen: 128_000 },
      modelInputModalities: { qwen: ["text"] },
      ...(overrides.disabled === provider ? { disabled: true } : {}),
    }]),
    ["strong-local", {
      adapter: "openai-chat", baseUrl: "https://strong.example/v1", apiKey: "strong",
      models: ["strong-model"], reasoningEfforts: ["high"], modelContextWindows: { "strong-model": 256_000 },
      modelInputModalities: { "strong-model": ["text"] },
    }],
    ["frontier", {
      adapter: "openai-chat", baseUrl: "https://frontier.example/v1", apiKey: "frontier",
      models: ["frontier-model"], reasoningEfforts: ["xhigh"], modelContextWindows: { "frontier-model": 512_000 },
      modelInputModalities: { "frontier-model": ["text"] },
    }],
  ]);
  return {
    port: 10100,
    defaultProvider: "v100-0",
    providers,
    routingProfiles: {
      coder: {
        candidates,
        unknownEvidence: { capability: "allow", health: "allow", quota: "allow", cost: "allow" },
      },
    },
  } as OcxConfig;
}

function route(config: OcxConfig, effort: string, lane: string) {
  return routeModel(config, "policy/coder", { reasoningEffort: effort }, {
    principal: "integration-principal",
    sessionLane: lane,
  });
}

function candidateEvidence(config: OcxConfig, profileId = "coder"): PolicyCandidateEvidence[] {
  const profile = getRoutingProfile(config, profileId)!;
  return profile.candidates.map(candidate => ({
    provider: candidate.provider,
    model: candidate.model,
    capability: { reasoningEfforts: config.providers[candidate.provider]?.reasoningEfforts, contextWindow: 128_000, tools: true, image: false },
    health: { successRate: 1, sampleCount: 1 },
  }));
}

afterEach(() => clearPolicyAffinity());

describe("Adaptive Routing V1 closure", () => {
  test("effort tiers select the intended backend class", () => {
    const config = coderConfig();
    for (const effort of ["low", "medium"] as const) {
      const selected = route(config, effort, `tier-${effort}`);
      expect(replicaNames).toContain(selected.providerName);
      expect(selected.routeDecision?.selected.reason).toBe("replica-hrw");
    }
    expect(route(config, "high", "tier-high").providerName).toBe("strong-local");
    expect(route(config, "xhigh", "tier-xhigh").providerName).toBe("frontier");
  });

  test("64 independent sessions distribute across all V100 replicas", () => {
    const config = coderConfig();
    const placements = new Set<string>();
    for (let i = 0; i < 64; i++) placements.add(route(config, "medium", `session-${i}`).providerName);
    expect([...placements].every(provider => replicaNames.includes(provider as typeof replicaNames[number]))).toBe(true);
    expect(placements.size).toBe(4);
  });

  test("successful bind makes twenty later turns sticky despite normal score changes", () => {
    const config = coderConfig();
    const first = route(config, "medium", "sticky-session");
    const key = policyAffinityKey("integration-principal", "coder", "sticky-session")!;
    rememberPolicyAffinity(key, { provider: first.providerName, model: first.modelId });
    for (let i = 0; i < 20; i++) {
      const next = route(config, "medium", "sticky-session");
      expect(next.providerName).toBe(first.providerName);
      expect(next.modelId).toBe(first.modelId);
      expect(next.routeReason).toBe("affinity-hit");
    }
  });

  test("effort change invalidates V100 and rebinds to strong, then lowering effort invalidates it again", () => {
    const config = coderConfig();
    const key = policyAffinityKey("integration-principal", "coder", "effort-session")!;
    const v100 = route(config, "medium", "effort-session");
    rememberPolicyAffinity(key, { provider: v100.providerName, model: v100.modelId });
    const high = route(config, "high", "effort-session");
    expect(high.providerName).toBe("strong-local");
    expect(high.routeReason).toBe("affinity-invalidated");
    rememberPolicyAffinity(key, { provider: high.providerName, model: high.modelId });
    const medium = route(config, "medium", "effort-session");
    expect(medium.providerName).toBe("v100-" + medium.providerName.slice(5));
    expect(replicaNames).toContain(medium.providerName);
    expect(medium.routeReason).toBe("affinity-invalidated");
  });

  test("disabled bound replica invalidates and remaining replicas replace it", () => {
    const initial = coderConfig();
    const first = route(initial, "medium", "disabled-session");
    const key = policyAffinityKey("integration-principal", "coder", "disabled-session")!;
    rememberPolicyAffinity(key, { provider: first.providerName, model: first.modelId });
    const disabled = coderConfig({ disabled: first.providerName });
    const next = route(disabled, "medium", "disabled-session");
    expect(next.routeReason).toBe("affinity-invalidated");
    expect(next.providerName).not.toBe(first.providerName);
    expect(replicaNames).toContain(next.providerName);
  });

  test("Responses and Chat evidence agree on effort and image/tool facts", () => {
    const responses = evidenceFromBody({ instructions: "system", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }, { type: "input_image", image_url: "https://img" }] }], tools: [{ type: "function", name: "x" }], reasoning: { effort: "medium" } });
    const chat = evidenceFromBody({ messages: [{ role: "system", content: "system" }, { role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "https://img" } }] }], tools: [{ type: "function", function: { name: "x" } }], reasoning_effort: "medium" });
    expect(responses).toEqual({ toolsRequired: true, imageInputRequired: true, reasoningEffort: "medium" });
    expect(chat).toEqual({ toolsRequired: true, imageInputRequired: true, reasoningEffort: "medium" });
    const responsesRoute = route(coderConfig(), "medium", "same-ingress-session");
    clearPolicyAffinity();
    const chatRoute = route(coderConfig(), "medium", "same-ingress-session");
    expect(responsesRoute.providerName).toBe(chatRoute.providerName);
  });

  test("clearing the in-memory store models restart and HRW deterministically recovers placement", () => {
    const config = coderConfig();
    const first = route(config, "medium", "restart-session");
    const key = policyAffinityKey("integration-principal", "coder", "restart-session")!;
    rememberPolicyAffinity(key, { provider: first.providerName, model: first.modelId });
    expect(lookupPolicyAffinity(key)).toEqual({ provider: first.providerName, model: first.modelId });
    clearPolicyAffinity();
    expect(lookupPolicyAffinity(key)).toBeUndefined();
    const afterRestart = route(config, "medium", "restart-session");
    expect(afterRestart.providerName).toBe(first.providerName);
    expect(afterRestart.routeReason).toBe("replica-hrw");
  });

  test("removing a bound replica invalidates it; remaining membership still places", () => {
    const initial = coderConfig();
    const first = route(initial, "medium", "membership-session");
    const key = policyAffinityKey("integration-principal", "coder", "membership-session")!;
    rememberPolicyAffinity(key, { provider: first.providerName, model: first.modelId });
    const removed = coderConfig({ removed: first.providerName });
    const next = route(removed, "medium", "membership-session");
    expect(next.routeReason).toBe("affinity-invalidated");
    expect(next.providerName).not.toBe(first.providerName);
  });

  test("direct evaluator path retains fallback/eligibility semantics and observability reasons", () => {
    const config = coderConfig();
    const result = evaluatePolicyProfile(config, "coder", { reasoningEffort: "medium" }, candidateEvidence(config), Date.now(), undefined, undefined, "principal\u0000coder\u0000evaluator-session");
    expect(result.trace.selected.reason).toBe("replica-hrw");
    expect(result.trace.selected.tieBreak).toBe("replica-hrw");
    expect(result.candidates.find(candidate => candidate.provider === "strong-local")?.eligible).toBe(false);
  });
});

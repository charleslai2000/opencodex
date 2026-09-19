import { afterEach, describe, expect, test } from "bun:test";
import { evaluatePolicyProfile, type PolicyCandidateEvidence } from "../../src/routing/evaluator";
import { clearPolicyAffinity, forgetPolicyAffinity, lookupPolicyAffinity, policyAffinityKey, rememberPolicyAffinity } from "../../src/routing/session-affinity";
import { routeModel } from "../../src/router";
import { getRoutingProfile, routingProfileIssues } from "../../src/routing/profile";
import { chooseReplicaByHrw } from "../../src/routing/replica-placement";
import type { OcxConfig } from "../../src/types";

function config(): OcxConfig {
  return {
    port: 10100,
    defaultProvider: "a",
    providers: {
      a: { adapter: "openai-chat", baseUrl: "https://a.example/v1", apiKey: "a", models: ["m1"], modelContextWindows: { m1: 1000 }, modelInputModalities: { m1: ["text"] } },
      b: { adapter: "openai-chat", baseUrl: "https://b.example/v1", apiKey: "b", models: ["m2"], modelContextWindows: { m2: 1000 }, modelInputModalities: { m2: ["text"] } },
    },
    routingProfiles: { sticky: {
      candidates: [{ provider: "a", model: "m1" }, { provider: "b", model: "m2" }],
      unknownEvidence: { capability: "allow", health: "allow", quota: "allow", cost: "allow" },
    } },
  };
}

const evidence = (provider: string, model: string, cooldownUntilMs?: number): PolicyCandidateEvidence => ({
  provider,
  model,
  capability: { contextWindow: 1000, image: false, tools: true },
  health: cooldownUntilMs === undefined ? { successRate: 1, sampleCount: 1 } : { cooldownUntilMs },
});

afterEach(() => clearPolicyAffinity());

function fourCandidatePlacementConfig(replicaGroup?: string): OcxConfig {
  const providers = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [
    `v${index}`,
    {
      adapter: "openai-chat" as const,
      baseUrl: `https://v${index}.example/v1`,
      apiKey: `v${index}`,
      models: ["qwen"],
      modelContextWindows: { qwen: 1000 },
      modelInputModalities: { qwen: ["text"] },
    },
  ]));
  return {
    port: 10100,
    defaultProvider: "v0",
    providers,
    routingProfiles: {
      placement: {
        candidates: Array.from({ length: 4 }, (_, index) => ({
          provider: `v${index}`,
          model: "qwen",
          ...(replicaGroup ? { replicaGroup } : {}),
        })),
        unknownEvidence: { capability: "allow", health: "allow", quota: "allow", cost: "allow" },
      },
    },
  };
}

describe("policy session affinity", () => {
  test("baseline: declaration-order priority sends every new unbound session to the first candidate", () => {
    const placements = new Set<string>();
    for (let index = 0; index < 32; index++) {
      const route = routeModel(
        fourCandidatePlacementConfig(),
        "policy/placement",
        {},
        { principal: "principal-a", sessionLane: `new-session-${index}` },
      );
      placements.add(`${route.providerName}/${route.modelId}`);
      expect(route.routeReason).toBe("policy-selected");
    }
    expect(placements).toEqual(new Set(["v0/qwen"]));
  });

  test("same replica group distributes new sessions and remains deterministic", () => {
    const placement = (lane: string, cfg = fourCandidatePlacementConfig("v100-qwen")) => routeModel(
      cfg,
      "policy/placement",
      {},
      { principal: "principal-a", sessionLane: lane },
    );
    const placements = new Set<string>();
    for (let index = 0; index < 512; index++) {
      const first = placement(`hrw-${index}`);
      const second = placement(`hrw-${index}`);
      expect(`${first.providerName}/${first.modelId}`).toBe(`${second.providerName}/${second.modelId}`);
      expect(first.routeReason).toBe("replica-hrw");
      placements.add(`${first.providerName}/${first.modelId}`);
    }
    expect(placements.size).toBe(4);
  });

  test("replica placement stays inside the winner group and respects hard exclusions", () => {
    const cfg = fourCandidatePlacementConfig("v100-qwen");
    cfg.routingProfiles!.placement.candidates.push({ provider: "a", model: "m1", replicaGroup: "stronger" });
    const route = routeModel(cfg, "policy/placement", {}, { principal: "p", sessionLane: "group-boundary" });
    expect(route.providerName.startsWith("v")).toBe(true);
    expect(route.routeDecision?.selected.reason).toBe("replica-hrw");

    const excluded = fourCandidatePlacementConfig("v100-qwen");
    excluded.providers.v0!.disabled = true;
    const excludedRoute = routeModel(excluded, "policy/placement", {}, { principal: "p", sessionLane: "hard-exclusion" });
    expect(excludedRoute.providerName).not.toBe("v0");
  });

  test("HRW has deterministic minimal remap when one replica is removed", () => {
    const all = Array.from({ length: 4 }, (_, index) => ({ provider: `v${index}`, model: "qwen" }));
    const withoutLast = all.slice(0, 3);
    const before = new Map<string, string>();
    for (let index = 0; index < 512; index++) {
      const key = `remap-${index}`;
      before.set(key, `${chooseReplicaByHrw(key, all)!.provider}`);
    }
    let preserved = 0;
    for (const [key, target] of before) {
      if (target !== "v3" && `${chooseReplicaByHrw(key, withoutLast)!.provider}` === target) preserved++;
    }
    expect(preserved).toBeGreaterThan(0);
  });

  test("replicaGroup participates in normalization and revision, while ungrouped profiles stay legacy", () => {
    const grouped = fourCandidatePlacementConfig("  v100-qwen  ");
    const normalized = getRoutingProfile(grouped, "placement")!;
    expect(normalized.candidates[0]!.replicaGroup).toBe("v100-qwen");
    const legacy = getRoutingProfile(fourCandidatePlacementConfig(), "placement")!;
    expect(legacy.candidates[0]!.replicaGroup).toBeUndefined();
    expect(normalized.revision).not.toBe(legacy.revision);
    const invalid = fourCandidatePlacementConfig();
    invalid.routingProfiles!.placement.candidates[0]!.replicaGroup = "   ";
    expect(routingProfileIssues("placement", invalid.routingProfiles!.placement, invalid)).toContainEqual({
      path: ["candidates", 0, "replicaGroup"],
      message: "replicaGroup must be a non-empty string",
    });
  });

  test("initial bind and sticky selection outrank ordinary score", () => {
    const key = policyAffinityKey("principal-a", "sticky", "lane-a")!;
    rememberPolicyAffinity(key, { provider: "a", model: "m1" });
    const route = routeModel(config(), "policy/sticky", {}, { principal: "principal-a", sessionLane: "lane-a" });
    expect(route.providerName).toBe("a");
    expect(route.modelId).toBe("m1");
    expect(route.routeReason).toBe("affinity-hit");
    expect(route.routeDecision?.selected.reason).toBe("affinity-hit");
  });

  test("sessions and principals are isolated", () => {
    const first = policyAffinityKey("principal-a", "sticky", "same-session")!;
    const second = policyAffinityKey("principal-b", "sticky", "same-session")!;
    rememberPolicyAffinity(first, { provider: "a", model: "m1" });
    rememberPolicyAffinity(second, { provider: "b", model: "m2" });
    expect(lookupPolicyAffinity(first)).toEqual({ provider: "a", model: "m1" });
    expect(lookupPolicyAffinity(second)).toEqual({ provider: "b", model: "m2" });
    expect(first).not.toBe(second);
  });

  test("effort/capability and cooldown eligibility precede affinity", () => {
    const profileConfig = config();
    const key = policyAffinityKey("principal-a", "sticky", "lane-a")!;
    rememberPolicyAffinity(key, { provider: "a", model: "m1" });
    const result = evaluatePolicyProfile(
      profileConfig,
      "sticky",
      { reasoningEffort: "high" },
      [
        { ...evidence("a", "m1", Date.now() + 60_000), capability: { contextWindow: 1000, reasoningEfforts: ["low"] } },
        evidence("b", "m2"),
      ],
      Date.now(),
      lookupPolicyAffinity(key),
    );
    expect(result.selectedIndex).toBe(1);
    expect(result.trace.selected.reason).toBe("policy-selected");
  });

  test("invalidated binding is removed and TTL expires", () => {
    const key = policyAffinityKey("principal-a", "sticky", "lane-a")!;
    rememberPolicyAffinity(key, { provider: "a", model: "m1" }, 1000);
    expect(lookupPolicyAffinity(key, 1000 + 30 * 60 * 1000 + 1)).toBeUndefined();
    rememberPolicyAffinity(key, { provider: "a", model: "m1" });
    forgetPolicyAffinity(key);
    expect(lookupPolicyAffinity(key)).toBeUndefined();
  });
});

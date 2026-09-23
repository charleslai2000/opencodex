import { describe, expect, test } from "bun:test";
import { applyRoutingPreset, compileRoutingPreset, logicalModelCatalogRows } from "../../src/routing/presets";
import { buildRoutingRuntimeSnapshot, createRoutingRuntime, replaceRoutingRuntimeSnapshotForTest } from "../../src/routing/runtime-snapshot";
import { routeModel } from "../../src/router";
import type { OcxConfig } from "../../src/types";

const providers = {
  openai: { adapter: "openai-responses", baseUrl: "https://openai.test", models: ["gpt-6-luna", "gpt-5.6-terra", "gpt-6-sol"] },
  openrouter: { adapter: "openai-chat", baseUrl: "https://openrouter.test", models: ["@preset/lstack-ling-3-0-flash"] },
  deepseek: { adapter: "openai-chat", baseUrl: "https://deepseek.test", models: ["deepseek-flash"] },
  "deepseek-worker": { adapter: "openai-chat", baseUrl: "https://deepseek.test", models: ["deepseek-flash"] },
};

function config(): OcxConfig {
  return {
    port: 19999,
    defaultProvider: "openai",
    providers,
    combos: {},
    routingProfiles: {
      public: { candidates: [{ provider: "deepseek", model: "deepseek-flash" }] },
      control: { candidates: [{ provider: "deepseek", model: "deepseek-flash" }] },
      frontier: { candidates: [{ provider: "deepseek", model: "deepseek-flash" }] },
    },
  };
}

function route(profile: ReturnType<typeof compileRoutingPreset>["lead"], effort: string) {
  return profile.routes![effort]!.flatMap(step => step.candidates);
}

describe("production routing preset compiler", () => {
  test("routing snapshots freeze one generation for captured turns and catalog", () => {
    const openai = applyRoutingPreset(config(), "openai");
    const runtime = createRoutingRuntime(openai);
    const oldTurn = runtime.capture();
    const deepseek = buildRoutingRuntimeSnapshot(applyRoutingPreset(openai, "deepseek"));
    replaceRoutingRuntimeSnapshotForTest(runtime, deepseek);
    const newTurn = runtime.capture();

    expect(oldTurn.snapshot.routingPreset).toBe("openai");
    expect(oldTurn.config.routingProfiles?.lead?.routes?.high?.[0]?.candidates[0]?.model).toBe("gpt-6-luna");
    expect(routeModel(oldTurn.config, "policy/lead", { reasoningEffort: "high" }).modelId).toBe("gpt-6-luna");
    expect(newTurn.snapshot.routingPreset).toBe("deepseek");
    expect(newTurn.config.routingProfiles?.lead?.routes?.high?.[0]?.candidates[0]?.model).toBe("deepseek-flash");
    expect(routeModel(newTurn.config, "policy/lead", { reasoningEffort: "high" }).modelId).toBe("deepseek-flash");
    expect(runtime.current().logicalCatalog).toEqual(newTurn.snapshot.logicalCatalog);
    expect(Object.isFrozen(oldTurn.snapshot.routingProfiles.lead)).toBe(true);
    expect(oldTurn.snapshot.routingFingerprint).not.toBe(newTurn.snapshot.routingFingerprint);
    expect(oldTurn.config.providers.openai).toBe(openai.providers.openai);
  });

  test("snapshot retains legacy profiles while preset catalog stays canonical", () => {
    const initial = buildRoutingRuntimeSnapshot(config());
    expect(initial.routingProfiles).toHaveProperty("public");
    expect(initial.routingProfiles).toHaveProperty("control");
    expect(initial.routingProfiles).toHaveProperty("frontier");
    const active = buildRoutingRuntimeSnapshot(applyRoutingPreset(config(), "openai"));
    expect(active.logicalCatalog.map(row => row.id)).toEqual(["lead", "bot", "worker", "expert"]);
  });

  test("invalid preset staging does not alter the current snapshot", () => {
    const runtime = createRoutingRuntime(applyRoutingPreset(config(), "openai"));
    const before = runtime.current();
    const invalid = structuredClone(config());
    invalid.routingPreset = "invalid" as "openai";
    expect(() => buildRoutingRuntimeSnapshot(invalid)).toThrow("unknown routing preset");
    expect(runtime.current()).toBe(before);
  });

  test("openai compiles the frozen 4x3 matrix without Terra on lead", () => {
    const preset = compileRoutingPreset("openai");
    expect(Object.keys(preset)).toEqual(["lead", "bot", "worker", "expert"]);
    expect(Object.keys(preset.lead.routes!)).toEqual(["low", "medium", "high"]);
    expect(route(preset.lead, "high")).toEqual([{ provider: "openai", model: "gpt-6-luna", upstreamEffort: "high" }]);
    expect(route(preset.worker, "medium")).toEqual([{ provider: "openai", model: "gpt-6-luna", upstreamEffort: "medium" }]);
    expect(route(preset.expert, "low")).toEqual([{ provider: "openai", model: "gpt-6-luna", upstreamEffort: "high" }]);
    expect(route(preset.expert, "medium")).toEqual([{ provider: "openai", model: "gpt-5.6-terra", upstreamEffort: "medium" }]);
    expect(route(preset.expert, "high")).toEqual([{ provider: "openai", model: "gpt-5.6-terra", upstreamEffort: "high" }]);
  });

  test("deepseek maps logical efforts onto the canonical low/high/max ladder", () => {
    const preset = compileRoutingPreset("deepseek");
    expect(route(preset.lead, "low")[0]).toMatchObject({ provider: "deepseek", upstreamEffort: "low" });
    expect(route(preset.lead, "medium")[0]).toMatchObject({ provider: "deepseek", upstreamEffort: "high" });
    expect(route(preset.lead, "high")[0]).toMatchObject({ provider: "deepseek", upstreamEffort: "max" });
    for (const effort of ["low", "medium", "high"]) {
      expect(route(preset.expert, effort)[0]).toMatchObject({ provider: "deepseek", upstreamEffort: "high" });
    }
    expect(route(preset.worker, "low")[0]).toMatchObject({ provider: "deepseek", upstreamEffort: "low" });
    expect(route(preset.worker, "medium")[0]).toMatchObject({ provider: "deepseek", upstreamEffort: "low" });
    expect(route(preset.worker, "high")[0]).toMatchObject({ provider: "deepseek", upstreamEffort: "high" });
  });

  test("bot has ordered Ling then DeepSeek fallback with medium folded to high", () => {
    for (const name of ["openai", "deepseek"] as const) {
      const bot = compileRoutingPreset(name).bot;
      expect(route(bot, "low")).toEqual([
        { provider: "openrouter", model: "@preset/lstack-ling-3-0-flash", upstreamEffort: "low" },
        { provider: "deepseek", model: "deepseek-flash", upstreamEffort: "low" },
      ]);
      expect(route(bot, "medium")[1]!.upstreamEffort).toBe("high");
      expect(route(bot, "high")[1]!.upstreamEffort).toBe("high");
    }
  });

  test("apply is additive for legacy aliases and emits stable logical catalog rows", () => {
    const openai = applyRoutingPreset(config(), "openai");
    expect(openai.routingPreset).toBe("openai");
    expect(openai.routingProfiles).toHaveProperty("public");
    expect(openai.routingProfiles).toHaveProperty("control");
    expect(openai.routingProfiles).toHaveProperty("frontier");
    expect(openai.routingProfiles).toHaveProperty("lead");
    expect(openai.routingProfiles).toHaveProperty("bot");
    expect(logicalModelCatalogRows(openai).map(row => row.id)).toEqual(["lead", "bot", "worker", "expert"]);
    expect(logicalModelCatalogRows(openai).every(row => row.context_window === 400000 && row.max_output_tokens === 128000)).toBe(true);

    const deepseek = applyRoutingPreset(config(), "deepseek");
    expect(logicalModelCatalogRows(deepseek).map(row => row.id)).toEqual(["lead", "bot", "worker", "expert"]);
    expect(logicalModelCatalogRows(deepseek)[0]).toMatchObject({
      opencodex_logical_efforts: ["low", "medium", "high"],
      reasoning: true,
    });
  });

  test("generates Ling capability metadata for both presets without changing credentials", () => {
    for (const name of ["openai", "deepseek"] as const) {
      const base = config();
      const openrouter = base.providers.openrouter;
      const applied = applyRoutingPreset(base, name);
      expect(applied.providers.openrouter.baseUrl).toBe(openrouter.baseUrl);
      expect(applied.providers.openrouter.apiKey).toBe(openrouter.apiKey);
      expect(applied.providers.openrouter.models).toContain("@preset/lstack-ling-3-0-flash");
      expect(applied.providers.openrouter.modelReasoningEfforts?.["@preset/lstack-ling-3-0-flash"]).toEqual(["low", "medium", "high"]);
      expect(applied.providers.openrouter.modelReasoningEffortMap?.["@preset/lstack-ling-3-0-flash"]).toEqual({ low: "low", medium: "medium", high: "high" });
    }
  });

  test("preserves unrelated OpenRouter metadata and is idempotent across preset round trips", () => {
    const base = config();
    base.providers.openrouter.models = ["@preset/lstack-ling-3-0-flash", "another-model"];
    base.providers.openrouter.modelReasoningEfforts = { "another-model": ["low"] };
    base.providers.openrouter.modelReasoningEffortMap = { "another-model": { low: "native-low" } };
    const once = applyRoutingPreset(base, "openai");
    const twice = applyRoutingPreset(once, "openai");
    expect(twice).toEqual(once);
    const roundTrip = applyRoutingPreset(applyRoutingPreset(base, "deepseek"), "openai");
    expect(roundTrip).toEqual(once);
    expect(roundTrip.providers.openrouter.models).toEqual(["@preset/lstack-ling-3-0-flash", "another-model"]);
    expect(roundTrip.providers.openrouter.modelReasoningEfforts?.["another-model"]).toEqual(["low"]);
    expect(roundTrip.providers.openrouter.modelReasoningEffortMap?.["another-model"]).toEqual({ low: "native-low" });
  });

  test("fails before producing a preset when a required provider is missing", () => {
    const base = config();
    delete base.providers.openrouter;
    expect(() => applyRoutingPreset(base, "openai")).toThrow("required provider openrouter missing");
    expect(base.routingPreset).toBeUndefined();
    expect(base.routingProfiles).toHaveProperty("public");
  });
});

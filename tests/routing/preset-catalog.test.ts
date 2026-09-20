import { describe, expect, test } from "bun:test";
import { applyRoutingPreset, compileRoutingPreset, logicalModelCatalogRows } from "../../src/routing/presets";
import type { OcxConfig } from "../../src/types";

const providers = {
  openai: { adapter: "openai-responses", baseUrl: "https://openai.test", models: ["gpt-5.6-luna", "gpt-5.6-terra"] },
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
  test("openai compiles the frozen 4x3 matrix without Terra on lead", () => {
    const preset = compileRoutingPreset("openai");
    expect(Object.keys(preset)).toEqual(["lead", "bot", "worker", "expert"]);
    expect(Object.keys(preset.lead.routes!)).toEqual(["low", "medium", "high"]);
    expect(route(preset.lead, "high")).toEqual([{ provider: "openai", model: "gpt-5.6-luna", upstreamEffort: "high" }]);
    expect(route(preset.worker, "medium")).toEqual([{ provider: "openai", model: "gpt-5.6-luna", upstreamEffort: "medium" }]);
    expect(route(preset.expert, "low")).toEqual([{ provider: "openai", model: "gpt-5.6-luna", upstreamEffort: "high" }]);
    expect(route(preset.expert, "medium")).toEqual([{ provider: "openai", model: "gpt-5.6-terra", upstreamEffort: "medium" }]);
    expect(route(preset.expert, "high")).toEqual([{ provider: "openai", model: "gpt-5.6-terra", upstreamEffort: "high" }]);
  });

  test("deepseek preserves worker-low and folds lead/expert to the frozen ladder", () => {
    const preset = compileRoutingPreset("deepseek");
    expect(route(preset.lead, "low")[0]).toMatchObject({ provider: "deepseek", upstreamEffort: "low" });
    expect(route(preset.lead, "medium")[0]).toMatchObject({ provider: "deepseek", upstreamEffort: "high" });
    for (const effort of ["low", "medium", "high"]) {
      expect(route(preset.expert, effort)[0]).toMatchObject({ provider: "deepseek", upstreamEffort: "high" });
      expect(route(preset.worker, effort)[0]).toMatchObject({ provider: "deepseek-worker", upstreamEffort: "low" });
    }
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
});

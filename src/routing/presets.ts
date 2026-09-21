import type { OcxConfig, OcxRoutingProfileConfig } from "../types";
import { getRoutingProfile, routingProfileIssues } from "./profile";

export const LOGICAL_MODEL_IDS = ["lead", "bot", "worker", "expert"] as const;
export const LOGICAL_EFFORTS = ["low", "medium", "high"] as const;
export type RoutingPresetName = "openai" | "deepseek";

const POLICY_CONTEXT = 400_000;
const POLICY_OUTPUT = 128_000;

type Route = OcxRoutingProfileConfig["routes"];

function candidate(provider: string, model: string, upstreamEffort: string) {
  return { candidates: [{ provider, model, upstreamEffort }] };
}

function botRoutes(): Route {
  return {
    low: [candidate("openrouter", "@preset/lstack-ling-3-0-flash", "low"), candidate("deepseek", "deepseek-flash", "low")],
    medium: [candidate("openrouter", "@preset/lstack-ling-3-0-flash", "medium"), candidate("deepseek", "deepseek-flash", "high")],
    high: [candidate("openrouter", "@preset/lstack-ling-3-0-flash", "high"), candidate("deepseek", "deepseek-flash", "high")],
  };
}

function profile(routes: Route, advertisedContextWindow = POLICY_CONTEXT, alias?: string): OcxRoutingProfileConfig {
  return {
    ...(alias ? { alias } : {}),
    routes,
    advertisedContextWindow,
    advertisedMaxOutputTokens: POLICY_OUTPUT,
  };
}

export function compileRoutingPreset(name: RoutingPresetName): Record<string, OcxRoutingProfileConfig> {
  const bot = profile(botRoutes(), POLICY_CONTEXT, "bot");
  if (name === "openai") {
    return {
      lead: profile({
        low: [candidate("openai", "gpt-5.6-luna", "low")],
        medium: [candidate("openai", "gpt-5.6-luna", "medium")],
        high: [candidate("openai", "gpt-5.6-luna", "high")],
      }),
      bot,
      worker: profile({
        low: [candidate("openai", "gpt-5.6-luna", "low")],
        medium: [candidate("openai", "gpt-5.6-luna", "medium")],
        high: [candidate("openai", "gpt-5.6-luna", "high")],
      }),
      expert: profile({
        low: [candidate("openai", "gpt-5.6-luna", "high")],
        medium: [candidate("openai", "gpt-5.6-terra", "medium")],
        high: [candidate("openai", "gpt-5.6-terra", "high")],
      }),
    };
  }
  return {
    lead: profile({
      low: [candidate("deepseek", "deepseek-flash", "low")],
      medium: [candidate("deepseek", "deepseek-flash", "high")],
      high: [candidate("deepseek", "deepseek-flash", "max")],
    }),
    bot,
    worker: profile({
      low: [candidate("deepseek", "deepseek-flash", "low")],
      medium: [candidate("deepseek", "deepseek-flash", "low")],
      high: [candidate("deepseek", "deepseek-flash", "high")],
    }),
    expert: profile({
      low: [candidate("deepseek", "deepseek-flash", "high")],
      medium: [candidate("deepseek", "deepseek-flash", "high")],
      high: [candidate("deepseek", "deepseek-flash", "high")],
    }),
  };
}

export function applyRoutingPreset(config: OcxConfig, name: RoutingPresetName): OcxConfig {
  const profiles = compileRoutingPreset(name);
  const nextProfiles = Object.fromEntries(Object.entries(profiles).map(([id, raw]) => [id, { ...raw, alias: id }]));
  const next = { ...config, routingPreset: name, routingProfiles: { ...(config.routingProfiles ?? {}), ...nextProfiles } };
  for (const [id, raw] of Object.entries(nextProfiles)) {
    const issues = routingProfileIssues(id, raw, next);
    if (issues.length > 0) throw new Error(`Invalid ${name} preset profile ${id}: ${issues[0]!.message}`);
  }
  return next;
}

export interface LogicalModelCatalogRow {
  id: string;
  object: "model";
  created: 0;
  owned_by: "opencodex";
  reasoning: true;
  reasoning_efforts: Array<{ value: string; label: string }>;
  context_window: number;
  max_output_tokens: number;
  opencodex_logical_efforts: string[];
}

export interface LogicalModelCapabilityEvidence {
  preset: RoutingPresetName;
  logicalModel: string;
  primaryPhysicalContextWindow: number | "unknown";
  advertisedContextWindow: number;
  advertisedMaxOutputTokens: number;
  catalogContextWindow: number;
  catalogMaxOutputTokens: number;
}

/** Internal qualification evidence; physical provider facts never enter the public catalog row. */
export function logicalModelCapabilityEvidence(
  config: OcxConfig,
  physicalContextByLogicalModel: Readonly<Record<string, number | "unknown">>,
): LogicalModelCapabilityEvidence[] {
  const preset = config.routingPreset;
  if (!preset) return [];
  return LOGICAL_MODEL_IDS.map(logicalModel => {
    const profile = getRoutingProfile(config, logicalModel);
    const advertisedContextWindow = profile?.advertisedContextWindow ?? POLICY_CONTEXT;
    const advertisedMaxOutputTokens = profile?.advertisedMaxOutputTokens ?? POLICY_OUTPUT;
    return {
      preset,
      logicalModel,
      primaryPhysicalContextWindow: physicalContextByLogicalModel[logicalModel] ?? "unknown",
      advertisedContextWindow,
      advertisedMaxOutputTokens,
      catalogContextWindow: advertisedContextWindow,
      catalogMaxOutputTokens: advertisedMaxOutputTokens,
    };
  });
}

export function logicalModelCatalogRows(config: OcxConfig): LogicalModelCatalogRow[] {
  const preset = config.routingPreset;
  if (!preset) return [];
  return LOGICAL_MODEL_IDS.map(id => {
    const profile = getRoutingProfile(config, id);
    const context = profile?.advertisedContextWindow ?? POLICY_CONTEXT;
    const output = profile?.advertisedMaxOutputTokens ?? POLICY_OUTPUT;
    return {
      id,
      object: "model",
      created: 0,
      owned_by: "opencodex",
      reasoning: true,
      reasoning_efforts: LOGICAL_EFFORTS.map(value => ({ value, label: `${value[0]!.toUpperCase()}${value.slice(1)} Effort` })),
      context_window: context,
      max_output_tokens: output,
      opencodex_logical_efforts: [...LOGICAL_EFFORTS],
    };
  });
}

import { createHash } from "node:crypto";
import type { OcxConfig, OcxRoutingProfileConfig } from "../types";
import { routingProfileIssues } from "./profile";
import { applyRoutingPreset, logicalModelCatalogRows, type LogicalModelCatalogRow, type RoutingPresetName } from "./presets";

export type RoutingProviderProjection = Pick<NonNullable<OcxConfig["providers"]["openrouter"]>, "models" | "modelReasoningEfforts" | "modelReasoningEffortMap">;

export interface RoutingRuntimeSnapshot {
  readonly routingPreset: RoutingPresetName | null;
  readonly routingProfiles: Readonly<Record<string, OcxRoutingProfileConfig>>;
  readonly openrouterRoutingMetadata: Readonly<RoutingProviderProjection> | null;
  readonly logicalCatalog: readonly LogicalModelCatalogRow[];
  readonly routingFingerprint: string;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function routingView(config: OcxConfig, snapshot: Pick<RoutingRuntimeSnapshot, "routingPreset" | "routingProfiles" | "openrouterRoutingMetadata">): OcxConfig {
  const providers = { ...config.providers };
  if (snapshot.openrouterRoutingMetadata && providers.openrouter) {
    const base = providers.openrouter;
    const projection = snapshot.openrouterRoutingMetadata;
    providers.openrouter = {
      ...base,
      models: [...new Set([...(base.models ?? []), ...(projection.models ?? [])])],
      modelReasoningEfforts: { ...(base.modelReasoningEfforts ?? {}), ...(projection.modelReasoningEfforts ?? {}) },
      modelReasoningEffortMap: { ...(base.modelReasoningEffortMap ?? {}), ...(projection.modelReasoningEffortMap ?? {}) },
    };
  }
  return { ...config, routingPreset: snapshot.routingPreset ?? undefined, routingProfiles: { ...snapshot.routingProfiles }, providers };
}

export function buildRoutingRuntimeSnapshot(config: OcxConfig): RoutingRuntimeSnapshot {
  const preset = config.routingPreset ?? null;
  const projectedConfig = config;
  if (preset !== null) {
    if (preset !== "openai" && preset !== "deepseek") throw new Error("unknown routing preset");
    for (const provider of ["openai", "openrouter", "deepseek"]) {
      if (!config.providers[provider]) throw new Error(`required provider ${provider} missing for ${preset} preset`);
    }
    const compiled = applyRoutingPreset(config, preset);
    for (const id of ["lead", "bot", "worker", "expert"]) {
      const raw = config.routingProfiles?.[id];
      if (!raw) throw new Error(`required routing profile ${id} missing for ${preset} preset`);
      const issues = routingProfileIssues(id, raw, config);
      if (issues.length) throw new Error(`Invalid ${preset} preset profile ${id}: ${issues[0]!.message}`);
      const expected = { ...compiled.routingProfiles?.[id], alias: raw.alias };
      if (stable(raw) !== stable(expected)) throw new Error(`routing profile ${id} does not match compiled ${preset} preset`);
    }
    const expectedMetadata = compiled.providers.openrouter;
    const actualMetadata = config.providers.openrouter!;
    if (stable(actualMetadata.models) !== stable(expectedMetadata.models)
      || stable(actualMetadata.modelReasoningEfforts?.["@preset/lstack-ling-3-0-flash"]) !== stable(expectedMetadata.modelReasoningEfforts?.["@preset/lstack-ling-3-0-flash"])
      || stable(actualMetadata.modelReasoningEffortMap?.["@preset/lstack-ling-3-0-flash"]) !== stable(expectedMetadata.modelReasoningEffortMap?.["@preset/lstack-ling-3-0-flash"])) {
      throw new Error(`required OpenRouter Ling metadata invalid for ${preset} preset`);
    }
  }
  const profiles: Record<string, OcxRoutingProfileConfig> = structuredClone(projectedConfig.routingProfiles ?? {});
  const openrouter = projectedConfig.providers.openrouter;
  const metadata: RoutingProviderProjection | null = preset && openrouter ? {
    models: openrouter.models?.includes("@preset/lstack-ling-3-0-flash")
      ? ["@preset/lstack-ling-3-0-flash"] : [],
    modelReasoningEfforts: openrouter.modelReasoningEfforts?.["@preset/lstack-ling-3-0-flash"]
      ? { "@preset/lstack-ling-3-0-flash": structuredClone(openrouter.modelReasoningEfforts["@preset/lstack-ling-3-0-flash"]) } : undefined,
    modelReasoningEffortMap: openrouter.modelReasoningEffortMap?.["@preset/lstack-ling-3-0-flash"]
      ? { "@preset/lstack-ling-3-0-flash": structuredClone(openrouter.modelReasoningEffortMap["@preset/lstack-ling-3-0-flash"]) } : undefined,
  } : null;
  const view = routingView(projectedConfig, { routingPreset: preset, routingProfiles: profiles, openrouterRoutingMetadata: metadata });
  const logicalCatalog = logicalModelCatalogRows(view);
  const fingerprint = createHash("sha256").update(stable({ preset, profiles, metadata, logicalCatalog })).digest("hex");
  return deepFreeze({ routingPreset: preset, routingProfiles: profiles, openrouterRoutingMetadata: metadata, logicalCatalog, routingFingerprint: fingerprint });
}

export function buildRoutingRuntimeSnapshotFromRaw(raw: unknown, startupConfig: OcxConfig): RoutingRuntimeSnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("routing config must be an object");
  const root = raw as Record<string, unknown>;
  const preset = root.routingPreset;
  if (preset !== undefined && preset !== "openai" && preset !== "deepseek") throw new Error("routingPreset is invalid");
  const profileMap = root.routingProfiles;
  if (profileMap !== undefined && (!profileMap || typeof profileMap !== "object" || Array.isArray(profileMap))) throw new Error("routingProfiles must be an object");
  const providersRaw = root.providers;
  if (!providersRaw || typeof providersRaw !== "object" || Array.isArray(providersRaw)) throw new Error("providers must be an object");
  const openrouterRaw = (providersRaw as Record<string, unknown>).openrouter;
  if (!openrouterRaw || typeof openrouterRaw !== "object" || Array.isArray(openrouterRaw)) throw new Error("required OpenRouter provider missing");
  const openrouter = openrouterRaw as Record<string, unknown>;
  if (!Array.isArray(openrouter.models) || !openrouter.models.every(value => typeof value === "string")) throw new Error("OpenRouter models must be a string array");
  const efforts = openrouter.modelReasoningEfforts;
  if (!efforts || typeof efforts !== "object" || Array.isArray(efforts) || Object.values(efforts).some(value => !Array.isArray(value) || !value.every(item => typeof item === "string"))) throw new Error("OpenRouter modelReasoningEfforts is invalid");
  const effortMap = openrouter.modelReasoningEffortMap;
  if (!effortMap || typeof effortMap !== "object" || Array.isArray(effortMap) || Object.values(effortMap).some(value => !value || typeof value !== "object" || Array.isArray(value) || Object.values(value as Record<string, unknown>).some(item => typeof item !== "string"))) throw new Error("OpenRouter modelReasoningEffortMap is invalid");
  const projected = structuredClone(startupConfig);
  projected.routingPreset = preset as RoutingPresetName | undefined;
  projected.routingProfiles = structuredClone((profileMap ?? {}) as Record<string, OcxRoutingProfileConfig>);
  for (const [id, profile] of Object.entries(projected.routingProfiles)) {
    const issues = routingProfileIssues(id, profile, projected);
    if (issues.length) throw new Error(`Invalid routing profile ${id}: ${issues[0]!.message}`);
  }
  projected.providers.openrouter = {
    ...projected.providers.openrouter,
    models: structuredClone(openrouter.models as string[]),
    modelReasoningEfforts: structuredClone(efforts as Record<string, string[]>),
    modelReasoningEffortMap: structuredClone(effortMap as Record<string, Record<string, string>>),
  };
  return buildRoutingRuntimeSnapshot(projected);
}

export interface TurnRoutingContext {
  readonly snapshot: RoutingRuntimeSnapshot;
  readonly config: OcxConfig;
}

export function createTurnRoutingContext(startupConfig: OcxConfig, snapshot: RoutingRuntimeSnapshot): TurnRoutingContext {
  return Object.freeze({ snapshot, config: routingView(startupConfig, snapshot) });
}

export function createRoutingRuntime(startupConfig: OcxConfig) {
  let current = buildRoutingRuntimeSnapshot(startupConfig);
  const capture = () => createTurnRoutingContext(startupConfig, current);
  const currentSnapshot = (): RoutingRuntimeSnapshot => current;
  const replace = (next: RoutingRuntimeSnapshot): void => { current = next; };
  return { current: currentSnapshot, capture, replace };
}

export function replaceRoutingRuntimeSnapshotForTest(
  runtime: ReturnType<typeof createRoutingRuntime>,
  next: RoutingRuntimeSnapshot,
): void {
  runtime.replace(next);
}

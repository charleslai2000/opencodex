import { createHash } from "node:crypto";
import type { OcxConfig } from "../types";
import { buildRoutingRuntimeSnapshot, type RoutingRuntimeSnapshot } from "../routing/runtime-snapshot";

export interface RoutingReloadObservationDeps {
  configBytes: () => Uint8Array;
  reload: (hash: string) => Promise<{ routingFingerprint: string; routingPreset: string | null; routingProfiles: unknown; catalog: unknown; configHash: string }>;
  fetchRuntime: () => Promise<{ snapshot: RoutingRuntimeSnapshot; pid: number }>;
}
export async function observeRoutingReloadCandidate(candidate: OcxConfig, deps: RoutingReloadObservationDeps) {
  const expected = buildRoutingRuntimeSnapshot(candidate);
  const bytes = deps.configBytes();
  const configHash = createHash("sha256").update(bytes).digest("hex");
  const response = await deps.reload(configHash);
  const live = await deps.fetchRuntime();
  if (response.configHash !== configHash || response.routingFingerprint !== expected.routingFingerprint
    || response.routingPreset !== expected.routingPreset
    || JSON.stringify(response.routingProfiles) !== JSON.stringify(expected.routingProfiles)
    || JSON.stringify(response.catalog) !== JSON.stringify(expected.logicalCatalog)
    || live.snapshot.routingFingerprint !== expected.routingFingerprint
    || live.snapshot.routingPreset !== expected.routingPreset
    || JSON.stringify(live.snapshot.routingProfiles) !== JSON.stringify(expected.routingProfiles)
    || JSON.stringify(live.snapshot.logicalCatalog) !== JSON.stringify(expected.logicalCatalog)) {
    throw new Error("runtime routing snapshot does not match candidate");
  }
  return { pid: live.pid, configHash, routingFingerprint: expected.routingFingerprint, routingPreset: expected.routingPreset };
}

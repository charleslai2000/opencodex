/** Process-local sticky placement for policy candidates. */

export interface PolicyAffinityTarget {
  provider: string;
  model: string;
}

export function policyAffinityKey(principal: string | undefined, profileId: string, sessionLane: string | undefined): string | undefined {
  return principal && sessionLane ? `${principal}\u0000${profileId}\u0000${sessionLane}` : undefined;
}

interface PolicyAffinityEntry extends PolicyAffinityTarget {
  lastUsedAt: number;
}

export const POLICY_AFFINITY_TTL_MS = 30 * 60 * 1000;
export const POLICY_AFFINITY_MAX_ENTRIES = 4096;

const entries = new Map<string, PolicyAffinityEntry>();

function pruneExpired(now: number): void {
  for (const [key, entry] of entries) {
    if (now - entry.lastUsedAt > POLICY_AFFINITY_TTL_MS) entries.delete(key);
  }
}

export function lookupPolicyAffinity(key: string, now = Date.now()): PolicyAffinityTarget | undefined {
  pruneExpired(now);
  const entry = entries.get(key);
  if (!entry) return undefined;
  entry.lastUsedAt = now;
  entries.delete(key);
  entries.set(key, entry);
  return { provider: entry.provider, model: entry.model };
}

export function rememberPolicyAffinity(key: string, target: PolicyAffinityTarget, now = Date.now()): void {
  pruneExpired(now);
  entries.delete(key);
  entries.set(key, { ...target, lastUsedAt: now });
  while (entries.size > POLICY_AFFINITY_MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

export function forgetPolicyAffinity(key: string): void {
  entries.delete(key);
}

export function prunePolicyAffinity(now = Date.now()): void {
  pruneExpired(now);
}

/** Test-only reset; no production caller should need to clear process state. */
export function clearPolicyAffinity(): void {
  entries.clear();
}

export function rememberPolicyAffinityForSelection(
  key: string | undefined,
  target: PolicyAffinityTarget,
  now = Date.now(),
): "fallback-rebind" | "normal-selection" | undefined {
  if (!key) return undefined;
  rememberPolicyAffinity(key, target, now);
  return "normal-selection";
}

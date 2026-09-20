/** Process-local sticky placement for policy candidates. */

export interface PolicyAffinityTarget {
  provider: string;
  model: string;
}

export interface OrderedAffinityTarget extends PolicyAffinityTarget {
  stepIndex: number;
  candidateIndex: number;
  upstreamEffort: string;
}

export function policyAffinityKey(principal: string | undefined, profileId: string, sessionLane: string | undefined): string | undefined {
  return principal && sessionLane ? `${principal}\u0000${profileId}\u0000${sessionLane}` : undefined;
}

interface PolicyAffinityEntry extends PolicyAffinityTarget {
  lastUsedAt: number;
}
interface OrderedAffinityEntry extends OrderedAffinityTarget { lastUsedAt: number; }

export const POLICY_AFFINITY_TTL_MS = 30 * 60 * 1000;
export const POLICY_AFFINITY_MAX_ENTRIES = 4096;

const entries = new Map<string, PolicyAffinityEntry>();
const orderedEntries = new Map<string, OrderedAffinityEntry>();

function pruneExpired(now: number): void {
  for (const [key, entry] of entries) {
    if (now - entry.lastUsedAt > POLICY_AFFINITY_TTL_MS) entries.delete(key);
  }
  for (const [key, entry] of orderedEntries) {
    if (now - entry.lastUsedAt > POLICY_AFFINITY_TTL_MS) orderedEntries.delete(key);
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

export function orderedAffinityKey(principal: string | undefined, profileId: string, logicalEffort: string, sessionLane: string | undefined): string | undefined {
  return principal && sessionLane ? `${principal}\u0000${profileId}\u0000${logicalEffort}\u0000${sessionLane}` : undefined;
}

export function lookupOrderedAffinity(key: string, now = Date.now()): OrderedAffinityTarget | undefined {
  pruneExpired(now);
  const entry = orderedEntries.get(key);
  if (!entry) return undefined;
  entry.lastUsedAt = now;
  orderedEntries.delete(key); orderedEntries.set(key, entry);
  return { ...entry };
}

export function rememberOrderedAffinity(key: string, target: OrderedAffinityTarget, now = Date.now()): void {
  pruneExpired(now); orderedEntries.delete(key); orderedEntries.set(key, { ...target, lastUsedAt: now });
  while (orderedEntries.size > POLICY_AFFINITY_MAX_ENTRIES) orderedEntries.delete(orderedEntries.keys().next().value!);
}

export function forgetOrderedAffinity(key: string): void { orderedEntries.delete(key); }

export function prunePolicyAffinity(now = Date.now()): void {
  pruneExpired(now);
}

/** Test-only reset; no production caller should need to clear process state. */
export function clearPolicyAffinity(): void {
  entries.clear(); orderedEntries.clear();
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

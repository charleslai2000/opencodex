import { createHash } from "node:crypto";

export interface ReplicaPlacementCandidate {
  provider: string;
  model: string;
}

function hrwDigest(affinityKey: string, candidate: ReplicaPlacementCandidate): string {
  const identity = `${candidate.provider}\u0000${candidate.model}`;
  return createHash("sha256").update(affinityKey).update("\u0000").update(identity).digest("hex");
}

/** Full deterministic rendezvous/HRW preference order, highest hash first. */
export function rankCandidatesByHrw<T extends ReplicaPlacementCandidate>(
  affinityKey: string,
  candidates: readonly T[],
): T[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, digest: hrwDigest(affinityKey, candidate) }))
    .sort((a, b) => b.digest.localeCompare(a.digest) || a.index - b.index)
    .map(row => row.candidate);
}

/** Stable rendezvous/HRW placement: max H(affinity key + candidate identity). */
export function chooseReplicaByHrw(
  affinityKey: string,
  candidates: readonly ReplicaPlacementCandidate[],
): ReplicaPlacementCandidate | undefined {
  return rankCandidatesByHrw(affinityKey, candidates)[0];
}

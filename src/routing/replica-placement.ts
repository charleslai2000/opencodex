import { createHash } from "node:crypto";

export interface ReplicaPlacementCandidate {
  provider: string;
  model: string;
}

/** Stable rendezvous/HRW placement: max H(affinity key + candidate identity). */
export function chooseReplicaByHrw(
  affinityKey: string,
  candidates: readonly ReplicaPlacementCandidate[],
): ReplicaPlacementCandidate | undefined {
  let winner: ReplicaPlacementCandidate | undefined;
  let winnerHash = "";
  for (const candidate of candidates) {
    const identity = `${candidate.provider}\u0000${candidate.model}`;
    const digest = createHash("sha256").update(affinityKey).update("\u0000").update(identity).digest("hex");
    if (winner === undefined || digest > winnerHash) {
      winner = candidate;
      winnerHash = digest;
    }
  }
  return winner;
}

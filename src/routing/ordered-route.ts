/** Internal ordered-route runtime foundation. Public config wiring is intentionally separate. */

export interface OrderedRouteCandidate {
  provider: string;
  model: string;
  upstreamEffort?: string;
  stepIndex: number;
  candidateIndex: number;
}

export interface OrderedRouteStep {
  candidates: OrderedRouteCandidate[];
}

export interface OrderedRoutePlan {
  logicalEffort: string;
  steps: OrderedRouteStep[];
}

export interface OrderedRouteSelection<T extends OrderedRouteCandidate> {
  candidate: T;
  stepIndex: number;
}

export function orderedPlacementKey(principal: string, profileId: string, logicalEffort: string, sessionLane: string): string {
  return `${principal}\u0000${profileId}\u0000${logicalEffort}\u0000${sessionLane}`;
}

/**
 * Select only from the first non-exhausted step. `eligible` is evaluated by the
 * caller's existing hard-eligibility rules; `terminallyFailed` is request-local.
 * Ranking is deliberately confined to that step and cannot compare later steps.
 */
export function selectOrderedRouteCandidate<T extends OrderedRouteCandidate>(
  plan: OrderedRoutePlan,
  eligible: (candidate: T) => boolean,
  terminallyFailed: ReadonlySet<string>,
  rankWithinStep: (candidates: T[], stepIndex: number) => T | undefined,
): OrderedRouteSelection<T> | undefined {
  for (const [stepIndex, step] of plan.steps.entries()) {
    const remaining = step.candidates
      .filter((candidate): candidate is T => eligible(candidate as T))
      .filter(candidate => !terminallyFailed.has(orderedCandidateKey(candidate)));
    const selected = rankWithinStep(remaining, stepIndex);
    if (selected) return { candidate: selected, stepIndex };
  }
  return undefined;
}

/** Physical identity is request-local; step/candidate indexes prevent ambiguity. */
export function orderedCandidateKey(candidate: Pick<OrderedRouteCandidate, "stepIndex" | "candidateIndex" | "provider" | "model">): string {
  return `${candidate.stepIndex}\u0000${candidate.candidateIndex}\u0000${candidate.provider}\u0000${candidate.model}`;
}

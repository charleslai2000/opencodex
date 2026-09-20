import { describe, expect, test } from "bun:test";
import { rankCandidatesByHrw } from "../../src/routing/replica-placement";
import { orderedCandidateKey, orderedPlacementKey, selectOrderedRouteCandidate, type OrderedRoutePlan } from "../../src/routing/ordered-route";
import { buildRouteDecisionTrace } from "../../src/routing/trace";

type C = { provider: string; model: string; stepIndex: number; candidateIndex: number; score: number };
const c = (stepIndex: number, candidateIndex: number, model = `q${candidateIndex}`, score = 0.5): C => ({ provider: "qwen", model, stepIndex, candidateIndex, score });
function plan(): OrderedRoutePlan { return { logicalEffort: "medium", steps: [{ candidates: [c(0, 0, "q0", .1), c(0, 1, "q1", .2), c(0, 2, "q2", .3)] }, { candidates: [c(1, 0, "luna", .99)] }] }; }

describe("ordered route runtime foundation", () => {
  test("first step wins regardless of later score", () => { const x = selectOrderedRouteCandidate(plan(), () => true, new Set(), rows => rows.sort((a, b) => b.score - a.score)[0]); expect(x?.candidate.model).toBe("q2"); expect(x?.stepIndex).toBe(0); });
  test("same-step failure precedes later step", () => { const failed = new Set([orderedCandidateKey(c(0, 2, "q2"))]); const x = selectOrderedRouteCandidate(plan(), () => true, failed, rows => rows.sort((a, b) => b.score - a.score)[0]); expect(x?.candidate.model).toBe("q1"); });
  test("later step starts only after step exhaustion", () => { const failed = new Set([0, 1, 2].map(i => orderedCandidateKey(c(0, i, `q${i}`)))); const x = selectOrderedRouteCandidate(plan(), () => true, failed, rows => rows[0]); expect(x?.candidate.model).toBe("luna"); expect(x?.stepIndex).toBe(1); });
  test("hard-ineligible candidates count as unavailable", () => { const x = selectOrderedRouteCandidate(plan(), c => c.stepIndex === 1, new Set(), rows => rows[0]); expect(x?.candidate.model).toBe("luna"); });
  test("partial hard ineligibility stays in current step", () => { const x = selectOrderedRouteCandidate(plan(), c => c.model === "q1", new Set(), rows => rows[0]); expect(x?.candidate.model).toBe("q1"); });
  test("all steps exhausted returns no route", () => { const failed = new Set([...([0, 1, 2].map(i => orderedCandidateKey(c(0, i, `q${i}`)))), orderedCandidateKey(c(1, 0, "luna"))]); expect(selectOrderedRouteCandidate(plan(), () => true, failed, rows => rows[0])).toBeUndefined(); });
  test("ordered trace identity remains immutable", () => { const trace = buildRouteDecisionTrace({ requestedModel: "policy/lead", routeKind: "policy", profile: { id: "lead", revision: "1" }, candidates: [{ ...c(0, 0), eligible: true, exclusions: [], upstreamEffort: "high" }, { ...c(1, 0, "luna"), eligible: true, exclusions: [], upstreamEffort: "medium" }], selected: { provider: "qwen", model: "q0", reason: "ordered-hrw", candidateIndex: 0 } }); const before = JSON.stringify(trace); expect(trace.candidates.map(x => [x.stepIndex, x.candidateIndex, x.upstreamEffort])).toEqual([[0, 0, "high"], [1, 0, "medium"]]); expect(JSON.stringify(trace)).toBe(before); });
});

describe("ordered route pool HRW", () => {
  test("same key produces deterministic full order", () => { const xs = [0, 1, 2, 3].map(i => c(0, i)); const key = orderedPlacementKey("principal", "lead", "medium", "session"); expect(rankCandidatesByHrw(key, xs).map(x => x.model)).toEqual(rankCandidatesByHrw(key, xs).map(x => x.model)); });
  test("removed candidate preserves the remaining HRW order", () => { const xs = [0, 1, 2, 3].map(i => c(0, i)); const key = orderedPlacementKey("principal", "lead", "medium", "session"); const full = rankCandidatesByHrw(key, xs); expect(rankCandidatesByHrw(key, xs.filter(x => x !== full[0])).map(x => x.model)).toEqual(full.slice(1).map(x => x.model)); });
  test("hard eligibility is applied before HRW", () => { const failed = new Set([orderedCandidateKey(c(0, 0))]); const x = selectOrderedRouteCandidate(plan(), y => y.model !== "q0", failed, rows => rankCandidatesByHrw("k", rows)[0]); expect(x?.candidate.model).not.toBe("q0"); });
});

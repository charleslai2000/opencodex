import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addSolCacheComparison,
  captureSolUpstreamPayload,
  captureSolUpstreamRequest,
  captureSolUpstreamResponseHeaders,
  getSolRequestCaptureStatus,
  startSolRequestCapture,
} from "../../src/server/responses/sol-upstream-capture";
import { removeTreeWithRetry } from "../helpers/remove-tree";

const originalOpenCodexHome = process.env.OPENCODEX_HOME;
let testDir = "";

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "ocx-sol-capture-"));
  process.env.OPENCODEX_HOME = testDir;
  startSolRequestCapture();
});

afterEach(() => {
  if (originalOpenCodexHome === undefined) delete process.env.OPENCODEX_HOME;
  else process.env.OPENCODEX_HOME = originalOpenCodexHome;
  removeTreeWithRetry(testDir);
});

function body(input: unknown[], model = "gpt-6.1-sol"): string {
  return JSON.stringify({
    model,
    instructions: "stable instructions",
    tools: [{ type: "function", name: "read" }],
    reasoning: { effort: "medium" },
    store: false,
    type: "responses",
    input,
  });
}

describe("Sol upstream comparison capture", () => {
  test("links an unkeyed follow-up only when its request preserves the full prior input prefix", () => {
    const firstInput = [{ type: "message", role: "user", content: "first" }];
    const firstBody = body(firstInput);
    captureSolUpstreamRequest(
      "openai", "gpt-6.1-sol", "https://chatgpt.com/backend-api/codex/responses",
      { method: "POST", body: firstBody }, "lr-first", undefined, undefined,
    );
    captureSolUpstreamPayload("openai", "gpt-6.1-sol", "lr-first", {
      type: "response.completed",
      response: { id: "resp-first", usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 } } },
    });

    const nextBody = body([...firstInput, { type: "message", role: "assistant", content: "next" }]);
    const attached = addSolCacheComparison("openai", "gpt-6.1-sol", undefined, nextBody);
    expect(attached.decision).toBe("continued_prefix_match");
    expect(JSON.parse(attached.body).prompt_cache_options.comparison_response_id).toBe("resp-first");

    const differentBody = body([{ type: "message", role: "user", content: "rewritten" }]);
    expect(addSolCacheComparison("openai", "gpt-6.1-sol", undefined, differentBody).decision)
      .toBe("no_matching_prior_prefix");
  });

  test("retains the injected comparison ID and decision in the raw request capture", () => {
    const requestBody = JSON.stringify({
      model: "gpt-6.1-sol",
      input: [{ type: "message", role: "user", content: "hi" }],
      prompt_cache_options: { comparison_response_id: "resp-prior" },
    });
    captureSolUpstreamRequest(
      "openai", "gpt-6.1-sol", "https://chatgpt.com/backend-api/codex/responses",
      { method: "POST", body: requestBody }, "lr-captured",
      { comparisonDecision: "continued_prefix_match" }, undefined,
    );
    const captureDir = join(testDir, "openai-upstream-capture");
    const file = readdirSync(captureDir).find(name => name.endsWith(".jsonl"));
    expect(file).toBeTruthy();
    const row = JSON.parse(readFileSync(join(captureDir, file!), "utf8").trim());
    expect(row.comparisonDecision).toBe("continued_prefix_match");
    expect(row.comparisonResponseId).toBe("resp-prior");
    expect(JSON.parse(row.body).prompt_cache_options.comparison_response_id).toBe("resp-prior");
  });

  test("records request-ID headers from the pre-sanitized physical response", () => {
    captureSolUpstreamRequest(
      "openai", "gpt-6-luna", "https://chatgpt.com/backend-api/codex/responses",
      { method: "POST", body: body([{ type: "message", role: "user", content: "header probe" }], "gpt-6-luna") },
      "lr-header",
    );
    captureSolUpstreamResponseHeaders(
      "openai", "gpt-6-luna", "lr-header",
      new Response(null, { status: 200, headers: { "x-request-id": "req-test" } }),
    );
    const captureDir = join(testDir, "openai-upstream-capture");
    const file = readdirSync(captureDir).find(name => name.endsWith(".jsonl"));
    const rows = readFileSync(join(captureDir, file!), "utf8").trim().split("\n").map(JSON.parse);
    expect(rows.find((row: { phase: string }) => row.phase === "response_headers")).toMatchObject({
      responseTransport: "http-fetch",
      xRequestId: "req-test",
    });
  });

  test("captures Luna and links its own prior response without crossing model boundaries", () => {
    const firstInput = [{ type: "message", role: "user", content: "first Luna turn" }];
    captureSolUpstreamRequest(
      "openai", "gpt-6-luna", "https://chatgpt.com/backend-api/codex/responses",
      { method: "POST", body: body(firstInput, "gpt-6-luna") }, "lr-luna-first", undefined, "conversation-luna",
    );
    captureSolUpstreamPayload("openai", "gpt-6-luna", "lr-luna-first", {
      type: "response",
      id: "resp-luna-first",
      object: "response",
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 } },
    });

    const next = addSolCacheComparison(
      "openai", "gpt-6-luna", "conversation-luna",
      body([...firstInput, { type: "message", role: "assistant", content: "next" }], "gpt-6-luna"),
    );
    expect(next.decision).toBe("conversation_key_match");
    expect(JSON.parse(next.body).prompt_cache_options.comparison_response_id).toBe("resp-luna-first");
    const unkeyedNext = addSolCacheComparison(
      "openai", "gpt-6-luna", undefined,
      body([...firstInput, { type: "message", role: "assistant", content: "next" }], "gpt-6-luna"),
    );
    expect(unkeyedNext.decision).toBe("continued_prefix_match");
    expect(JSON.parse(unkeyedNext.body).prompt_cache_options.comparison_response_id).toBe("resp-luna-first");
    expect(addSolCacheComparison("openai", "gpt-6-sol", "conversation-luna", body(firstInput, "gpt-6-sol")).decision)
      .toBe("model_not_validated");
  });

  test("compares at the pre-adapter stage while capturing the physical upstream body", () => {
    const firstInput = [{ type: "message", role: "user", content: "first turn" }];
    const firstClientBody = body(firstInput, "gpt-6-luna");
    const firstUpstreamBody = JSON.stringify({ ...JSON.parse(firstClientBody), provider_extension: "adapted" });
    captureSolUpstreamRequest(
      "openai", "gpt-6-luna", "https://chatgpt.com/backend-api/codex/responses",
      { method: "POST", body: firstUpstreamBody }, "lr-luna-adapted",
      { comparisonInputBody: firstClientBody }, undefined,
    );
    captureSolUpstreamPayload("openai", "gpt-6-luna", "lr-luna-adapted", {
      type: "response.completed",
      response: { id: "resp-luna-adapted", usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 } } },
    });

    const currentClientBody = body([...firstInput, { type: "message", role: "assistant", content: "next" }], "gpt-6-luna");
    const next = addSolCacheComparison("openai", "gpt-6-luna", undefined, currentClientBody);
    expect(next.decision).toBe("continued_prefix_match");
    expect(JSON.parse(next.body).prompt_cache_options.comparison_response_id).toBe("resp-luna-adapted");
  });

  test("stops after two linked cache events and captures two follow-up turns for each", () => {
    startSolRequestCapture(Date.now(), { models: ["gpt-6-luna"] });
    let serial = 0;
    const runEvent = (conversation: string): string => {
      const turns: unknown[] = [{ type: "message", role: "user", content: conversation }];
      let responseId = "";
      const send = (cached: number): void => {
        const logicalRequestId = `lr-event-${++serial}`;
        const baseBody = body([...turns], "gpt-6-luna");
        const comparison = addSolCacheComparison("openai", "gpt-6-luna", undefined, baseBody);
        captureSolUpstreamRequest(
          "openai", "gpt-6-luna", "https://chatgpt.com/backend-api/codex/responses",
          { method: "POST", body: comparison.body }, logicalRequestId,
          { comparisonDecision: comparison.decision, comparisonInputBody: baseBody }, undefined,
        );
        responseId = `resp-event-${serial}`;
        captureSolUpstreamPayload("openai", "gpt-6-luna", logicalRequestId, {
          type: "response.completed",
          response: { id: responseId, usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: cached, cache_write_tokens: 0 } } },
        });
        turns.push({ type: "message", role: "assistant", content: `answer-${serial}` });
        turns.push({ type: "message", role: "user", content: `follow-up-${serial}` });
      };
      send(800); // First warm request.
      send(800); // Second warm request, eligible as the Cold predecessor.
      send(0);   // Cold request references the second warm response.
      send(800); // Recovery references the Cold response.
      send(850); // Follow-up 1.
      send(900); // Follow-up 2 completes the event.
      return responseId;
    };

    runEvent("conversation one");
    const afterOne = getSolRequestCaptureStatus();
    expect(afterOne.enabled).toBe(true);
    expect(afterOne.completedEvents).toHaveLength(1);
    runEvent("conversation two");
    const afterTwo = getSolRequestCaptureStatus();
    expect(afterTwo.enabled).toBe(false);
    expect(afterTwo.stopReason).toBe("target_events");
    expect(afterTwo.completedEvents).toHaveLength(2);
    expect(afterTwo.completedEvents[0]!.postRecovery).toHaveLength(2);
    expect(afterTwo.completedEvents[1]!.postRecovery).toHaveLength(2);
    expect(afterTwo.completedEvents[0]!.chainId).not.toBe(afterTwo.completedEvents[1]!.chainId);
  });
});

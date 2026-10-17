import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addSolCacheComparison,
  captureSolUpstreamPayload,
  captureSolUpstreamRequest,
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

function body(input: unknown[]): string {
  return JSON.stringify({
    model: "gpt-6.1-sol",
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
    const captureDir = join(testDir, "sol-upstream-capture");
    const file = readdirSync(captureDir).find(name => name.endsWith(".jsonl"));
    expect(file).toBeTruthy();
    const row = JSON.parse(readFileSync(join(captureDir, file!), "utf8").trim());
    expect(row.comparisonDecision).toBe("continued_prefix_match");
    expect(row.comparisonResponseId).toBe("resp-prior");
    expect(JSON.parse(row.body).prompt_cache_options.comparison_response_id).toBe("resp-prior");
  });
});
